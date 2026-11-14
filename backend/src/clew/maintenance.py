"""Owner-run upkeep that the API's role isn't allowed to do (threat model R26, #64).

    uv run python -m clew.maintenance prune-profile-versions
    uv run python -m clew.maintenance fetch-jobs   # the worker's job fetches, right now

Connects with CLEW_MIGRATIONS_DATABASE_URL, the role that owns the tables, because the API
role can only read and add profile versions, never delete them.
"""

import argparse
import asyncio
import logging
import uuid
from typing import Any, cast

from sqlalchemy import CursorResult, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.config import get_settings
from clew.db.session import SET_USER_ID
from clew.models import Profile, ProfileVersion, User

logger = logging.getLogger(__name__)


async def prune_profile_versions(sessions: async_sessionmaker[AsyncSession], keep: int) -> int:
    """Deletes each user's profile versions beyond the newest `keep`, never the current one;
    returns how many were deleted.

    profile_versions forces row-level security on its owner too, so only a superuser would
    see every row at once. Each user is pruned in their own transaction with app.user_id
    bound to them, which works for any owner role.
    """
    async with sessions() as session:
        user_ids = list(await session.scalars(select(User.id).order_by(User.id)))
    deleted = 0
    for user_id in user_ids:
        async with sessions() as session:
            await session.execute(SET_USER_ID, {"user_id": str(user_id)})
            deleted += await _prune_user(session, user_id, keep)
            await session.commit()
    logger.info("profile_versions_pruned", extra={"deleted": deleted})
    return deleted


async def _prune_user(session: AsyncSession, user_id: uuid.UUID, keep: int) -> int:
    ranked = (
        select(
            ProfileVersion.id,
            func.row_number().over(order_by=ProfileVersion.number.desc()).label("rank"),
        )
        .where(ProfileVersion.user_id == user_id)
        .subquery()
    )
    current = select(Profile.current_version_id).where(
        Profile.user_id == user_id, Profile.current_version_id.is_not(None)
    )
    result = cast(
        CursorResult[Any],
        await session.execute(
            delete(ProfileVersion).where(
                ProfileVersion.user_id == user_id,
                ProfileVersion.id.in_(select(ranked.c.id).where(ranked.c.rank > keep)),
                ProfileVersion.id.not_in(current),
            )
        ),
    )
    return result.rowcount or 0


async def _run(command: str) -> int:
    if command == "fetch-jobs":
        # The worker does these on a schedule; this runs them now, as the API's own role.
        from clew.worker import poll_boards, read_usajobs

        await poll_boards({})
        await read_usajobs({})
        return 0
    settings = get_settings()
    engine = create_async_engine(settings.migrations_database_url or settings.database_url)
    try:
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        if command == "prune-profile-versions":
            return await prune_profile_versions(sessions, settings.profile_versions_kept)
        raise ValueError(command)  # pragma: no cover - argparse limits the choices
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m clew.maintenance")
    parser.add_argument("command", choices=["prune-profile-versions", "fetch-jobs"])
    args = parser.parse_args(argv)
    count = asyncio.run(_run(args.command))
    print("Done." if args.command == "fetch-jobs" else f"Deleted {count}.")


if __name__ == "__main__":
    main()
