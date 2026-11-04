"""Number each user's profile versions 1, 2, 3...

History shows "Version N". Counting rows on the client went wrong once a user had more
versions than one page holds, and would shift once old versions are pruned, so the number
is stored when the version is saved.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("profile_versions", sa.Column("number", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE profile_versions AS v SET number = numbered.n
        FROM (
            SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS n
            FROM profile_versions
        ) AS numbered
        WHERE v.id = numbered.id
        """
    )
    op.alter_column("profile_versions", "number", nullable=False)
    op.create_unique_constraint(
        "uq_profile_versions_user_id_number", "profile_versions", ["user_id", "number"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_profile_versions_user_id_number", "profile_versions", type_="unique")
    op.drop_column("profile_versions", "number")
