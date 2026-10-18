"""Background job queue (arq on Redis). Jobs carry ids only, never user content."""

import asyncio
import logging
import uuid
from functools import lru_cache
from typing import Protocol

from arq.connections import ArqRedis, RedisSettings, create_pool
from redis.exceptions import RedisError

from clew.config import get_settings

logger = logging.getLogger(__name__)

PARSE_RESUME = "parse_resume"


class QueueUnavailable(Exception):
    """Redis couldn't be reached, so the job wasn't queued."""


class JobQueue(Protocol):
    async def enqueue_parse(self, parse_id: uuid.UUID, user_id: uuid.UUID) -> None: ...


class ArqJobQueue:
    def __init__(self, redis_url: str) -> None:
        self._settings = RedisSettings.from_dsn(redis_url)
        self._pool: ArqRedis | None = None
        self._lock = asyncio.Lock()

    async def _get_pool(self) -> ArqRedis:
        async with self._lock:
            if self._pool is None:
                # One quick attempt: a request shouldn't hang while Redis is down.
                self._settings.conn_retries = 0
                self._pool = await create_pool(self._settings)
            return self._pool

    async def enqueue_parse(self, parse_id: uuid.UUID, user_id: uuid.UUID) -> None:
        try:
            pool = await self._get_pool()
            await pool.enqueue_job(PARSE_RESUME, str(parse_id), str(user_id))
        except (RedisError, OSError) as exc:
            logger.error("queue_unavailable", extra={"error": type(exc).__name__})
            raise QueueUnavailable from exc


@lru_cache
def get_job_queue() -> JobQueue | None:
    redis_url = get_settings().redis_url
    return ArqJobQueue(redis_url) if redis_url else None
