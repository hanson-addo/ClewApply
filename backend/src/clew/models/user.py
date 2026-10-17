"""A Clew account. Sign-in itself lives with the auth provider (Clerk); there is no password."""

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base

Plan = Literal["free"]


class User(Base):
    __tablename__ = "users"

    # Random UUIDs, never sequential ids, so ids in URLs can't be guessed (threat model R1).
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    # The auth provider's user id (Clerk "sub" claim).
    auth_provider_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    # Every user has a plan from day one so paid features can be switched on later.
    plan: Mapped[str] = mapped_column(String(32), nullable=False, server_default="free")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
