"""What the extension filled on each job site (#130 step 2). Clew never reads the sites.

One row per (user, site, field): a keyed fingerprint of the value that was filled, never the
value itself, the profile version it came from, and when. Comparing fingerprints with the
current profile tells the Sync Center how many changes each site is behind.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from clew.db.base import Base


class SyncFill(Base):
    __tablename__ = "sync_fills"
    __table_args__ = (
        UniqueConstraint("user_id", "site", "field_key", name="uq_sync_fills_user_site_field"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    site: Mapped[str] = mapped_column(String(32), nullable=False)
    field_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # HMAC-SHA256 (hex) of the normalized value, keyed by CLEW_FILL_FINGERPRINT_KEY.
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    filled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
