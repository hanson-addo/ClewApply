"""Following company job boards (#19): which boards the worker polls, and who follows them.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "companies", sa.Column("poll", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "companies", sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_companies_poll", "companies", ["last_polled_at"], postgresql_where=sa.text("poll")
    )

    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "company_follows",
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("company_id", uuid, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_company_follows_user_id_users", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_company_follows_company_id_companies",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "company_id", name="pk_company_follows"),
    )
    op.create_index("ix_company_follows_company_id", "company_follows", ["company_id"])
    enable_user_rls("company_follows", "SELECT, INSERT, DELETE")


def downgrade() -> None:
    disable_user_rls("company_follows")
    op.drop_index("ix_company_follows_company_id", table_name="company_follows")
    op.drop_table("company_follows")
    op.drop_index("ix_companies_poll", table_name="companies")
    op.drop_column("companies", "last_polled_at")
    op.drop_column("companies", "poll")
