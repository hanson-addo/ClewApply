"""The master profile: one per user, saved as an append-only history of versions."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        # Lets versions point at (profile, user) together, so a version can't be filed
        # under another user's profile.
        UniqueConstraint("id", "user_id", name="uq_profiles_id_user_id"),
        ForeignKeyConstraint(
            ["current_version_id", "user_id"],
            ["profile_versions.id", "profile_versions.user_id"],
            name="fk_profiles_current_version",
            use_alter=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ProfileVersion(Base):
    """One saved state of the profile. The API can only add versions, never change or
    delete them (the app role has no UPDATE or DELETE on this table)."""

    __tablename__ = "profile_versions"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_profile_versions_id_user_id"),
        ForeignKeyConstraint(
            ["profile_id", "user_id"],
            ["profiles.id", "profiles.user_id"],
            name="fk_profile_versions_profile",
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # JSON Resume document, validated by clew.profile.schema before it is written.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
