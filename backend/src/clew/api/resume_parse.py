"""Reading an uploaded resume into a draft profile. The draft is only a suggestion: the user
checks it (fields in `check` first) and saves it as their profile with PUT /profile."""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.db.session import get_session
from clew.jobs import JobQueue, QueueUnavailable, get_job_queue
from clew.models import ParseStatus, Resume, ResumeParse, UsageEvent, UsageKind
from clew.resumes.parser import ParsedResume
from clew.resumes.parsing import ParseError
from clew.scanning import ScanVerdict

logger = logging.getLogger(__name__)

router = APIRouter(tags=["resumes"])

DAILY_PARSE_LIMIT = 10

# A parse still pending or running after this long has stalled (a worker died); it reads
# as failed and can be started again.
STALLED_AFTER = timedelta(minutes=15)

TRY_AGAIN = "Reading resumes is unavailable right now. Try again in a few minutes."
UNREADABLE = "We couldn't read this resume. Save it again as a PDF or Word file and upload that."
MESSAGES = {
    ParseError.ENCRYPTED: (
        "This file is password-protected. Remove the password and upload it again."
    ),
    ParseError.NO_TEXT: (
        "We couldn't find any text in this file. If it's a scanned image, upload the original "
        "document instead."
    ),
    ParseError.UNREADABLE: UNREADABLE,
    ParseError.TOO_LARGE: UNREADABLE,
    ParseError.PARSE_FAILED: UNREADABLE,
    ParseError.PARSE_INVALID: UNREADABLE,
    ParseError.EXTRACT_FAILED: UNREADABLE,
    ParseError.INFECTED: "We couldn't accept this file. Please try a different copy.",
    ParseError.NOT_SCANNED: "This file hasn't passed the virus check, so it can't be read.",
    ParseError.UNAVAILABLE: TRY_AGAIN,
    ParseError.BUSY: "We're still reading your other resume. Try this one again when it's done.",
    ParseError.DAILY_LIMIT: "You've reached today's limit for reading resumes. Try again tomorrow.",
}

Session = Annotated[AsyncSession, Depends(get_session)]
Queue = Annotated[JobQueue | None, Depends(get_job_queue)]


class ResumeParseOut(BaseModel):
    status: ParseStatus
    # Set when status is "failed": a message to show the user.
    message: str | None = None
    # Set when status is "done".
    result: ParsedResume | None = None
    updated_at: datetime


def _out(parse: ResumeParse) -> ResumeParseOut:
    if _stalled(parse):
        return ResumeParseOut(
            status=ParseStatus.FAILED, message=TRY_AGAIN, updated_at=parse.updated_at
        )
    message = None
    if parse.status == ParseStatus.FAILED:
        code = parse.error_code
        message = (
            MESSAGES[ParseError(code)] if code is not None and code in ParseError else UNREADABLE
        )
    result = None
    if parse.status == ParseStatus.DONE and parse.result is not None:
        result = ParsedResume.model_validate(parse.result)
    return ResumeParseOut(
        status=ParseStatus(parse.status),
        message=message,
        result=result,
        updated_at=parse.updated_at,
    )


def _stalled(parse: ResumeParse) -> bool:
    in_progress = parse.status in (ParseStatus.PENDING, ParseStatus.RUNNING)
    return in_progress and datetime.now(UTC) - parse.updated_at > STALLED_AFTER


async def start_parse(
    session: AsyncSession, queue: JobQueue | None, resume_id: uuid.UUID, user_id: uuid.UUID
) -> ResumeParse:
    """Queues a (fresh) parse of the resume, within the user's limits: one resume being read
    at a time, and DAILY_PARSE_LIMIT a day (threat model R26). A refused or unqueueable parse
    is stored as failed with a message, rather than left pending."""
    # One start at a time per user, so two requests can't both pass the checks below.
    await session.execute(select(func.pg_advisory_xact_lock(func.hashtext(str(user_id)))))
    refusal = await _refusal(session, resume_id, user_id)
    if refusal is not None:
        return await _store(session, resume_id, user_id, ParseStatus.FAILED, refusal)
    session.add(UsageEvent(user_id=user_id, kind=UsageKind.RESUME_PARSE))
    parse = await _store(session, resume_id, user_id, ParseStatus.PENDING, None)
    try:
        if queue is None:
            raise QueueUnavailable
        await queue.enqueue_parse(parse.id, user_id)
    except QueueUnavailable:
        parse = await _store(
            session, resume_id, user_id, ParseStatus.FAILED, ParseError.UNAVAILABLE
        )
    return parse


async def _refusal(
    session: AsyncSession, resume_id: uuid.UUID, user_id: uuid.UUID
) -> ParseError | None:
    in_flight = await session.scalar(
        select(func.count())
        .select_from(ResumeParse)
        .where(
            ResumeParse.user_id == user_id,
            ResumeParse.resume_id != resume_id,
            ResumeParse.status.in_([ParseStatus.PENDING, ParseStatus.RUNNING]),
            ResumeParse.updated_at > func.now() - STALLED_AFTER,
        )
    )
    if in_flight:
        return ParseError.BUSY
    used_today = await session.scalar(
        select(func.count())
        .select_from(UsageEvent)
        .where(
            UsageEvent.user_id == user_id,
            UsageEvent.kind == UsageKind.RESUME_PARSE,
            UsageEvent.created_at > func.now() - timedelta(days=1),
        )
    )
    if (used_today or 0) >= DAILY_PARSE_LIMIT:
        return ParseError.DAILY_LIMIT
    return None


async def _store(
    session: AsyncSession,
    resume_id: uuid.UUID,
    user_id: uuid.UUID,
    parse_status: ParseStatus,
    error: ParseError | None,
) -> ResumeParse:
    values = {
        "status": parse_status,
        "result": None,
        "error_code": error.value if error else None,
        "updated_at": func.now(),
    }
    parse: ResumeParse | None = await session.scalar(
        insert(ResumeParse)
        .values(resume_id=resume_id, user_id=user_id, **values)
        .on_conflict_do_update(
            index_elements=[ResumeParse.resume_id],
            set_=values,
            where=ResumeParse.user_id == user_id,
        )
        .returning(ResumeParse),
        execution_options={"populate_existing": True},
    )
    await session.commit()
    if parse is None:  # pragma: no cover - resume_id is the user's own, checked by the caller
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found.")
    return parse


async def _own_resume(session: AsyncSession, resume_id: uuid.UUID, user_id: uuid.UUID) -> Resume:
    resume = await session.scalar(
        select(Resume).where(
            Resume.id == resume_id, Resume.user_id == user_id, Resume.deleted_at.is_(None)
        )
    )
    if resume is None:
        # Same answer whether the resume doesn't exist or belongs to someone else.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found.")
    return resume


async def _own_parse(
    session: AsyncSession, resume_id: uuid.UUID, user_id: uuid.UUID
) -> ResumeParse | None:
    return await session.scalar(
        select(ResumeParse).where(
            ResumeParse.resume_id == resume_id, ResumeParse.user_id == user_id
        )
    )


@router.get(
    "/resumes/{resume_id}/parse",
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "No such resume for this user, or it hasn't been read yet"},
    },
)
async def get_parse(resume_id: uuid.UUID, user: CurrentUser, session: Session) -> ResumeParseOut:
    """Where reading the resume has got to, and the draft profile once it's done."""
    await _own_resume(session, resume_id, user.id)
    parse = await _own_parse(session, resume_id, user.id)
    if parse is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This resume hasn't been read yet.")
    return _out(parse)


@router.post(
    "/resumes/{resume_id}/parse",
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "No such resume for this user"},
        409: {"description": "The file hasn't passed the virus check"},
        429: {"description": "Another resume is being read, or the daily limit is reached"},
    },
)
async def restart_parse(
    resume_id: uuid.UUID, user: CurrentUser, session: Session, queue: Queue
) -> ResumeParseOut:
    """Reads the resume again after a failure. A parse that is in progress or done is
    returned as it is."""
    resume = await _own_resume(session, resume_id, user.id)
    if resume.scan_status != ScanVerdict.CLEAN:
        raise HTTPException(status.HTTP_409_CONFLICT, MESSAGES[ParseError.NOT_SCANNED])
    parse = await _own_parse(session, resume_id, user.id)
    if parse is not None and parse.status != ParseStatus.FAILED and not _stalled(parse):
        return _out(parse)
    parse = await start_parse(session, queue, resume_id, user.id)
    if parse.error_code in (ParseError.BUSY, ParseError.DAILY_LIMIT):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, MESSAGES[ParseError(parse.error_code)]
        )
    return _out(parse)
