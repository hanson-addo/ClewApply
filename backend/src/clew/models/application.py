"""The user's applications (#26): jobs they saved, applied to, or are interviewing for.

Private to the user (row-level security). Title, company and link are copied when the
application is made, so a card stays readable after its job closes or leaves the catalog.
"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base


class ApplicationStatus(StrEnum):
    SAVED = "saved"
    APPLIED = "applied"
    INTERVIEW = "interview"
    OFFER = "offer"
    # The employer said no.
    REJECTED = "rejected"
    # The user pulled out.
    WITHDRAWN = "withdrawn"


CLOSED = frozenset({ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN})
# Statuses that mean the user has applied.
SENT = frozenset(
    {
        ApplicationStatus.APPLIED,
        ApplicationStatus.INTERVIEW,
        ApplicationStatus.OFFER,
        ApplicationStatus.REJECTED,
        ApplicationStatus.WITHDRAWN,
    }
)
STATUS_CHECK = "status IN ('saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')"


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint(STATUS_CHECK, name="status"),
        CheckConstraint("profile_version IS NULL OR profile_version > 0", name="profile_version"),
        # One application per job and user; hand-added ones have no job.
        Index(
            "uq_applications_user_id_job_id",
            "user_id",
            "job_id",
            unique=True,
            postgresql_where=text("job_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Null for an application the user added by hand, or once its job leaves the catalog.
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    company: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # Set the first time the application reaches Applied (or later), and kept after that.
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set while the application is rejected or withdrawn.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # What was sent: the resume file and the profile version number. Neither changes when
    # the profile changes later. The resume link is cleared if that file is removed. Its
    # foreign key is (resume_id, user_id) with ON DELETE SET NULL (resume_id), which
    # SQLAlchemy can't spell, so it lives only in migration 0012.
    resume_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    profile_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
