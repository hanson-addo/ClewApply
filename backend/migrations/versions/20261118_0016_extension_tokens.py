"""Browser extension sign-in (#130): one-time link codes and scoped extension tokens.

Both tables hold only SHA-256 hashes. Besides the usual owner-only policy, each has a policy
that shows (and lets the API update) the one row whose hash is bound to the transaction as
`app.extension_hash`. That is how the API finds a link code or a token before it knows whose
it is, without being able to see or touch any other row. The API may only change the columns
that mark a code used, or a token used, extended or revoked.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import disable_user_rls, enable_user_rls

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BOUND_HASH = "NULLIF(current_setting('app.extension_hash', true), '')"


def _by_hash_policies(table: str, column: str) -> None:
    # The f-strings only interpolate constants from this file, never input.
    match = f"{column} = {BOUND_HASH}"
    op.execute(f"CREATE POLICY {table}_by_hash_select ON {table} FOR SELECT USING ({match})")
    op.execute(
        f"CREATE POLICY {table}_by_hash_update ON {table} FOR UPDATE "
        f"USING ({match}) WITH CHECK ({match})"
    )


def _drop_by_hash_policies(table: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {table}_by_hash_select ON {table}")
    op.execute(f"DROP POLICY IF EXISTS {table}_by_hash_update ON {table}")


def _common() -> list[sa.Column[object]]:
    uuid = postgresql.UUID(as_uuid=True)
    return [
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "extension_link_codes",
        *_common(),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_extension_link_codes_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_extension_link_codes"),
        sa.UniqueConstraint("code_hash", name="uq_extension_link_codes_code_hash"),
    )
    op.create_index("ix_extension_link_codes_user_id", "extension_link_codes", ["user_id"])
    enable_user_rls("extension_link_codes", "SELECT, INSERT, UPDATE (used_at)")
    _by_hash_policies("extension_link_codes", "code_hash")

    op.create_table(
        "extension_tokens",
        *_common(),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_extension_tokens_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_extension_tokens"),
        sa.UniqueConstraint("token_hash", name="uq_extension_tokens_token_hash"),
    )
    op.create_index("ix_extension_tokens_user_id", "extension_tokens", ["user_id"])
    enable_user_rls(
        "extension_tokens", "SELECT, INSERT, UPDATE (last_used_at, expires_at, revoked_at)"
    )
    _by_hash_policies("extension_tokens", "token_hash")


def downgrade() -> None:
    for table in ("extension_tokens", "extension_link_codes"):
        _drop_by_hash_policies(table)
        disable_user_rls(table)
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        op.drop_table(table)
