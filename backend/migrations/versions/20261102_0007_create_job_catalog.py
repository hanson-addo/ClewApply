"""The shared job catalog: raw postings, companies, jobs and job sources.

These hold public job postings, not user data, so there's no row-level security. The app
role can read and write the catalog, and delete only raw postings (the 30-day cleanup).

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import grant_app_access, revoke_app_access

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _now(name: str) -> sa.Column[object]:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    new_id = sa.text("gen_random_uuid()")

    op.create_table(
        "raw_postings",
        sa.Column("id", uuid, server_default=new_id, nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_job_id", sa.String(length=255), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        _now("fetched_at"),
        sa.PrimaryKeyConstraint("id", name="pk_raw_postings"),
    )
    op.create_index("ix_raw_postings_source_job", "raw_postings", ["source", "source_job_id"])
    op.create_index("ix_raw_postings_fetched_at", "raw_postings", ["fetched_at"])
    grant_app_access("raw_postings", "SELECT, INSERT, DELETE")

    op.create_table(
        "companies",
        sa.Column("id", uuid, server_default=new_id, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("name_norm", sa.String(length=200), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("ats_type", sa.String(length=16), nullable=True),
        sa.Column("board_token", sa.String(length=100), nullable=True),
        _now("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_companies"),
        sa.UniqueConstraint("name_norm", name="uq_companies_name_norm"),
        sa.UniqueConstraint("ats_type", "board_token", name="uq_companies_ats_board"),
    )
    grant_app_access("companies", "SELECT, INSERT, UPDATE")

    op.create_table(
        "jobs",
        sa.Column("id", uuid, server_default=new_id, nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("title_norm", sa.String(length=300), nullable=False),
        sa.Column("company_id", uuid, nullable=False),
        sa.Column("location", sa.String(length=300), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("region", sa.String(length=100), nullable=True),
        sa.Column("remote_type", sa.String(length=16), nullable=True),
        sa.Column("salary_min", sa.Integer(), nullable=True),
        sa.Column("salary_max", sa.Integer(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dedup_key", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
        _now("created_at"),
        _now("updated_at"),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name="fk_jobs_company_id", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_jobs"),
        sa.UniqueConstraint("dedup_key", name="uq_jobs_dedup_key"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_jobs_status"),
        sa.CheckConstraint(
            "remote_type IS NULL OR remote_type IN ('onsite', 'hybrid', 'remote')",
            name="ck_jobs_remote_type",
        ),
    )
    # The dimension and an index come when the embedding model is chosen (ranking work).
    op.execute("ALTER TABLE jobs ADD COLUMN embedding vector")
    op.create_index("ix_jobs_company_id", "jobs", ["company_id"])
    op.create_index("ix_jobs_posted_at", "jobs", ["posted_at"])
    grant_app_access("jobs", "SELECT, INSERT, UPDATE")

    op.create_table(
        "job_sources",
        sa.Column("id", uuid, server_default=new_id, nullable=False),
        sa.Column("job_id", uuid, nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_job_id", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=2000), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        _now("first_seen_at"),
        _now("last_seen_at"),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name="fk_job_sources_job_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_job_sources"),
        sa.UniqueConstraint("source", "source_job_id", name="uq_job_sources_source_job"),
    )
    op.create_index("ix_job_sources_job_id", "job_sources", ["job_id"])
    op.create_index(
        "uq_job_sources_one_primary",
        "job_sources",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )
    grant_app_access("job_sources", "SELECT, INSERT, UPDATE")


def downgrade() -> None:
    for table in ("job_sources", "jobs", "companies", "raw_postings"):
        revoke_app_access(table)
        op.drop_table(table)
