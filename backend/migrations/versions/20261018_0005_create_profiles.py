"""Master profile and its version history, both behind row-level security.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "profiles",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("current_version_id", uuid, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_profiles_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_profiles"),
        sa.UniqueConstraint("user_id", name="uq_profiles_user_id"),
        sa.UniqueConstraint("id", "user_id", name="uq_profiles_id_user_id"),
    )
    op.create_table(
        "profile_versions",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("profile_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("change_summary", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "user_id"],
            ["profiles.id", "profiles.user_id"],
            name="fk_profile_versions_profile",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_profile_versions"),
        sa.UniqueConstraint("id", "user_id", name="uq_profile_versions_id_user_id"),
    )
    op.create_index("ix_profile_versions_profile_id", "profile_versions", ["profile_id"])
    # The current version must be one of the same user's versions.
    op.create_foreign_key(
        "fk_profiles_current_version",
        "profiles",
        "profile_versions",
        ["current_version_id", "user_id"],
        ["id", "user_id"],
    )

    # The API never deletes a profile (account deletion cascades from users).
    enable_user_rls("profiles", "SELECT, INSERT, UPDATE")
    # Versions are append-only for the API: no UPDATE, no DELETE.
    enable_user_rls("profile_versions", "SELECT, INSERT")


def downgrade() -> None:
    disable_user_rls("profile_versions")
    disable_user_rls("profiles")
    op.drop_constraint("fk_profiles_current_version", "profiles", type_="foreignkey")
    op.drop_index("ix_profile_versions_profile_id", table_name="profile_versions")
    op.drop_table("profile_versions")
    op.drop_table("profiles")
