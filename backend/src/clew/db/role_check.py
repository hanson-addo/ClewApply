"""Startup guard: row-level security only protects anything if the API's role can't skip it."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

ROLE_FACTS = text(
    """
    SELECT r.rolsuper, r.rolbypassrls,
           (SELECT count(*) FROM pg_tables t
             WHERE t.schemaname = 'public'
               -- Membership in the owner role counts: it carries the owner's rights.
               AND pg_has_role(current_user, t.tableowner, 'USAGE')) AS owned_tables
      FROM pg_roles r
     WHERE r.rolname = current_user
    """
)


async def app_role_problems(engine: AsyncEngine) -> list[str]:
    """Why the connected role could bypass row-level security; empty when it's safe."""
    async with engine.connect() as conn:
        is_super, bypasses_rls, owned_tables = (await conn.execute(ROLE_FACTS)).one()
    problems = []
    if is_super:
        problems.append("is a superuser")
    if bypasses_rls:
        problems.append("has BYPASSRLS")
    if owned_tables:
        problems.append("owns tables or is a member of their owner")
    return problems
