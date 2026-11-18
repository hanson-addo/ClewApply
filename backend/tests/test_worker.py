import uuid
from typing import Any, cast

import pytest
from arq.worker import get_kwargs
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from clew import worker
from clew.jobs import PARSE_RESUME
from clew.models import Company, Job
from clew.worker import (
    MAX_TRIES,
    EndToEndWorkerSettings,
    WorkerSettings,
    catalog_is_empty,
    fill_empty_catalog,
    parse_resume,
)


def test_worker_runs_the_job_the_queue_sends() -> None:
    assert parse_resume.__name__ == PARSE_RESUME
    assert parse_resume in WorkerSettings.functions
    assert WorkerSettings.max_tries == MAX_TRIES


def test_the_end_to_end_worker_runs_queued_jobs_but_nothing_on_a_schedule() -> None:
    # Read the settings the way arq does: it sees only the class's own attributes.
    e2e: dict[str, Any] = dict(get_kwargs(cast(Any, EndToEndWorkerSettings)))
    full: dict[str, Any] = dict(get_kwargs(cast(Any, WorkerSettings)))
    assert e2e["cron_jobs"] == []
    assert full["cron_jobs"]
    differs = {"cron_jobs", "functions", "on_startup"}
    assert {k: v for k, v in e2e.items() if k not in differs} == {
        k: v for k, v in full.items() if k not in differs
    }
    assert e2e["functions"] == [parse_resume]
    assert e2e["on_startup"] is None
    assert full["on_startup"] is fill_empty_catalog
    assert e2e["max_tries"] == MAX_TRIES


class FakeRedis:
    def __init__(self) -> None:
        self.queued: list[tuple[str, str]] = []

    async def enqueue_job(self, name: str, *, _job_id: str) -> None:
        self.queued.append((name, _job_id))


async def test_a_first_start_with_no_jobs_fetches_them_at_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def empty() -> bool:
        return True

    monkeypatch.setattr(worker, "catalog_is_empty", empty)
    redis = FakeRedis()
    await fill_empty_catalog({"redis": redis})
    assert redis.queued == [
        ("poll_boards", "first-fill:poll_boards"),
        ("read_usajobs", "first-fill:read_usajobs"),
    ]
    # Both can be queued by name, with the scheduled runs' time limits.
    names = {getattr(f, "name", getattr(f, "__name__", None)) for f in WorkerSettings.functions}
    assert {"poll_boards", "read_usajobs"} <= names


async def test_a_start_with_jobs_already_in_waits_for_the_schedule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def full() -> bool:
        return False

    monkeypatch.setattr(worker, "catalog_is_empty", full)
    redis = FakeRedis()
    await fill_empty_catalog({"redis": redis})
    assert redis.queued == []


async def test_the_worker_role_sees_jobs_when_checking_for_an_empty_catalog(
    db: AsyncSession,
) -> None:
    tag = uuid.uuid4().hex[:8]
    company = Company(name=f"Minotaur Labs {tag}", name_norm=f"minotaur labs {tag}", verified=True)
    db.add(company)
    await db.flush()
    db.add(
        Job(title="Maze Designer", title_norm="maze designer", company_id=company.id, dedup_key=tag)
    )
    await db.commit()
    try:
        assert await catalog_is_empty() is False
    finally:
        await db.execute(delete(Job).where(Job.company_id == company.id))
        await db.execute(delete(Company).where(Company.id == company.id))
        await db.commit()
