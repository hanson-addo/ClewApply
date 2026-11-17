"""Exporting everything a user has stored, and deleting their account (#31)."""

import json
import logging
import tempfile
import uuid
import zipfile
from collections.abc import Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import IO, Any

from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase

from clew.models import (
    AiConsentEvent,
    Application,
    CompanyFollow,
    JobFeedback,
    JobPreferences,
    Profile,
    ProfileVersion,
    Resume,
    ResumeParse,
    UsageEvent,
    User,
)
from clew.resumes.files import MAX_RESUME_BYTES, safe_filename
from clew.storage import ObjectStore

logger = logging.getLogger(__name__)

# Every per-user table, by the name it has in the export. tests/test_account.py checks that a
# new table with a user_id column is added here, so the export never silently leaves one out.
EXPORTED: dict[str, type[DeclarativeBase]] = {
    "profile": Profile,
    "profile_versions": ProfileVersion,
    "job_preferences": JobPreferences,
    "applications": Application,
    "ai_consent_history": AiConsentEvent,
    "job_feedback": JobFeedback,
    "followed_companies": CompanyFollow,
    "resumes": Resume,
    "resume_drafts": ResumeParse,
    "usage_events": UsageEvent,
}

# Internal fields that mean nothing outside Clew (a random storage key, our own user id).
LEFT_OUT = {"file_key", "user_id"}

# Exports are spooled to disk past this size, so 20 resumes never sit in memory at once.
IN_MEMORY_BYTES = 8 * 1024 * 1024
CHUNK_BYTES = 64 * 1024


def _plain(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    return value


def _row(obj: DeclarativeBase) -> dict[str, Any]:
    return {
        column.key: _plain(getattr(obj, column.key))
        for column in inspect(obj).mapper.column_attrs
        if column.key not in LEFT_OUT
    }


async def build_export(session: AsyncSession, store: ObjectStore, user: User) -> IO[bytes]:
    """A zip of data.json (every row the user owns) and their resume files, rewound to the
    start. Row-level security already limits every read to this user; the WHERE clauses say
    so too."""
    data: dict[str, Any] = {
        "exported_at": datetime.now(UTC).isoformat(),
        "account": {"email": user.email, "plan": user.plan, "created_at": _plain(user.created_at)},
    }
    for name, model in EXPORTED.items():
        rows = await session.scalars(
            select(model).where(model.user_id == user.id)  # type: ignore[attr-defined]
        )
        data[name] = [_row(row) for row in rows]

    spool = tempfile.SpooledTemporaryFile(max_size=IN_MEMORY_BYTES)
    with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        resumes = await session.scalars(
            select(Resume)
            .where(
                Resume.user_id == user.id,
                Resume.deleted_at.is_(None),
                Resume.scan_status == "clean",
            )
            .order_by(Resume.created_at)
        )
        for number, resume in enumerate(resumes, start=1):
            name = f"resumes/{number:02d}-{safe_filename(resume.filename, resume.content_type)}"
            archive.writestr(name, await store.get(resume.file_key, MAX_RESUME_BYTES))
        archive.writestr("data.json", json.dumps(data, indent=2, ensure_ascii=False))
    spool.seek(0)
    return spool


def file_chunks(handle: IO[bytes]) -> Iterator[bytes]:
    try:
        while chunk := handle.read(CHUNK_BYTES):
            yield chunk
    finally:
        handle.close()


async def delete_account(session: AsyncSession, store: ObjectStore, user_id: uuid.UUID) -> int:
    """Deletes the user's resume files, then every row they own; returns how many files.

    Files go first: if storage fails, nothing in the database has changed and the user can
    try again (deleting a file that's already gone succeeds). The caller commits.
    """
    keys = list(await session.scalars(select(Resume.file_key).where(Resume.user_id == user_id)))
    for key in keys:
        await store.delete(key)
    # Runs as the table owner, for the user bound to this transaction only (migration 0015).
    await session.execute(text("SELECT delete_current_account(:files)"), {"files": len(keys)})
    logger.info("account_deleted", extra={"resume_files_deleted": len(keys)})
    return len(keys)
