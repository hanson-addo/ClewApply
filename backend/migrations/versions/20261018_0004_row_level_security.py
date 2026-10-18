"""App role and row-level security on per-user tables.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-18
"""

from collections.abc import Sequence

from alembic import op

from clew.db.rls import (
    APP_ROLE,
    create_app_role,
    disable_user_rls,
    enable_user_rls,
    grant_app_access,
    revoke_app_access,
)

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    create_app_role()
    # `users` has no row policy: sign-in has to find the account by its Clerk id before
    # any user is bound. The API never deletes users (accounts are soft-deleted).
    grant_app_access("users", "SELECT, INSERT, UPDATE")
    enable_user_rls("resumes")


def downgrade() -> None:
    disable_user_rls("resumes")
    revoke_app_access("users")
    # The role is shared across databases on the server, so it is left in place.
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {APP_ROLE}")
