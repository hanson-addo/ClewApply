"""Saved and dismissed jobs (#24).

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "job_feedback",
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("job_id", uuid, nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("action IN ('saved', 'dismissed')", name="ck_job_feedback_action"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_job_feedback_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name="fk_job_feedback_job_id_jobs", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "job_id", name="pk_job_feedback"),
    )
    op.create_index("ix_job_feedback_job_id", "job_feedback", ["job_id"])
    enable_user_rls("job_feedback")


def downgrade() -> None:
    disable_user_rls("job_feedback")
    op.drop_index("ix_job_feedback_job_id", table_name="job_feedback")
    op.drop_table("job_feedback")
