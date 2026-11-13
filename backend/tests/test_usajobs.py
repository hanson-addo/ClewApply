"""Federal jobs from the USAJobs Search API (#18). The fixtures are made-up pages shaped like
the API's answers; no test calls the real API."""

import copy
import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.catalog.boards import MAX_BOARD_BYTES
from clew.catalog.usajobs import (
    PAGE_PAUSE_SECONDS,
    UsajobsUnavailable,
    client_headers,
    fetch_page,
    page_items,
    poll_usajobs,
    retry_wait,
    to_posting,
)
from clew.config import Settings
from clew.models import Job, JobSource, RawPosting
from clew.worker import WorkerSettings, read_usajobs

FIXTURES = Path(__file__).parent / "fixtures" / "usajobs"
NOW = datetime(2026, 11, 13, 7, 0, tzinfo=UTC)


def fixture(page: int) -> Any:
    return json.loads((FIXTURES / f"page{page}.json").read_text())


def fresh_pages() -> list[Any]:
    """Both fixture pages with ids and links no other test uses."""
    base = uuid.uuid4().int % 10**9
    pages = [fixture(1), fixture(2)]
    for page in pages:
        for item in page["SearchResult"]["SearchResultItems"]:
            new_id = str(base + int(item["MatchedObjectId"]) % 100)
            item["MatchedObjectId"] = new_id
            job = item["MatchedObjectDescriptor"]
            # A fresh title too, so no other test's job shares the dedup key.
            job["PositionTitle"] = f"{job['PositionTitle']} {base}"
            if job["PositionURI"].startswith("https://"):
                job["PositionURI"] = f"https://www.usajobs.gov/job/{new_id}"
    return pages


def postings(page: int) -> list[Any]:
    items, _ = page_items(fixture(page))
    return [p for item in items if (p := to_posting(item))]


class Sleeps:
    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers=client_headers("made-up-key", "maze.runner@example.com"),
    )


# --- Reading the API's format ----------------------------------------------------------------


def test_reads_us_jobs_and_drops_others() -> None:
    found = postings(1)
    # The job in Germany is left out; the javascript: link is refused later by add_posting.
    assert [p.source_job_id for p in found] == ["900000001", "900000003", "900000004"]
    first = found[0]
    assert first.source == "usajobs"
    assert first.title == "Maze Cartographer"
    assert first.company == "Bureau of Thread Management"
    assert first.location == "Denver, Colorado"
    assert first.url == "https://www.usajobs.gov:443/job/900000001"
    assert first.description == "Map every turn of the maze.\nField work"
    assert first.posted_at == datetime(2026, 11, 1, tzinfo=UTC)
    assert (first.salary_min, first.salary_max) == (70000, 91000)
    assert first.company_id is None


def test_remote_jobs_and_hourly_pay() -> None:
    remote = postings(1)[1]
    assert remote.location == "Remote - Washington, District of Columbia"
    # Hourly pay isn't stored as yearly.
    assert (remote.salary_min, remote.salary_max) == (None, None)
    # No job summary: the qualifications summary stands in.
    assert remote.description == "You must be able to follow a thread."


def test_a_job_in_several_places_shows_the_first() -> None:
    assert postings(2)[0].location == "Austin, Texas"


def test_remote_job_with_no_place_listed() -> None:
    item = fixture(1)["SearchResult"]["SearchResultItems"][2]
    item["MatchedObjectDescriptor"]["PositionLocation"] = []
    posting = to_posting(item)
    assert posting is not None and posting.location == "Remote - US"


@pytest.mark.parametrize(
    "change",
    [
        lambda job: job.pop("PositionTitle"),
        lambda job: job.update(PositionURI=None),
        lambda job: job.update(PositionURI="https://www.usajobs.gov/" + "a" * 2000),
        lambda job: job.update(OrganizationName=None, DepartmentName=" "),
        lambda job: job.update(PositionLocation="Denver"),
    ],
)
def test_jobs_missing_what_the_feed_needs_are_skipped(change: Callable[[Any], Any]) -> None:
    item = copy.deepcopy(fixture(1)["SearchResult"]["SearchResultItems"][0])
    change(item["MatchedObjectDescriptor"])
    assert to_posting(item) is None


def test_unexpected_shapes_give_no_jobs() -> None:
    assert page_items([]) == ([], 0)
    assert page_items({"SearchResult": "nope"}) == ([], 0)
    assert page_items({"SearchResult": {"SearchResultItems": [1, {"a": 1}]}}) == ([{"a": 1}], 1)
    assert to_posting({"MatchedObjectDescriptor": "nope"}) is None
    assert page_items(fixture(1))[1] == 2


# --- Fetching ---------------------------------------------------------------------------------


async def test_fetch_calls_the_fixed_host_with_key_and_email() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=fixture(1))

    async with client_for(handler) as client:
        data = await fetch_page(client, 3, Sleeps())
    assert data == fixture(1)
    (request,) = seen
    assert request.url.host == "data.usajobs.gov"
    assert request.url.path == "/api/search"
    assert dict(request.url.params) == {
        "WhoMayApply": "public",
        "ResultsPerPage": "500",
        "Page": "3",
    }
    assert request.headers["Authorization-Key"] == "made-up-key"
    assert request.headers["User-Agent"] == "maze.runner@example.com"
    assert request.headers["Host"] == "data.usajobs.gov"


async def test_rate_limits_and_server_errors_are_retried_with_backoff() -> None:
    answers = [
        httpx.Response(429, headers={"Retry-After": "5"}),
        httpx.Response(503),
        httpx.Response(200, json=fixture(2)),
    ]
    sleeps = Sleeps()
    async with client_for(lambda _: answers.pop(0)) as client:
        assert await fetch_page(client, 1, sleeps) == fixture(2)
    assert sleeps.calls == [5.0, 4.0]


async def test_gives_up_after_four_tries() -> None:
    sleeps = Sleeps()
    async with client_for(lambda _: httpx.Response(502)) as client:
        with pytest.raises(UsajobsUnavailable, match="status_502"):
            await fetch_page(client, 1, sleeps)
    assert sleeps.calls == [2.0, 4.0, 8.0]


async def test_network_errors_are_retried() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectTimeout("slow", request=request)
        return httpx.Response(200, json=fixture(1))

    async with client_for(handler) as client:
        assert await fetch_page(client, 1, Sleeps()) == fixture(1)
    assert calls == 2


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(401), "status_401"),
        (httpx.Response(200, content=b"<html>not json</html>"), "not_json"),
        (httpx.Response(200, content=b"[" + b" " * (MAX_BOARD_BYTES + 1) + b"]"), "too_large"),
    ],
)
async def test_other_failures_are_not_retried(response: httpx.Response, code: str) -> None:
    sleeps = Sleeps()
    async with client_for(lambda _: response) as client:
        with pytest.raises(UsajobsUnavailable, match=code):
            await fetch_page(client, 1, sleeps)
    assert sleeps.calls == []


def test_retry_after_is_capped() -> None:
    assert retry_wait(1, "3600") == 60.0
    assert retry_wait(2, "Wed, 21 Oct 2026 07:28:00 GMT") == 4.0
    assert retry_wait(3, None) == 8.0


# --- Reading into the catalog -----------------------------------------------------------------


@pytest.fixture
async def sessions(test_database: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(test_database)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def serving(pages: list[Any], fail_page: int | None = None) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["Page"])
        if page == fail_page:
            return httpx.Response(403)
        return httpx.Response(200, json=pages[page - 1])

    return client_for(handler)


def ids(pages: list[Any]) -> list[str]:
    return [i["MatchedObjectId"] for p in pages for i in p["SearchResult"]["SearchResultItems"]]


async def test_reads_every_page_into_the_catalog(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    pages = fresh_pages()
    sleeps = Sleeps()
    async with serving(pages) as client:
        # Jobs 1 and 3 from page one and job 5 from page two; Germany and javascript: aren't.
        assert await poll_usajobs(sessions, client, now=NOW, sleep=sleeps) == 3
    assert sleeps.calls == [PAGE_PAUSE_SECONDS]

    async with sessions() as session:
        sources = (
            await session.scalars(
                select(JobSource).where(
                    JobSource.source == "usajobs", JobSource.source_job_id.in_(ids(pages))
                )
            )
        ).all()
        assert len(sources) == 3
        assert all(s.last_seen_at == NOW for s in sources)
        jobs = (
            await session.scalars(
                select(Job).where(Job.id.in_([s.job_id for s in sources])).order_by(Job.title)
            )
        ).all()
        assert [j.title.split(" ")[0] for j in jobs] == ["Maze", "Remote", "Thread"]
        raw = await session.scalar(
            select(func.count()).where(
                RawPosting.source == "usajobs", RawPosting.source_job_id.in_(ids(pages))
            )
        )
        assert raw == 3


async def test_reading_again_refreshes_and_keeps_one_raw_copy(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    pages = fresh_pages()
    later = NOW + timedelta(days=1)
    async with serving(pages) as client:
        await poll_usajobs(sessions, client, now=NOW, sleep=Sleeps())
        assert await poll_usajobs(sessions, client, now=later, sleep=Sleeps()) == 3
    async with sessions() as session:
        seen = (
            await session.scalars(
                select(JobSource.last_seen_at).where(
                    JobSource.source == "usajobs", JobSource.source_job_id.in_(ids(pages))
                )
            )
        ).all()
        assert seen == [later] * 3
        raw = await session.scalar(
            select(func.count()).where(
                RawPosting.source == "usajobs", RawPosting.source_job_id.in_(ids(pages))
            )
        )
        assert raw == 3


async def test_a_page_that_fails_keeps_the_pages_before_it(
    sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    pages = fresh_pages()
    async with serving(pages, fail_page=2) as client:
        assert await poll_usajobs(sessions, client, now=NOW, sleep=Sleeps()) == 2
    errors = [r.__dict__["error"] for r in caplog.records if r.message == "usajobs_unavailable"]
    assert errors == ["status_403"]
    # Logs carry codes only: never the key or a job's content.
    assert not any("made-up-key" in r.getMessage() + str(r.__dict__) for r in caplog.records)


# --- Settings and the worker ------------------------------------------------------------------


def test_usajobs_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
    monkeypatch.setenv("CLEW_ENV", "test")
    monkeypatch.setenv("CLEW_USAJOBS_API_KEY", "")
    monkeypatch.setenv("CLEW_USAJOBS_EMAIL", "")
    blank = Settings(_env_file=None)
    assert (blank.usajobs_api_key, blank.usajobs_email) == (None, None)

    monkeypatch.setenv("CLEW_USAJOBS_API_KEY", "made-up-key")
    monkeypatch.setenv("CLEW_USAJOBS_EMAIL", "maze.runner@example.com")
    settings = Settings(_env_file=None)
    assert settings.usajobs_api_key is not None
    assert settings.usajobs_api_key.get_secret_value() == "made-up-key"
    assert "made-up-key" not in repr(settings)

    monkeypatch.setenv("CLEW_USAJOBS_EMAIL", "maze.runner@example.com\r\nX-Evil: 1")
    with pytest.raises(ValidationError, match="one email address"):
        Settings(_env_file=None)


async def test_worker_skips_usajobs_without_a_key(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="clew.worker")
    called = False

    async def fake_poll(*args: Any, **kwargs: Any) -> int:
        nonlocal called
        called = True
        return 0

    monkeypatch.setattr("clew.worker.poll_usajobs", fake_poll)
    monkeypatch.setattr(
        "clew.worker.get_settings",
        lambda: Settings(_env_file=None, database_url="postgresql+asyncpg://u:p@h/db", env="test"),
    )
    await read_usajobs({})
    assert not called
    assert any(r.message == "usajobs_not_configured" for r in caplog.records)


def test_usajobs_runs_daily_before_jobs_are_closed() -> None:
    jobs = {job.name: job for job in WorkerSettings.cron_jobs}
    usajobs = next(job for job in WorkerSettings.cron_jobs if job.coroutine is read_usajobs)
    closing = next(job for name, job in jobs.items() if "close_jobs" in name)
    assert (usajobs.hour, usajobs.minute) == (7, 0)
    assert usajobs.hour < closing.hour
    assert usajobs.timeout_s == 60 * 60
