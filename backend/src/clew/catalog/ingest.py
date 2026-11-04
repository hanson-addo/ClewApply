"""Polls followed company boards and adds their jobs to the catalog (#19)."""

import logging
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.catalog.boards import (
    ATS_TYPES,
    Board,
    BoardUnavailable,
    board_jobs,
    fetch_board,
    to_posting,
)
from clew.catalog.merge import InvalidPosting, add_posting
from clew.models import Company, RawPosting

logger = logging.getLogger(__name__)

# A board is read again once this long has passed; the worker checks every hour.
POLL_EVERY = timedelta(hours=6)
# Boards read per worker run, so one run stays short. With hourly runs this keeps up with
# about BOARDS_PER_RUN * 6 = 300 polled boards; past that, polls fall behind POLL_EVERY.
BOARDS_PER_RUN = 50
# Time allowed for one run: each board can take its 20 s fetch timeout and then some.
POLL_RUN_TIMEOUT = timedelta(minutes=30)


async def boards_due(session: AsyncSession, now: datetime) -> list[Company]:
    rows = await session.scalars(
        select(Company)
        .where(
            Company.poll,
            Company.ats_type.in_(ATS_TYPES),
            Company.board_token.is_not(None),
            or_(Company.last_polled_at.is_(None), Company.last_polled_at < now - POLL_EVERY),
        )
        .order_by(Company.last_polled_at.asc().nulls_first())
        .limit(BOARDS_PER_RUN)
    )
    return list(rows)


async def poll_board(
    sessions: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    company: Company,
    now: datetime | None = None,
) -> int:
    """Reads one board and adds its listed US jobs; returns how many were added or seen.
    A board that can't be read is logged by code and tried again next time."""
    seen = now or datetime.now(UTC)
    board = Board(ats=company.ats_type, token=company.board_token, company=company.name)  # type: ignore[arg-type]
    try:
        data = await fetch_board(client, board)
    except BoardUnavailable as error:
        logger.warning(
            "board_unavailable",
            extra={"ats": board.ats, "board": board.token, "error": str(error)},
        )
        async with sessions() as session:
            await _mark_polled(session, company, seen)
            await session.commit()
        return 0

    count = 0
    async with sessions() as session:
        for job in board_jobs(board, data):
            # A savepoint per job, so one bad job (an odd shape, a value too long for its
            # column) is skipped without losing the board's other jobs.
            try:
                async with session.begin_nested():
                    added = await _add_job(session, board, company, job, seen)
            except InvalidPosting as error:
                logger.info(
                    "posting_skipped",
                    extra={"ats": board.ats, "board": board.token, "error": str(error)},
                )
                continue
            except Exception as error:
                # Board JSON is outside input. Log the kind of failure only, never content.
                logger.warning(
                    "posting_failed",
                    extra={"ats": board.ats, "board": board.token, "error": type(error).__name__},
                )
                continue
            count += added
        await _mark_polled(session, company, seen)
        await session.commit()
    logger.info("board_polled", extra={"ats": board.ats, "board": board.token, "jobs": count})
    return count


async def _add_job(
    session: AsyncSession, board: Board, company: Company, job: Any, seen: datetime
) -> int:
    posting = to_posting(board, job)
    if posting is None:
        return 0
    posting = replace(posting, company_id=company.id)
    # Public board JSON only: no user data goes in raw_postings.
    session.add(
        RawPosting(
            source=board.ats, source_job_id=posting.source_job_id, payload=job, fetched_at=seen
        )
    )
    await add_posting(session, posting, now=seen)
    return 1


async def _mark_polled(session: AsyncSession, company: Company, seen: datetime) -> None:
    await session.execute(
        update(Company).where(Company.id == company.id).values(last_polled_at=seen)
    )


async def poll_due_boards(
    sessions: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    now: datetime | None = None,
) -> int:
    """Polls every board that is due; returns how many boards were read."""
    seen = now or datetime.now(UTC)
    async with sessions() as session:
        due = await boards_due(session, seen)
    for company in due:
        try:
            await poll_board(sessions, client, company, now=seen)
        except Exception as error:
            # One failing board must not stop the rest. Marked polled, it goes to the back
            # of the queue and is tried again after POLL_EVERY.
            logger.warning(
                "board_failed",
                extra={
                    "ats": company.ats_type,
                    "board": company.board_token,
                    "error": type(error).__name__,
                },
            )
            async with sessions() as session:
                await _mark_polled(session, company, seen)
                await session.commit()
    return len(due)
