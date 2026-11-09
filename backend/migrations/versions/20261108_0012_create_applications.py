"""Applications: the user's tracker (#26).

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUS_CHECK = "status IN ('saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')"


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    now = sa.func.now()
    op.create_table(
        "applications",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("job_id", uuid, nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("company", sa.String(200), nullable=False),
        sa.Column("url", sa.String(2048), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("resume_id", uuid, nullable=True),
        sa.Column("profile_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=now, nullable=False),
        sa.CheckConstraint(STATUS_CHECK, name="ck_applications_status"),
        sa.CheckConstraint(
            "profile_version IS NULL OR profile_version > 0",
            name="ck_applications_profile_version",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_applications_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name="fk_applications_job_id_jobs", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_applications"),
    )
    # The resume must be the same user's. If the file row goes, only resume_id is cleared
    # (SET NULL with a column list, Postgres 15+), so the application itself stays.
    op.execute(
        "ALTER TABLE applications ADD CONSTRAINT fk_applications_resume "
        "FOREIGN KEY (resume_id, user_id) REFERENCES resumes (id, user_id) "
        "ON DELETE SET NULL (resume_id)"
    )
    op.create_index("ix_applications_user_id", "applications", ["user_id"])
    op.create_index("ix_applications_job_id", "applications", ["job_id"])
    op.create_index(
        "uq_applications_user_id_job_id",
        "applications",
        ["user_id", "job_id"],
        unique=True,
        postgresql_where=sa.text("job_id IS NOT NULL"),
    )
    enable_user_rls("applications")


def downgrade() -> None:
    disable_user_rls("applications")
    op.drop_index("uq_applications_user_id_job_id", table_name="applications")
    op.drop_index("ix_applications_job_id", table_name="applications")
    op.drop_index("ix_applications_user_id", table_name="applications")
    op.drop_table("applications")
