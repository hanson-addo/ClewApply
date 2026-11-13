"""Each time a user agreed to, or withdrew, AI reading of their resumes (#75). Append-only,
so we can tell what a user had agreed to when a given resume was read."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base


class AiConsentEvent(Base):
    __tablename__ = "ai_consent_events"
    __table_args__ = (Index("ix_ai_consent_events_user_time", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # True when the user agreed; False when they withdrew.
    agreed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The privacy policy version the user was shown.
    policy_version: Mapped[str] = mapped_column(String(32), nullable=False)
    # clock_timestamp, not now(): two changes in one transaction still keep their order.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.clock_timestamp()
    )
