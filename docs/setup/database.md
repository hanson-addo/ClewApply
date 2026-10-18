# Database roles and row-level security

Clew's API never connects to Postgres as the role that owns the tables. Two roles are used:

| Role | Used by | Can |
| --- | --- | --- |
| Owner (`clew` locally) | Migrations (`CLEW_MIGRATIONS_DATABASE_URL`) | Create and change tables |
| `clew_app` | The API (`CLEW_DATABASE_URL`) | Read and write rows it's been granted; can't bypass row-level security |

Per-user tables (`resumes` today; profiles, applications and sensitive answers as they're added) have row-level security turned on. A row is visible only when its `user_id` matches `app.user_id`, which the API sets for each transaction from the signed-in user. If a route forgets its own `WHERE user_id = ...`, the database still returns only that user's rows (threat model R1).

`users` itself has no row policy: sign-in has to find an account by its Clerk id before anyone is bound.

## Adding a per-user table

In the table's migration, call `enable_user_rls("<table>")` from `clew.db.rls`. It grants `clew_app` access, turns on and forces row-level security, and adds the policy. `tests/test_row_security.py` fails for any table with a `user_id` column that skips it.

Tables that aren't per user (such as a shared job catalog) call `grant_app_access("<table>", "SELECT")` with only the privileges the API needs.

## Local

`docker compose up` creates `clew_app` with password `clew_app` the first time the Postgres volume is made (`docker/postgres/10-app-role.sql`). On an older volume, run the migrations (they create the role without a login), then this once:

```sh
docker compose exec postgres psql -U clew -c "ALTER ROLE clew_app LOGIN PASSWORD 'clew_app'"
```

## Production (Render)

Do this once, as the database owner, after the first migration has run:

```sql
ALTER ROLE clew_app LOGIN PASSWORD '<a long random password>';
```

Then set two env vars in the host's settings only, never in code, issues or chat:

- `CLEW_MIGRATIONS_DATABASE_URL`: the owner's connection URL, used by the migration step only.
- `CLEW_DATABASE_URL`: the same database with user `clew_app` and that password.

In production, the API checks its role at startup. It refuses to start if the role is a superuser, has `BYPASSRLS`, or owns any table.
