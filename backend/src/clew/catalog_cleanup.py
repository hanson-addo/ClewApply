"""Deletes raw postings older than 30 days. The worker runs it once a day."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.models import RawPosting
from clew.models.catalog import RAW_POSTING_DAYS

logger = logging.getLogger(__name__)


async def delete_old_raw_postings(
    sessions: async_sessionmaker[AsyncSession], now: datetime | None = None
) -> int:
    """Deletes raw postings fetched more than RAW_POSTING_DAYS ago; returns how many."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=RAW_POSTING_DAYS)
    async with sessions() as session:
        result = cast(
            CursorResult[Any],
            await session.execute(delete(RawPosting).where(RawPosting.fetched_at < cutoff)),
        )
        await session.commit()
    deleted = result.rowcount or 0
    logger.info("raw_postings_cleaned", extra={"deleted": deleted})
    return deleted
