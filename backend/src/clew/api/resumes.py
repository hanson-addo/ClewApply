"""Resume upload and download. Every query is scoped to the signed-in user (threat model R1)."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api.resume_parse import start_parse
from clew.auth.deps import CurrentUser
from clew.config import get_settings
from clew.consent import has_ai_consent
from clew.db.session import get_session
from clew.jobs import JobQueue, get_job_queue
from clew.limits import TOO_LARGE
from clew.models import Resume, UsageEvent, UsageKind
from clew.resumes.files import MAX_RESUME_BYTES, detect_resume_type, safe_filename
from clew.scanning import MalwareScanner, ScannerUnavailable, ScanVerdict, get_malware_scanner
from clew.storage import ObjectStore, StorageUnavailable, get_object_store
from clew.usage import lock_user, used_within

router = APIRouter(tags=["resumes"])

DOWNLOAD_LINK_SECONDS = 5 * 60
WRONG_TYPE = "Upload a PDF or Word (.docx) file."
STORAGE_UNAVAILABLE = "File storage is unavailable. Try again in a few minutes."
INFECTED = "We couldn't accept this file. Please try a different copy."
SCAN_UNAVAILABLE = "We can't check files for viruses right now. Try again in a few minutes."
NOT_SCANNED = "This file hasn't passed the virus check, so it can't be downloaded."
TOO_MANY_UPLOADS = "You've uploaded a lot of files in the last hour. Try again later."
TOO_MANY_STORED = "You've saved the most resumes Clew keeps. Delete an old one to add another."


def require_object_store(
    store: Annotated[ObjectStore | None, Depends(get_object_store)],
) -> ObjectStore:
    if store is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "File storage is not set up yet.")
    return store


def require_malware_scanner(
    scanner: Annotated[MalwareScanner | None, Depends(get_malware_scanner)],
) -> MalwareScanner:
    if scanner is None:
        # Fail closed: no upload is stored without a scan.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Virus scanning is not set up yet."
        )
    return scanner


Store = Annotated[ObjectStore, Depends(require_object_store)]
Scanner = Annotated[MalwareScanner, Depends(require_malware_scanner)]
Session = Annotated[AsyncSession, Depends(get_session)]
Queue = Annotated[JobQueue | None, Depends(get_job_queue)]


class ResumeOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime
    # True when reading it with AI started (the user has agreed to AI reading); follow it
    # with GET /resumes/{id}/parse. False: start it later with POST /resumes/{id}/parse.
    reading: bool


class DownloadLink(BaseModel):
    url: str
    expires_at: datetime


@router.post(
    "/resumes",
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"description": "Not signed in"},
        413: {"description": "The file is over 10 MB"},
        415: {"description": "The file is not a PDF or DOCX"},
        422: {"description": "The virus scan found something; the file was not kept"},
        429: {"description": "Too many uploads in the last hour, or too many resumes stored"},
        503: {"description": "File storage or virus scanning is unavailable"},
    },
)
async def upload_resume(
    file: UploadFile,
    user: CurrentUser,
    session: Session,
    store: Store,
    scanner: Scanner,
    queue: Queue,
) -> ResumeOut:
    """Upload a resume (PDF or DOCX, up to 10 MB). The type is checked from the file's content,
    and the file is virus-scanned before it is stored. If the user has agreed to AI reading
    (GET /me/ai-consent), reading it into a draft profile starts straight away; follow it
    with GET /resumes/{id}/parse."""
    data = await file.read(MAX_RESUME_BYTES + 1)
    if len(data) > MAX_RESUME_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
    content_type = detect_resume_type(data)
    if content_type is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, WRONG_TYPE)
    await _count_upload(session, user.id)

    # Scanned before it is stored, so an infected file is never kept anywhere.
    try:
        verdict = await scanner.scan(data)
    except ScannerUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, SCAN_UNAVAILABLE) from None
    if verdict is not ScanVerdict.CLEAN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, INFECTED)

    file_key = f"resumes/{uuid.uuid4().hex}"
    try:
        await store.put(file_key, data, content_type)
    except StorageUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, STORAGE_UNAVAILABLE) from None

    resume = Resume(
        user_id=user.id,
        file_key=file_key,
        filename=safe_filename(file.filename, content_type),
        content_type=content_type,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        scan_status=ScanVerdict.CLEAN.value,
    )
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    reading = await has_ai_consent(session, user.id)
    if reading:
        await start_parse(session, queue, resume.id, user.id)
    return ResumeOut(
        id=resume.id,
        filename=resume.filename,
        content_type=resume.content_type,
        size_bytes=resume.size_bytes,
        created_at=resume.created_at,
        reading=reading,
    )


@router.get(
    "/resumes/{resume_id}/download",
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "No such resume for this user"},
        409: {"description": "The file hasn't passed the virus check"},
        503: {"description": "File storage is not set up"},
    },
)
async def download_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session, store: Store
) -> DownloadLink:
    """A signed link to the resume file, valid for 5 minutes. Only the owner gets one."""
    resume = await session.scalar(
        select(Resume).where(
            Resume.id == resume_id,
            Resume.user_id == user.id,
            Resume.deleted_at.is_(None),
        )
    )
    if resume is None:
        # Same answer whether the resume doesn't exist or belongs to someone else.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found.")
    if resume.scan_status != ScanVerdict.CLEAN:
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_SCANNED)
    url = store.download_url(
        resume.file_key,
        filename=resume.filename,
        content_type=resume.content_type,
        expires_in=DOWNLOAD_LINK_SECONDS,
    )
    return DownloadLink(
        url=url, expires_at=datetime.now(UTC) + timedelta(seconds=DOWNLOAD_LINK_SECONDS)
    )


async def _count_upload(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Refuses the upload with 429 when the user is over a cap, else records it. Every
    upload that reaches the virus scan counts toward the hourly cap, kept or not, since the
    scan is the cost the cap protects."""
    settings = get_settings()
    await lock_user(session, user_id)
    if (
        await used_within(session, user_id, UsageKind.RESUME_UPLOAD, timedelta(hours=1))
        >= settings.resume_uploads_per_hour
    ):
        await session.rollback()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_UPLOADS)
    stored = await session.scalar(
        select(func.count())
        .select_from(Resume)
        .where(Resume.user_id == user_id, Resume.deleted_at.is_(None))
    )
    if (stored or 0) >= settings.resumes_stored_max:
        await session.rollback()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_STORED)
    session.add(UsageEvent(user_id=user_id, kind=UsageKind.RESUME_UPLOAD))
    # Committed now, which also ends the lock, so the scan doesn't hold a transaction open.
    await session.commit()
