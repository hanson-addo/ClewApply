"""AI reading consent (#75): an append-only list of agree and withdraw events per user.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "ai_consent_events",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("agreed", sa.Boolean(), nullable=False),
        sa.Column("policy_version", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_ai_consent_events_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ai_consent_events"),
    )
    op.create_index(
        "ix_ai_consent_events_user_time", "ai_consent_events", ["user_id", "created_at"]
    )
    # Append-only for the API and worker: a change of mind is a new row, never an edit.
    enable_user_rls("ai_consent_events", "SELECT, INSERT")


def downgrade() -> None:
    disable_user_rls("ai_consent_events")
    op.drop_index("ix_ai_consent_events_user_time", table_name="ai_consent_events")
    op.drop_table("ai_consent_events")
