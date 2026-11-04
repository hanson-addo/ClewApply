"""Background worker: `uv run arq clew.worker.WorkerSettings`.

It connects to the database as the app role, like the API, and binds each job's user so
row-level security applies to everything a job reads or writes.
"""

import logging
import uuid
from typing import Any, ClassVar

import httpx
from arq import Retry
from arq.connections import RedisSettings
from arq.cron import cron

from clew.catalog.companies import ensure_starter_boards
from clew.catalog.ingest import POLL_RUN_TIMEOUT, poll_due_boards
from clew.catalog.merge import close_vanished_jobs
from clew.catalog_cleanup import delete_old_raw_postings
from clew.config import get_settings
from clew.db.session import get_sessionmaker
from clew.resumes.parser import get_resume_parser
from clew.resumes.parsing import RetryLater, run_parse
from clew.scanning import get_malware_scanner
from clew.storage import get_object_store

logger = logging.getLogger(__name__)

MAX_TRIES = 4
RETRY_SECONDS = 60


async def parse_resume(ctx: dict[str, Any], parse_id: str, user_id: str) -> None:
    attempt = int(ctx.get("job_try", 1))
    try:
        await run_parse(
            get_sessionmaker(),
            store=get_object_store(),
            scanner=get_malware_scanner(),
            parser=get_resume_parser(),
            parse_id=uuid.UUID(parse_id),
            user_id=uuid.UUID(user_id),
            final_attempt=attempt >= MAX_TRIES,
        )
    except RetryLater:
        raise Retry(defer=RETRY_SECONDS * attempt) from None


async def clean_raw_postings(ctx: dict[str, Any]) -> None:
    await delete_old_raw_postings(get_sessionmaker())


async def close_jobs(ctx: dict[str, Any]) -> None:
    await close_vanished_jobs(get_sessionmaker())


async def poll_boards(ctx: dict[str, Any]) -> None:
    sessions = get_sessionmaker()
    async with sessions() as session:
        await ensure_starter_boards(session)
        await session.commit()
    async with httpx.AsyncClient(headers={"User-Agent": "Clew job feed"}) as client:
        await poll_due_boards(sessions, client)


def _redis_settings() -> RedisSettings:
    url = get_settings().redis_url
    if url is None:
        raise RuntimeError("CLEW_REDIS_URL is required to run the worker")
    return RedisSettings.from_dsn(url)


class WorkerSettings:
    functions: ClassVar[list[Any]] = [parse_resume]
    # Daily, at a quiet hour (UTC).
    cron_jobs: ClassVar[list[Any]] = [
        cron(clean_raw_postings, hour=9, minute=0),
        cron(close_jobs, hour=9, minute=30),
        # Hourly; each board is read again once POLL_EVERY has passed.
        cron(poll_boards, minute=15, timeout=POLL_RUN_TIMEOUT.total_seconds()),
    ]
    max_tries = MAX_TRIES
    job_timeout = 300
    # Results stay in Redis only briefly and hold nothing (the job returns None).
    keep_result = 60
    # Read when the worker starts; the API can import this module without Redis set.
    redis_settings = _redis_settings() if get_settings().redis_url else RedisSettings()
