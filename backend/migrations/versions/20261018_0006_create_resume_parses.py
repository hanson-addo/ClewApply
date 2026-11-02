"""Resume parse results and usage events for limits, behind row-level security.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_unique_constraint("uq_resumes_id_user_id", "resumes", ["id", "user_id"])
    op.create_table(
        "resume_parses",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("resume_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error_code", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["resume_id", "user_id"],
            ["resumes.id", "resumes.user_id"],
            name="fk_resume_parses_resume",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_resume_parses"),
        sa.UniqueConstraint("resume_id", name="uq_resume_parses_resume_id"),
    )
    op.create_index("ix_resume_parses_user_id", "resume_parses", ["user_id"])
    # The API and worker update a parse's status and result; they never delete one.
    enable_user_rls("resume_parses", "SELECT, INSERT, UPDATE")

    op.create_table(
        "usage_events",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_usage_events_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_usage_events"),
    )
    op.create_index(
        "ix_usage_events_user_kind_time", "usage_events", ["user_id", "kind", "created_at"]
    )
    # Append-only for the API, so a user can't reset their own limits.
    enable_user_rls("usage_events", "SELECT, INSERT")


def downgrade() -> None:
    disable_user_rls("usage_events")
    op.drop_index("ix_usage_events_user_kind_time", table_name="usage_events")
    op.drop_table("usage_events")
    disable_user_rls("resume_parses")
    op.drop_index("ix_resume_parses_user_id", table_name="resume_parses")
    op.drop_table("resume_parses")
    op.drop_constraint("uq_resumes_id_user_id", "resumes", type_="unique")
