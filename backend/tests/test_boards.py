"""Company job boards on Greenhouse, Lever and Ashby (#19). The fixtures are made-up boards
shaped like each ATS's public API; no test calls the real APIs."""

import json
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.catalog.boards import (
    MAX_BOARD_BYTES,
    Board,
    BoardUnavailable,
    board_jobs,
    board_url,
    fetch_board,
    in_us,
    plain_text,
    to_posting,
)
from clew.catalog.companies import STARTER_BOARDS, board_company, ensure_starter_boards
from clew.catalog.ingest import POLL_EVERY, boards_due, poll_board, poll_due_boards
from clew.models import Company, Job, JobSource, RawPosting
from clew.worker import WorkerSettings, poll_boards

FIXTURES = Path(__file__).parent / "fixtures" / "boards"
NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)


def fixture(ats: str) -> Any:
    return json.loads((FIXTURES / f"{ats}.json").read_text())


def board(ats: str, slug: str = "labyrinthlogistics") -> Board:
    return Board(ats=ats, token=slug, company="Labyrinth Logistics")  # type: ignore[arg-type]


def postings(ats: str) -> list[Any]:
    b = board(ats)
    return [p for job in board_jobs(b, fixture(ats)) if (p := to_posting(b, job))]


# --- Reading each ATS's format --------------------------------------------------------------


def test_greenhouse_jobs() -> None:
    found = postings("greenhouse")
    # London is outside the US; the javascript: link is dropped later by add_posting.
    assert [p.source_job_id for p in found] == ["4001001", "4001002", "4001004"]
    first = found[0]
    assert first.title == "Sr. Thread Engineer"
    assert first.location == "Austin, TX"
    assert first.url == "https://boards.greenhouse.io/labyrinthlogistics/jobs/4001001"
    assert first.description == "Wind thread through the maze.\nMaps\nKnots & loops"
    assert first.posted_at == datetime(2026, 10, 28, 13, 0, tzinfo=UTC)
    assert first.company == "Labyrinth Logistics"


def test_lever_jobs() -> None:
    found = postings("lever")
    # Toronto is outside the US.
    assert [p.title for p in found] == ["Labyrinth Guide", "Knot Specialist"]
    guide, knots = found
    assert guide.location == "Hybrid - Denver, CO"
    assert (guide.salary_min, guide.salary_max) == (70000, 90000)
    assert guide.posted_at == datetime.fromtimestamp(1761900000, UTC)
    assert knots.location == "Remote - Anywhere"
    # Pay in euros isn't stored as dollars.
    assert (knots.salary_min, knots.salary_max) == (None, None)


def test_ashby_jobs() -> None:
    found = postings("ashby")
    # Unlisted jobs and jobs in Germany are left out.
    assert [p.title for p in found] == ["Senior Software Engineer"]
    assert found[0].url.startswith("https://jobs.ashbyhq.com/labyrinthlogistics/")
    assert found[0].description == "Build the maze map."


def test_jobs_missing_a_title_link_or_id_are_skipped() -> None:
    b = board("greenhouse")
    base = {"id": 1, "title": "Guide", "location": {"name": "Austin, TX"}}
    assert to_posting(b, {**base, "absolute_url": "https://x.example.com/1"}) is not None
    assert to_posting(b, base) is None
    assert to_posting(b, {**base, "absolute_url": "https://x.example.com/1", "title": " "}) is None
    assert to_posting(b, {**base, "absolute_url": "https://x.example.com/1", "id": None}) is None
    long_url = "https://x.example.com/" + "a" * 2000
    assert to_posting(b, {**base, "absolute_url": long_url}) is None


def test_unexpected_shapes_give_no_jobs() -> None:
    b = board("greenhouse")
    assert board_jobs(b, {"jobs": "nope"}) == []
    assert board_jobs(b, {"other": []}) == []
    assert board_jobs(b, [1, "two", {"id": 3}]) == [{"id": 3}]


@pytest.mark.parametrize(
    ("location", "country", "expected"),
    [
        ("Austin, TX", None, True),
        ("Remote - US", None, True),
        ("Remote", None, True),
        ("Anywhere", None, True),
        ("United States", None, True),
        ("Remote - Canada", None, False),
        ("London, United Kingdom", None, False),
        ("Toronto, ON", None, False),
        ("", None, False),
        (None, None, False),
        ("Berlin", "Germany", False),
        ("Somewhere", "US", True),
        ("Austin, TX", "Mexico", False),
    ],
)
def test_us_only(location: str | None, country: str | None, expected: bool) -> None:
    assert in_us(location, country) is expected


def test_plain_text_never_keeps_html() -> None:
    assert plain_text("<script>alert(1)</script><p>Hi&nbsp;there</p>") == "alert(1)Hi\xa0there"
    assert plain_text("&lt;b&gt;Bold&lt;/b&gt;", escaped=True) == "Bold"
    assert plain_text("") is None
    assert plain_text("x" * 30_000) == "x" * 20_000


# --- Fetching ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ats", "url"),
    [
        (
            "greenhouse",
            "https://boards-api.greenhouse.io/v1/boards/labyrinthlogistics/jobs?content=true",
        ),
        ("lever", "https://api.lever.co/v0/postings/labyrinthlogistics?mode=json"),
        (
            "ashby",
            "https://api.ashbyhq.com/posting-api/job-board/labyrinthlogistics"
            "?includeCompensation=true",
        ),
    ],
)
def test_board_urls(ats: str, url: str) -> None:
    assert board_url(ats, "labyrinthlogistics") == url  # type: ignore[arg-type]


@pytest.mark.parametrize("token", ["../admin", "a/b", "evil.example.com/x?", "", "-x", "a b"])
def test_tokens_cant_change_the_path(token: str) -> None:
    with pytest.raises(ValueError, match="bad_board_token"):
        board_url("greenhouse", token)


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_fetch_reads_json() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=fixture("lever"))

    async with client_for(handler) as client:
        data = await fetch_board(client, board("lever"))
    assert isinstance(data, list) and len(data) == 3
    assert seen == ["https://api.lever.co/v0/postings/labyrinthlogistics?mode=json"]


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(404), "not_found"),
        (httpx.Response(503), "status_503"),
        (httpx.Response(200, content=b"<html>not json</html>"), "not_json"),
        (httpx.Response(200, json="just a string"), "not_json"),
        (httpx.Response(200, content=b"[" + b" " * (MAX_BOARD_BYTES + 1) + b"]"), "too_large"),
    ],
)
async def test_fetch_failures(response: httpx.Response, code: str) -> None:
    async with client_for(lambda _: response) as client:
        with pytest.raises(BoardUnavailable, match=code):
            await fetch_board(client, board("greenhouse"))


async def test_network_errors_are_board_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow", request=request)

    async with client_for(handler) as client:
        with pytest.raises(BoardUnavailable, match="ConnectTimeout"):
            await fetch_board(client, board("ashby"))


# --- Polling into the catalog -----------------------------------------------------------------


@pytest.fixture
async def sessions(test_database: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(test_database)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def token() -> str:
    return f"labyrinth{uuid.uuid4().hex[:8]}"


async def new_board(
    sessions: async_sessionmaker[AsyncSession], ats: str, name: str | None = None
) -> Company:
    async with sessions() as session:
        company = await board_company(session, ats, token(), name)  # type: ignore[arg-type]
        await session.commit()
        return company


def serving(ats: str, data: Any | None = None) -> httpx.AsyncClient:
    body = fixture(ats) if data is None else data
    return client_for(lambda _: httpx.Response(200, json=body))


async def test_polling_adds_listed_us_jobs(sessions: async_sessionmaker[AsyncSession]) -> None:
    company = await new_board(sessions, "greenhouse", f"Labyrinth {uuid.uuid4().hex[:6]}")
    async with serving("greenhouse") as client:
        # Two US jobs; the javascript: link is refused.
        assert await poll_board(sessions, client, company, now=NOW) == 2

    async with sessions() as session:
        jobs = (
            await session.scalars(
                select(Job).where(Job.company_id == company.id).order_by(Job.title)
            )
        ).all()
        assert [j.title for j in jobs] == ["Maze Mapper", "Sr. Thread Engineer"]
        links = await session.scalars(
            select(JobSource.is_primary).where(JobSource.job_id.in_([j.id for j in jobs]))
        )
        assert list(links) == [True, True]
        raw = await session.scalar(
            select(func.count()).where(
                RawPosting.source == "greenhouse", RawPosting.fetched_at == NOW
            )
        )
        assert raw is not None and raw >= 3
        polled = await session.get_one(Company, company.id)
        assert polled.last_polled_at == NOW


async def test_polling_again_refreshes_instead_of_duplicating(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    company = await new_board(sessions, "ashby", f"Labyrinth {uuid.uuid4().hex[:6]}")
    async with serving("ashby") as client:
        await poll_board(sessions, client, company, now=NOW)
        await poll_board(sessions, client, company, now=NOW + timedelta(hours=7))
    async with sessions() as session:
        sources = (
            await session.scalars(
                select(JobSource)
                .join(Job, Job.id == JobSource.job_id)
                .where(Job.company_id == company.id)
            )
        ).all()
        assert len(sources) == 1
        assert sources[0].last_seen_at == NOW + timedelta(hours=7)


async def test_a_missing_board_is_marked_polled_and_logged(
    sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    company = await new_board(sessions, "lever")
    async with client_for(lambda _: httpx.Response(404)) as client:
        assert await poll_board(sessions, client, company, now=NOW) == 0
    record = next(r for r in caplog.records if r.message == "board_unavailable")
    assert record.__dict__["error"] == "not_found"
    async with sessions() as session:
        assert (await session.get_one(Company, company.id)).last_polled_at == NOW


async def test_only_due_boards_are_polled(sessions: async_sessionmaker[AsyncSession]) -> None:
    fresh = await new_board(sessions, "lever")
    stale = await new_board(sessions, "lever")
    async with sessions() as session:
        (await session.get_one(Company, fresh.id)).last_polled_at = NOW - timedelta(hours=1)
        (await session.get_one(Company, stale.id)).last_polled_at = NOW - POLL_EVERY * 2
        await session.commit()
        due = {c.id for c in await boards_due(session, NOW)}
    assert stale.id in due
    assert fresh.id not in due

    async with serving("lever", []) as client:
        assert await poll_due_boards(sessions, client, now=NOW) >= 1
    async with sessions() as session:
        assert (await session.get_one(Company, stale.id)).last_polled_at == NOW
        assert (await session.get_one(Company, fresh.id)).last_polled_at == NOW - timedelta(hours=1)


async def test_a_board_attaches_to_a_company_known_by_name(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    name = f"Minotaur {uuid.uuid4().hex[:6]}"
    async with sessions() as session:
        session.add(Company(name=f"{name}, Inc.", name_norm=name.lower()))
        await session.commit()
    company = await new_board(sessions, "greenhouse", name)
    assert company.name == f"{name}, Inc."
    assert company.poll is True


async def test_starter_boards_are_seeded_once(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with sessions() as session:
        await ensure_starter_boards(session)
        await ensure_starter_boards(session)
        await session.commit()
        for ats, starter_token, _ in STARTER_BOARDS:
            count = await session.scalar(
                select(func.count()).where(
                    Company.ats_type == ats, Company.board_token == starter_token, Company.poll
                )
            )
            assert count == 1


def test_worker_polls_boards_hourly() -> None:
    jobs = [job for job in WorkerSettings.cron_jobs if job.coroutine is poll_boards]
    assert len(jobs) == 1
    assert jobs[0].minute == 15
