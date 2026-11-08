"""One job in full, and saving or dismissing it (#24).

A job is shown only when the feed would show it to this user (R28: an unverified board's
jobs only to its followers); anything else is a 404, so ids can't be probed. Saved and
dismissed jobs are private to the user (row-level security) and never logged.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api.applications import track_saved_job, untrack_saved_job
from clew.api.feed import FeedJob, feed_job, job_facts, job_links, job_rows, wants_for
from clew.auth.deps import CurrentUser
from clew.catalog.merge import source_rank
from clew.db.session import get_session
from clew.feed.score import fit
from clew.models import FeedbackAction, Job, JobFeedback, JobSource

router = APIRouter(tags=["jobs"])

Session = Annotated[AsyncSession, Depends(get_session)]

NOT_FOUND = "That job isn't in your feed."
NO_FEEDBACK = "You haven't saved or dismissed that job."
RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not signed in"},
    404: {"description": "No such job, or not one this user can see"},
}


class Listing(BaseModel):
    source: str
    url: str
    # The one the Apply button opens.
    is_primary: bool
    first_seen_at: datetime
    last_seen_at: datetime


class JobDetail(FeedJob):
    description: str | None
    status: Literal["open", "closed"]
    dismissed: bool
    # Every site listing the job, best first.
    listings: list[Listing]


async def _visible_job(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> bool:
    found = await session.scalar(
        job_rows(user_id).with_only_columns(Job.id).where(Job.id == job_id)
    )
    return found is not None


@router.get("/jobs/{job_id}", responses=RESPONSES)
async def get_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobDetail:
    """A job with its full description, fit, reasons and every listing. Closed and
    dismissed jobs can still be opened."""
    row = (
        await session.execute(job_rows(user.id).add_columns(Job.status).where(Job.id == job_id))
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    wants, _ = await wants_for(session, user.id)
    job_fit = fit(wants, job_facts(row), datetime.now(UTC))
    links = await job_links(session, [job_id])
    if job_id not in links:  # pragma: no cover - every job has a source
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    card = feed_job(row, job_fit, links[job_id])
    description = await session.scalar(select(Job.description).where(Job.id == job_id))
    listings = sorted(
        await session.scalars(select(JobSource).where(JobSource.job_id == job_id)),
        key=lambda s: (not s.is_primary, source_rank(s.source), s.first_seen_at),
    )
    return JobDetail(
        **card.model_dump(),
        description=description,
        status=row.status,
        dismissed=row.feedback == FeedbackAction.DISMISSED,
        listings=[
            Listing(
                source=s.source,
                url=s.url,
                is_primary=s.is_primary,
                first_seen_at=s.first_seen_at,
                last_seen_at=s.last_seen_at,
            )
            for s in listings
        ],
    )


async def _record(
    session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, action: FeedbackAction
) -> Response:
    if not await _visible_job(session, user_id, job_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    statement = insert(JobFeedback).values(user_id=user_id, job_id=job_id, action=action)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[JobFeedback.user_id, JobFeedback.job_id],
            set_={"action": action, "created_at": statement.excluded.created_at},
        )
    )
    # Saved jobs show up under Saved in Applications (#26).
    if action == FeedbackAction.SAVED:
        await track_saved_job(session, user_id, job_id)
    else:
        await untrack_saved_job(session, user_id, job_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/jobs/{job_id}/save",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESPONSES,
)
async def save_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> Response:
    """Saves a job and adds it to Saved in Applications, unless it's tracked already.
    Saving a dismissed job brings it back to the feed."""
    return await _record(session, user.id, job_id, FeedbackAction.SAVED)


@router.post(
    "/jobs/{job_id}/dismiss",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESPONSES,
)
async def dismiss_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> Response:
    """Dismisses a job: it leaves the feed. Dismissing a saved job unsaves it, and removes
    its application if that is still only saved."""
    return await _record(session, user.id, job_id, FeedbackAction.DISMISSED)


@router.delete(
    "/jobs/{job_id}/feedback",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "The job isn't saved or dismissed"},
    },
)
async def clear_feedback(job_id: uuid.UUID, user: CurrentUser, session: Session) -> Response:
    """Unsaves or un-dismisses a job. Unsaving removes its application if that is still
    only saved."""
    result = await session.execute(
        delete(JobFeedback)
        .where(JobFeedback.user_id == user.id, JobFeedback.job_id == job_id)
        .returning(JobFeedback.job_id)
    )
    if result.first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_FEEDBACK)
    await untrack_saved_job(session, user.id, job_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
