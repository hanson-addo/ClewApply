"""Deleting an account (#31): a function the API calls to remove the signed-in user, and a log.

The API's role can't delete from `users`, nor from append-only tables such as
`profile_versions` and `ai_consent_events`. `delete_current_account` runs as the table owner,
deletes only the user bound to the transaction (`app.user_id`), and every per-user table
follows through its ON DELETE CASCADE foreign key. `account_deletions` keeps that a deletion
happened and when, with nothing that identifies the person.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from clew.db.rls import APP_ROLE, CURRENT_USER_ID

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_deletions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.Column("resume_files_deleted", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_account_deletions"),
    )
    # No grants on account_deletions: only the function below writes it.
    # The f-string only interpolates a constant from clew.db.rls, never input.
    op.execute(
        f"""
        CREATE FUNCTION delete_current_account(resume_files_deleted integer)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog, public
        AS $$
        DECLARE
            target uuid := {CURRENT_USER_ID};
        BEGIN
            IF target IS NULL THEN
                RAISE EXCEPTION 'no user is bound to this transaction';
            END IF;
            DELETE FROM public.users WHERE id = target;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'the bound user does not exist';
            END IF;
            INSERT INTO public.account_deletions (resume_files_deleted)
            VALUES (resume_files_deleted);
        END
        $$
        """  # noqa: S608
    )
    op.execute("REVOKE ALL ON FUNCTION delete_current_account(integer) FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION delete_current_account(integer) TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP FUNCTION delete_current_account(integer)")
    op.drop_table("account_deletions")
