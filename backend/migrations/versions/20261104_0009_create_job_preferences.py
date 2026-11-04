"""Job preferences, one row per user, behind row-level security (#16).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "job_preferences",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column(
            "titles", postgresql.ARRAY(sa.String(length=100)), server_default="{}", nullable=False
        ),
        sa.Column("locations", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("remote_ok", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("salary_floor", sa.Integer(), nullable=True),
        sa.Column(
            "seniority", postgresql.ARRAY(sa.String(length=16)), server_default="{}", nullable=False
        ),
        sa.Column(
            "excluded_companies",
            postgresql.ARRAY(sa.String(length=200)),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "excluded_keywords",
            postgresql.ARRAY(sa.String(length=100)),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_job_preferences_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_job_preferences"),
        sa.UniqueConstraint("user_id", name="uq_job_preferences_user_id"),
    )
    # Users change their preferences but never delete them (account deletion cascades).
    enable_user_rls("job_preferences", "SELECT, INSERT, UPDATE")


def downgrade() -> None:
    disable_user_rls("job_preferences")
    op.drop_table("job_preferences")
