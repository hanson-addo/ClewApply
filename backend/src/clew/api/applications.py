"""The application tracker (#26).

Statuses: saved, applied, interview, offer, rejected, withdrawn. Rejected (the employer said
no) and withdrawn (the user pulled out) are kept apart, though the board shows both under
Closed. Any status can move to any other, so a closed application can be reopened.

Saving a job in the feed creates a "saved" application for it; unsaving or dismissing the
job removes that application while it is still only saved. Applications are private to the
user (row-level security), and their notes are never logged.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import AfterValidator, BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api.feed import job_links, job_rows
from clew.auth.deps import CurrentUser
from clew.db.session import get_session
from clew.models import (
    Application,
    ApplicationStatus,
    Company,
    FeedbackAction,
    Job,
    JobFeedback,
    ProfileVersion,
    Resume,
)
from clew.models.application import CLOSED, SENT

router = APIRouter(tags=["applications"])

Session = Annotated[AsyncSession, Depends(get_session)]

# Far more than anyone tracks by hand; it keeps one account from filling the table.
MAX_APPLICATIONS = 2000
NOT_FOUND = "No such application."
JOB_NOT_FOUND = "That job isn't in your feed."
ALREADY_TRACKED = "already_tracked"
TOO_MANY = "too_many_applications"
NO_RESUME = "That resume isn't one of yours."
NO_VERSION = "Your profile has no version with that number."
RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not signed in"},
    404: {"description": "No such application, or not this user's"},
}


def _http_url(value: str | None) -> str | None:
    if value is None:
        return None
    if not value.lower().startswith(("https://", "http://")) or len(value) < 9:
        raise ValueError("The link must start with http:// or https://")
    return value


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
CompanyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Link = Annotated[
    str | None,
    StringConstraints(strip_whitespace=True, max_length=2048),
    AfterValidator(_http_url),
]
Notes = Annotated[str, Field(max_length=5000)]
Version = Annotated[int, Field(ge=1)]


JobState = Literal["open", "closed"]


class ApplicationOut(BaseModel):
    id: uuid.UUID
    # Null for one added by hand, or once its job has left the catalog.
    job_id: uuid.UUID | None
    # The job's own state: "closed" once the posting is gone. Null without a job.
    job_status: JobState | None
    title: str
    company: str
    url: str | None
    status: ApplicationStatus
    applied_at: datetime | None
    closed_at: datetime | None
    notes: str
    resume_id: uuid.UUID | None
    profile_version: int | None
    created_at: datetime
    updated_at: datetime


class ApplicationList(BaseModel):
    applications: list[ApplicationOut]


class NewApplication(BaseModel):
    """Either `job_id` (a job from the feed; its title, company and link are copied) or
    `title` and `company` (a job added by hand)."""

    job_id: uuid.UUID | None = None
    title: Title | None = None
    company: CompanyName | None = None
    url: Link = None
    status: ApplicationStatus = ApplicationStatus.APPLIED
    # When the user applied. Defaults to now for any status past Saved.
    applied_at: datetime | None = None
    notes: Notes = ""
    resume_id: uuid.UUID | None = None
    profile_version: Version | None = None


class ApplicationChange(BaseModel):
    """Fields to change; the ones left out stay as they are. Send null to clear `url`,
    `applied_at`, `resume_id` or `profile_version`."""

    title: Title | None = None
    company: CompanyName | None = None
    url: Link = None
    applied_at: datetime | None = None
    notes: Notes | None = None
    resume_id: uuid.UUID | None = None
    profile_version: Version | None = None


class StatusChange(BaseModel):
    status: ApplicationStatus


def move(application: Application, to: ApplicationStatus, now: datetime) -> None:
    """Sets the status and its dates. The first status past Saved sets `applied_at`, which
    then stays, even when the application goes back to Saved or out of Closed."""
    was_closed = application.status in CLOSED
    application.status = to
    if to in SENT and application.applied_at is None:
        application.applied_at = now
    if to in CLOSED:
        if not was_closed or application.closed_at is None:
            application.closed_at = now
    else:
        application.closed_at = None


def _out(application: Application, job_status: str | None) -> ApplicationOut:
    return ApplicationOut(
        id=application.id,
        job_id=application.job_id,
        job_status=cast(JobState, job_status) if application.job_id else None,
        title=application.title,
        company=application.company,
        url=application.url,
        status=ApplicationStatus(application.status),
        applied_at=application.applied_at,
        closed_at=application.closed_at,
        notes=application.notes,
        resume_id=application.resume_id,
        profile_version=application.profile_version,
        created_at=application.created_at,
        updated_at=application.updated_at,
    )


async def _check_sent(
    session: AsyncSession, user_id: uuid.UUID, resume_id: uuid.UUID | None, version: int | None
) -> None:
    """The resume and profile version must be this user's own."""
    if resume_id is not None:
        found = await session.scalar(
            select(Resume.id).where(
                Resume.id == resume_id, Resume.user_id == user_id, Resume.deleted_at.is_(None)
            )
        )
        if found is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, NO_RESUME)
    if version is not None:
        found = await session.scalar(
            select(ProfileVersion.id).where(
                ProfileVersion.user_id == user_id, ProfileVersion.number == version
            )
        )
        if found is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, NO_VERSION)


async def _load(
    session: AsyncSession, user_id: uuid.UUID, application_id: uuid.UUID
) -> tuple[Application, str | None]:
    row = (
        await session.execute(
            select(Application, Job.status)
            .outerjoin(Job, Job.id == Application.job_id)
            .where(Application.id == application_id, Application.user_id == user_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return row[0], row[1]


async def _save(session: AsyncSession, application: Application) -> None:
    application.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(application)


async def _job_card(
    session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID
) -> tuple[str, str, str | None] | None:
    """Title, company and Apply link of a job this user may see, or None."""
    row = (
        await session.execute(
            job_rows(user_id).with_only_columns(Job.title, Company.name).where(Job.id == job_id)
        )
    ).first()
    if row is None:
        return None
    links = await job_links(session, [job_id])
    url = links[job_id][0] if job_id in links else None
    return row[0], row[1], url


async def track_saved_job(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """Saving a job adds it to Saved, unless it is tracked already. Doesn't commit."""
    card = await _job_card(session, user_id, job_id)
    if card is None:  # pragma: no cover - the caller checked the job is visible
        return
    count = await session.scalar(
        select(func.count()).select_from(Application).where(Application.user_id == user_id)
    )
    if (count or 0) >= MAX_APPLICATIONS:
        return
    title, company, url = card
    await session.execute(
        insert(Application)
        .values(
            user_id=user_id,
            job_id=job_id,
            title=title,
            company=company,
            url=url,
            status=ApplicationStatus.SAVED,
        )
        .on_conflict_do_nothing(
            index_elements=[Application.user_id, Application.job_id],
            index_where=Application.job_id.is_not(None),
        )
    )


async def untrack_saved_job(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """Unsaving a job removes its application while it is still only saved. Doesn't commit."""
    await session.execute(
        delete(Application).where(
            Application.user_id == user_id,
            Application.job_id == job_id,
            Application.status == ApplicationStatus.SAVED,
        )
    )


@router.get("/applications", responses={401: {"description": "Not signed in"}})
async def list_applications(user: CurrentUser, session: Session) -> ApplicationList:
    """Every application, most recently changed first."""
    rows = await session.execute(
        select(Application, Job.status)
        .outerjoin(Job, Job.id == Application.job_id)
        .where(Application.user_id == user.id)
        .order_by(Application.updated_at.desc(), Application.id)
        .limit(MAX_APPLICATIONS)
    )
    return ApplicationList(applications=[_out(app, job_status) for app, job_status in rows])


@router.post(
    "/applications",
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "The job isn't in this user's feed"},
        409: {"description": "Already tracked (detail: already_tracked) or too many"},
        422: {
            "description": "Missing title or company, a bad link, or a resume or version "
            "that isn't the user's"
        },
    },
)
async def add_application(
    body: NewApplication, user: CurrentUser, session: Session
) -> ApplicationOut:
    """Adds an application, for a job in the feed or one added by hand."""
    if body.job_id is not None:
        card = await _job_card(session, user.id, body.job_id)
        if card is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, JOB_NOT_FOUND)
        title, company, url = card
        tracked = await session.scalar(
            select(Application.id).where(
                Application.user_id == user.id, Application.job_id == body.job_id
            )
        )
        if tracked is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_TRACKED)
    elif body.title is None or body.company is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Give the job title and the company."
        )
    else:
        title, company, url = body.title, body.company, body.url
    count = await session.scalar(
        select(func.count()).select_from(Application).where(Application.user_id == user.id)
    )
    if (count or 0) >= MAX_APPLICATIONS:
        raise HTTPException(status.HTTP_409_CONFLICT, TOO_MANY)
    await _check_sent(session, user.id, body.resume_id, body.profile_version)

    application = Application(
        user_id=user.id,
        job_id=body.job_id,
        title=title,
        company=company,
        url=url,
        status=ApplicationStatus.SAVED,
        applied_at=body.applied_at,
        notes=body.notes,
        resume_id=body.resume_id,
        profile_version=body.profile_version,
    )
    move(application, body.status, datetime.now(UTC))
    session.add(application)
    await _save(session, application)
    job_status = await session.scalar(select(Job.status).where(Job.id == body.job_id))
    return _out(application, job_status)


@router.get("/applications/{application_id}", responses=RESPONSES)
async def get_application(
    application_id: uuid.UUID, user: CurrentUser, session: Session
) -> ApplicationOut:
    application, job_status = await _load(session, user.id, application_id)
    return _out(application, job_status)


@router.patch("/applications/{application_id}", responses=RESPONSES)
async def change_application(
    application_id: uuid.UUID, body: ApplicationChange, user: CurrentUser, session: Session
) -> ApplicationOut:
    """Changes the title, company, link, applied date, notes, or what was sent."""
    application, job_status = await _load(session, user.id, application_id)
    sent = body.model_fields_set
    if ("title" in sent and body.title is None) or ("company" in sent and body.company is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The title and company can't be empty."
        )
    if "notes" in sent and body.notes is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Send empty notes, not null.")
    await _check_sent(
        session,
        user.id,
        body.resume_id if "resume_id" in sent else None,
        body.profile_version if "profile_version" in sent else None,
    )
    for field in sent:
        setattr(application, field, getattr(body, field))
    await _save(session, application)
    return _out(application, job_status)


@router.patch("/applications/{application_id}/status", responses=RESPONSES)
async def change_status(
    application_id: uuid.UUID, body: StatusChange, user: CurrentUser, session: Session
) -> ApplicationOut:
    """Moves the application. A rejected or withdrawn one can be reopened to any status,
    keeping its notes, what was sent and when it was applied."""
    application, job_status = await _load(session, user.id, application_id)
    move(application, body.status, datetime.now(UTC))
    await _save(session, application)
    return _out(application, job_status)


@router.delete(
    "/applications/{application_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=RESPONSES,
)
async def delete_application(
    application_id: uuid.UUID, user: CurrentUser, session: Session
) -> Response:
    """Deletes the application for good. If its job was saved in the feed, it is unsaved
    too, so the feed and the board agree."""
    deleted = (
        await session.execute(
            delete(Application)
            .where(Application.id == application_id, Application.user_id == user.id)
            .returning(Application.job_id)
        )
    ).first()
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    if deleted.job_id is not None:
        await session.execute(
            delete(JobFeedback).where(
                JobFeedback.user_id == user.id,
                JobFeedback.job_id == deleted.job_id,
                JobFeedback.action == FeedbackAction.SAVED,
            )
        )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
