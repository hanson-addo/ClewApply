"""Resume upload and download. Every query is scoped to the signed-in user (threat model R1)."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.db.session import get_session
from clew.limits import TOO_LARGE
from clew.models import Resume
from clew.resumes.files import MAX_RESUME_BYTES, detect_resume_type, safe_filename
from clew.storage import ObjectStore, StorageUnavailable, get_object_store

router = APIRouter(tags=["resumes"])

DOWNLOAD_LINK_SECONDS = 5 * 60
WRONG_TYPE = "Upload a PDF or Word (.docx) file."
STORAGE_UNAVAILABLE = "File storage is unavailable. Try again in a few minutes."


def require_object_store(
    store: Annotated[ObjectStore | None, Depends(get_object_store)],
) -> ObjectStore:
    if store is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "File storage is not set up yet.")
    return store


Store = Annotated[ObjectStore, Depends(require_object_store)]
Session = Annotated[AsyncSession, Depends(get_session)]


class ResumeOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


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
        503: {"description": "File storage is unavailable"},
    },
)
async def upload_resume(
    file: UploadFile, user: CurrentUser, session: Session, store: Store
) -> ResumeOut:
    """Upload a resume (PDF or DOCX, up to 10 MB). The type is checked from the file's content."""
    data = await file.read(MAX_RESUME_BYTES + 1)
    if len(data) > MAX_RESUME_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
    content_type = detect_resume_type(data)
    if content_type is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, WRONG_TYPE)

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
    )
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return ResumeOut(
        id=resume.id,
        filename=resume.filename,
        content_type=resume.content_type,
        size_bytes=resume.size_bytes,
        created_at=resume.created_at,
    )


@router.get(
    "/resumes/{resume_id}/download",
    responses={
        401: {"description": "Not signed in"},
        404: {"description": "No such resume for this user"},
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
    url = store.download_url(
        resume.file_key,
        filename=resume.filename,
        content_type=resume.content_type,
        expires_in=DOWNLOAD_LINK_SECONDS,
    )
    return DownloadLink(
        url=url, expires_at=datetime.now(UTC) + timedelta(seconds=DOWNLOAD_LINK_SECONDS)
    )
