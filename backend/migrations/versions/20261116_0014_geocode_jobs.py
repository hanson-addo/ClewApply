"""Map points for jobs (#119): lat, lng and why a job has none.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("jobs", sa.Column("lng", sa.Float(), nullable=True))
    # Null until looked up; the worker fills older jobs after each hourly poll.
    op.add_column("jobs", sa.Column("geocode_status", sa.String(length=16), nullable=True))
    op.create_index(
        "ix_jobs_geocode_pending",
        "jobs",
        ["id"],
        postgresql_where=sa.text("geocode_status IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_geocode_pending", table_name="jobs")
    op.drop_column("jobs", "geocode_status")
    op.drop_column("jobs", "lng")
    op.drop_column("jobs", "lat")
