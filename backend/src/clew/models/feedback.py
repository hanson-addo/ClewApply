"""What a user did with a job in their feed (#24): saved it or dismissed it."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base


class FeedbackAction(StrEnum):
    SAVED = "saved"
    # Dismissed jobs leave the user's feed.
    DISMISSED = "dismissed"


class JobFeedback(Base):
    """One row per user and job; saving replaces a dismissal and the other way round.
    Private to the user (row-level security)."""

    __tablename__ = "job_feedback"
    __table_args__ = (CheckConstraint("action IN ('saved', 'dismissed')", name="action"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
