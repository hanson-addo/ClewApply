"""Company job boards on Greenhouse, Lever and Ashby (#19). The fixtures are made-up boards
shaped like each ATS's public API; no test calls the real APIs."""

import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.catalog import ingest
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
from clew.catalog.companies import (
    STARTER_BOARDS,
    board_company,
    display_name,
    ensure_starter_boards,
)
from clew.catalog.ingest import POLL_EVERY, boards_due, poll_board, poll_due_boards
from clew.catalog.merge import InvalidPosting, Posting, add_posting
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


@pytest.mark.parametrize(
    "token", ["../admin", "a/b", "evil.example.com/x?", "", "-x", "a b", "labyrinth\n"]
)
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
    sessions: async_sessionmaker[AsyncSession],
    ats: str,
    name: str | None = None,
    *,
    slug: str | None = None,
    verified: bool = False,
) -> Company:
    async with sessions() as session:
        company = await board_company(
            session,
            ats,  # type: ignore[arg-type]
            slug or token(),
            name,
            verified=verified,
        )
        await session.commit()
        return company


def serving(ats: str, data: Any | None = None) -> httpx.AsyncClient:
    body = fixture(ats) if data is None else data
    return client_for(lambda _: httpx.Response(200, json=body))


async def test_polling_adds_listed_us_jobs(sessions: async_sessionmaker[AsyncSession]) -> None:
    company = await new_board(sessions, "greenhouse", f"Labyrinth {uuid.uuid4().hex[:6]}")
    async with serving("greenhouse", fresh_greenhouse_jobs()) as client:
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
        assert raw is not None and raw >= 2
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


def fresh_greenhouse_jobs() -> Any:
    """The Greenhouse fixture with job ids no other test uses."""
    data = fixture("greenhouse")
    base = uuid.uuid4().int % 10**12
    for offset, job in enumerate(data["jobs"]):
        job["id"] = base + offset
        if job["absolute_url"].startswith("https://"):
            job["absolute_url"] = f"https://boards.greenhouse.io/labyrinth/jobs/{base + offset}"
    return data


async def test_one_odd_job_is_skipped_and_the_rest_are_kept(
    sessions: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_for_maze_mapper(
        session: AsyncSession, posting: Posting, now: datetime | None = None
    ) -> Job:
        if posting.title == "Maze Mapper":
            await session.execute(text("SELECT 1 / 0"))  # a real database error
        return await add_posting(session, posting, now=now)

    monkeypatch.setattr(ingest, "add_posting", failing_for_maze_mapper)
    company = await new_board(sessions, "greenhouse")
    data = fresh_greenhouse_jobs()
    data["jobs"][0]["location"] = "Austin, TX"  # a string where Greenhouse sends an object
    data["jobs"].append({**data["jobs"][3], "id": data["jobs"][3]["id"] + 100})
    data["jobs"][-1]["absolute_url"] = "https://boards.greenhouse.io/labyrinth/jobs/extra"
    async with serving("greenhouse", data) as client:
        assert await poll_board(sessions, client, company, now=NOW) == 1
    failures = [r.__dict__["error"] for r in caplog.records if r.message == "posting_failed"]
    assert sorted(failures) == ["AttributeError", "DBAPIError"]
    async with sessions() as session:
        titles = await session.scalars(select(Job.title).where(Job.company_id == company.id))
        assert list(titles) == ["Exit Planner"]


async def test_one_failing_board_doesnt_stop_the_others(
    sessions: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    broken = await new_board(sessions, "lever")
    working = await new_board(sessions, "lever")

    async def due(session: AsyncSession, now: datetime) -> list[Company]:
        return [broken, working]

    monkeypatch.setattr(ingest, "boards_due", due)

    def handler(request: httpx.Request) -> httpx.Response:
        if str(broken.board_token) in str(request.url):
            raise RuntimeError("unexpected")
        return httpx.Response(200, json=[])

    async with client_for(handler) as client:
        assert await poll_due_boards(sessions, client, now=NOW) == 2
    record = next(r for r in caplog.records if r.message == "board_failed")
    assert record.__dict__["error"] == "RuntimeError"
    async with sessions() as session:
        for company in (broken, working):
            assert (await session.get_one(Company, company.id)).last_polled_at == NOW


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


async def test_a_verified_board_attaches_to_a_company_known_by_name(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    name = f"Minotaur {uuid.uuid4().hex[:6]}"
    async with sessions() as session:
        session.add(Company(name=f"{name}, Inc.", name_norm=name.lower(), verified=True))
        await session.commit()
    company = await new_board(sessions, "greenhouse", name, verified=True)
    assert company.name == f"{name}, Inc."
    assert company.poll is True and company.verified is True


# --- Boards users follow are unverified ---------------------------------------------------------


async def known_company(sessions: async_sessionmaker[AsyncSession]) -> tuple[Company, str]:
    """A verified company known by name, and a board slug whose name matches it."""
    hex6 = uuid.uuid4().hex[:6]
    async with sessions() as session:
        company = Company(name=f"Minotaur {hex6}", name_norm=f"minotaur {hex6}", verified=True)
        session.add(company)
        await session.commit()
    return company, f"minotaur-{hex6}"


async def test_a_followed_board_never_joins_a_company_known_by_name(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    known, slug = await known_company(sessions)
    followed = await new_board(sessions, "lever", slug=slug)
    assert followed.id != known.id
    assert followed.verified is False and followed.poll is True
    async with sessions() as session:
        untouched = await session.get_one(Company, known.id)
        assert (untouched.ats_type, untouched.board_token) == (None, None)


async def test_a_followed_board_never_takes_another_companys_name(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    known, slug = await known_company(sessions)
    followed = await new_board(sessions, "ashby", slug=slug)
    assert followed.name == f"{display_name(slug)} (Ashby board, unverified)"
    assert followed.name_norm != known.name_norm

    hex6 = uuid.uuid4().hex[:6]
    free = await new_board(sessions, "ashby", slug=f"ariadne-{hex6}")
    assert free.name == f"Ariadne {hex6.capitalize()}"
    assert free.name_norm == f"ariadne {hex6} (ashby ariadne-{hex6})"


def listing(company: Company | None, name: str, **values: object) -> Posting:
    fields: dict[str, object] = {
        "source": "lever" if company else "usajobs",
        "source_job_id": uuid.uuid4().hex,
        "url": f"https://jobs.example.com/{uuid.uuid4().hex[:8]}",
        "company": name,
        "title": "Maze Mapper",
        "location": "Austin, TX",
        "company_id": company.id if company else None,
    }
    fields.update(values)
    return Posting(**fields)  # type: ignore[arg-type]


async def primary_links(session: AsyncSession, job: Job) -> list[tuple[str, bool]]:
    rows = await session.execute(
        select(JobSource.source, JobSource.is_primary)
        .where(JobSource.job_id == job.id)
        .order_by(JobSource.first_seen_at)
    )
    return [(source, primary) for source, primary in rows]


async def test_unverified_jobs_never_merge_into_verified_ones(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    known, slug = await known_company(sessions)
    followed = await new_board(sessions, "lever", slug=slug)
    async with sessions() as session:
        real = await add_posting(session, listing(None, known.name), now=NOW)
        fake = await add_posting(
            session, listing(followed, known.name), now=NOW + timedelta(hours=1)
        )
        assert fake.id != real.id
        assert fake.company_id == followed.id
        # The verified job keeps its own Apply link; the lever source didn't join it.
        assert await primary_links(session, real) == [("usajobs", True)]
        assert await primary_links(session, fake) == [("lever", True)]
        await session.rollback()


async def test_an_unverified_board_cant_take_over_another_jobs_listing(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    known, slug = await known_company(sessions)
    verified = await new_board(sessions, "lever", verified=True)
    followed = await new_board(sessions, "lever", slug=slug)
    async with sessions() as session:
        real = listing(verified, known.name)
        await add_posting(session, real, now=NOW)
        with pytest.raises(InvalidPosting, match="listed_by_another_board"):
            await add_posting(session, replace(real, company_id=followed.id), now=NOW)
        await session.rollback()


async def test_a_verified_board_merges_and_becomes_the_apply_link(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    known, _ = await known_company(sessions)
    board_co = await new_board(sessions, "greenhouse", known.name, verified=True)
    assert board_co.id == known.id
    async with sessions() as session:
        job = await add_posting(session, listing(None, known.name), now=NOW)
        same = await add_posting(
            session, listing(board_co, known.name, source="greenhouse"), now=NOW
        )
        assert same.id == job.id
        assert await primary_links(session, job) == [("usajobs", False), ("greenhouse", True)]
        await session.rollback()


async def test_a_followed_board_on_the_starter_list_becomes_verified(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    hex6 = uuid.uuid4().hex[:6]
    slug = f"theseus-{hex6}"
    followed = await new_board(sessions, "greenhouse", slug=slug)
    assert followed.verified is False
    starter = await new_board(
        sessions, "greenhouse", f"Theseus {hex6} Inc.", slug=slug, verified=True
    )
    assert starter.id == followed.id
    assert starter.verified is True
    assert (starter.name, starter.name_norm) == (f"Theseus {hex6} Inc.", f"theseus {hex6}")


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
            starter = await session.scalar(
                select(Company).where(Company.ats_type == ats, Company.board_token == starter_token)
            )
            assert starter is not None and starter.verified is True


def test_worker_polls_boards_hourly() -> None:
    jobs = [job for job in WorkerSettings.cron_jobs if job.coroutine is poll_boards]
    assert len(jobs) == 1
    assert jobs[0].minute == 15
    # A run may take longer than the default job timeout, but finishes before the next one.
    assert jobs[0].timeout_s == 30 * 60
