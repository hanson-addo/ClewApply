"""The result of reading one resume into a draft profile (one row per resume)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKeyConstraint, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base


class ParseStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class ResumeParse(Base):
    __tablename__ = "resume_parses"
    __table_args__ = (
        # (resume, user) together, so a parse can't be filed under another user's resume.
        ForeignKeyConstraint(
            ["resume_id", "user_id"],
            ["resumes.id", "resumes.user_id"],
            name="fk_resume_parses_resume",
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    resume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    # ParsedResume (draft profile, confidence, "check this" paths) once done.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Why it failed, as a code (clew.resumes.parsing.ParseError). Never resume content.
    error_code: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
