"""Fill records for the Sync Center (#130 step 2): fingerprints of what the extension filled.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "sync_fills",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("site", sa.String(length=32), nullable=False),
        sa.Column("field_key", sa.String(length=64), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("profile_version", sa.Integer(), nullable=False),
        sa.Column(
            "filled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_sync_fills_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sync_fills"),
        sa.UniqueConstraint("user_id", "site", "field_key", name="uq_sync_fills_user_site_field"),
    )
    enable_user_rls("sync_fills", "SELECT, INSERT, UPDATE")


def downgrade() -> None:
    disable_user_rls("sync_fills")
    op.drop_table("sync_fills")
