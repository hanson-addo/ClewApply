"""Counting a user's recent actions for the per-user caps (threat model R26, #64)."""

import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.models import UsageEvent, UsageKind


async def lock_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Holds a per-user lock until the transaction ends, so two requests can't both pass a
    cap check. The same lock as resume parsing uses."""
    await session.execute(select(func.pg_advisory_xact_lock(func.hashtext(str(user_id)))))


async def used_within(
    session: AsyncSession, user_id: uuid.UUID, kind: UsageKind, window: timedelta
) -> int:
    """How many times the user did `kind` in the last `window`."""
    count = await session.scalar(
        select(func.count())
        .select_from(UsageEvent)
        .where(
            UsageEvent.user_id == user_id,
            UsageEvent.kind == kind,
            UsageEvent.created_at > func.now() - window,
        )
    )
    return count or 0
