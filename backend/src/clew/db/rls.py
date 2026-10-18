"""Row-level security helpers for migrations.

The API connects as `clew_app`, which doesn't own any table and can't bypass row security.
Each request binds the signed-in user's id to the transaction as `app.user_id`
(see `clew.db.session.bind_user`), and per-user tables only show rows whose `user_id` matches.
If the id isn't set, they show nothing.

Every new per-user table calls `enable_user_rls` in its migration;
`tests/test_row_security.py` fails for any table with a `user_id` column that doesn't.
"""

from alembic import op

APP_ROLE = "clew_app"

# NULLIF turns an unset setting ("") into NULL, which matches no row.
CURRENT_USER_ID = "NULLIF(current_setting('app.user_id', true), '')::uuid"


def create_app_role() -> None:
    # Roles are shared by every database on the server, so create it only once. NOLOGIN here;
    # the login role the API uses is a member of it (see docs/setup/database.md).
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
            END IF;
        END
        $$
        """
    )
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")


def grant_app_access(table: str, privileges: str = "SELECT, INSERT, UPDATE, DELETE") -> None:
    op.execute(f"GRANT {privileges} ON {table} TO {APP_ROLE}")


def revoke_app_access(table: str) -> None:
    op.execute(f"REVOKE ALL ON {table} FROM {APP_ROLE}")


def enable_user_rls(table: str) -> None:
    """Rows of `table` are visible and writable only for the user bound to the transaction."""
    grant_app_access(table)
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    # FORCE applies the policy to the table owner too; only superusers skip it.
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY {table}_owner_only ON {table} "
        f"USING (user_id = {CURRENT_USER_ID}) "
        f"WITH CHECK (user_id = {CURRENT_USER_ID})"
    )


def disable_user_rls(table: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS {table}_owner_only ON {table}")
    op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    revoke_app_access(table)
