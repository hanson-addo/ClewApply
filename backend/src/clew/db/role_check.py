"""Startup guard: row-level security only protects anything if the API's role can't skip it."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

# pg_has_role(..., 'MEMBER') includes the role itself and every role it can inherit from or
# SET ROLE to, since membership carries that role's rights.
ROLE_FACTS = text(
    """
    SELECT coalesce(bool_or(r.rolsuper), false),
           coalesce(bool_or(r.rolbypassrls), false),
           (SELECT count(*) FROM pg_tables t
             WHERE t.schemaname = 'public'
               AND pg_has_role(current_user, t.tableowner, 'MEMBER')) AS owned_tables
      FROM pg_roles r
     WHERE pg_has_role(current_user, r.oid, 'MEMBER')
    """
)


async def app_role_problems(engine: AsyncEngine) -> list[str]:
    """Why the connected role could bypass row-level security; empty when it's safe."""
    async with engine.connect() as conn:
        is_super, bypasses_rls, owned_tables = (await conn.execute(ROLE_FACTS)).one()
    problems = []
    if is_super:
        problems.append("is or can become a superuser")
    if bypasses_rls:
        problems.append("has or can assume BYPASSRLS")
    if owned_tables:
        problems.append("owns tables or is a member of their owner")
    return problems
