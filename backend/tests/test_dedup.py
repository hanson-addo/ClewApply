"""Exact-match dedup of job postings (#20). Every company, job and link here is made up."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.catalog.merge import (
    InvalidPosting,
    Posting,
    add_posting,
    close_vanished_jobs,
    source_rank,
)
from clew.catalog.normalize import (
    Location,
    dedup_key,
    normalize_company,
    normalize_title,
    parse_location,
)
from clew.models import Job, JobSource
from clew.worker import WorkerSettings, close_jobs

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Labyrinth Logistics, Inc.", "labyrinth logistics"),
        ("LABYRINTH LOGISTICS LLC", "labyrinth logistics"),
        ("Minotaur & Sons Co.", "minotaur and sons"),
        ("Ariadne Thread Corp", "ariadne thread"),
        ("Inc", "inc"),
    ],
)
def test_normalize_company(name: str, expected: str) -> None:
    assert normalize_company(name) == expected


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Sr. Software Eng.", "senior software engineer"),
        ("Senior Software Engineer (Remote)", "senior software engineer"),
        ("SWE II - Hybrid", "software engineer ii"),
        ("Jr Dev, On-site", "junior developer"),
        ("C++ Developer", "c++ developer"),
        ("VP, Ops", "vice president operations"),
    ],
)
def test_normalize_title(title: str, expected: str) -> None:
    assert normalize_title(title) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Austin, TX", Location("Austin", "TX", "onsite")),
        ("austin, texas", Location("Austin", "TX", "onsite")),
        ("Austin, TX 78701, United States", Location("Austin", "TX", "onsite")),
        ("Austin, TX (Hybrid)", Location("Austin", "TX", "hybrid")),
        ("Hybrid: New York, NY, USA", Location("New York", "NY", "hybrid")),
        ("Winston-Salem, NC", Location("Winston-Salem", "NC", "onsite")),
        ("Remote", Location(None, None, "remote")),
        ("Remote - US", Location(None, None, "remote")),
        ("Anywhere in the United States", Location(None, None, "remote")),
        ("Remote, California", Location(None, "CA", "remote")),
        ("On-site - Denver, CO", Location("Denver", "CO", "onsite")),
        ("Washington, DC", Location("Washington", "DC", "onsite")),
        ("", Location(None, None, None)),
        (None, Location(None, None, None)),
    ],
)
def test_parse_location(text: str | None, expected: Location) -> None:
    assert parse_location(text) == expected


# (company, title, location) pairs. Same job, worded differently:
SAME_JOB = [
    (
        ("Labyrinth Logistics, Inc.", "Sr. Software Engineer", "Austin, TX"),
        ("labyrinth logistics", "Senior Software Engineer", "Austin, Texas"),
    ),
    (
        ("Labyrinth Logistics LLC", "Senior Software Engineer (Remote)", "Remote"),
        ("Labyrinth Logistics", "Senior Software Engineer", "Remote - US"),
    ),
    (
        ("Minotaur & Sons", "Data Analyst", "New York, NY"),
        ("Minotaur and Sons Co.", "Data  Analyst", "New York, NY 10001, United States"),
    ),
    (
        ("Ariadne Thread", "Registered Nurse", "Austin, TX (Hybrid)"),
        ("Ariadne Thread", "Registered Nurse", "Austin, TX"),
    ),
]
# Different jobs that look alike:
DIFFERENT_JOBS = [
    (
        ("Labyrinth Logistics", "Software Engineer", "Austin, TX"),
        ("Labyrinth Logistics", "Software Engineer", "Denver, CO"),
    ),
    (
        ("Labyrinth Logistics", "Software Engineer", "Austin, TX"),
        ("Minotaur & Sons", "Software Engineer", "Austin, TX"),
    ),
    (
        ("Labyrinth Logistics", "Software Engineer", "Austin, TX"),
        ("Labyrinth Logistics", "Senior Software Engineer", "Austin, TX"),
    ),
    (
        ("Labyrinth Logistics", "Software Engineer II", "Remote"),
        ("Labyrinth Logistics", "Software Engineer III", "Remote"),
    ),
    (
        ("Labyrinth Logistics", "Software Engineer", "Remote"),
        ("Labyrinth Logistics", "Software Engineer", "Austin, TX"),
    ),
    (
        ("Labyrinth Logistics", "Nurse", "Portland, OR"),
        ("Labyrinth Logistics", "Nurse", "Portland, ME"),
    ),
]


@pytest.mark.parametrize(("a", "b"), SAME_JOB)
def test_same_job_worded_differently_gets_one_key(
    a: tuple[str, str, str], b: tuple[str, str, str]
) -> None:
    assert dedup_key(*a) == dedup_key(*b)


@pytest.mark.parametrize(("a", "b"), DIFFERENT_JOBS)
def test_different_jobs_get_different_keys(
    a: tuple[str, str, str], b: tuple[str, str, str]
) -> None:
    assert dedup_key(*a) != dedup_key(*b)


def test_source_rank_prefers_the_employer_board() -> None:
    assert source_rank("greenhouse") < source_rank("usajobs") < source_rank("email")
    assert source_rank("lever") == source_rank("ashby") == source_rank("greenhouse")


# --- Adding postings to the catalog --------------------------------------------------------


@pytest.fixture
async def sessions(test_database: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(test_database)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def posting(source: str, company: str, **values: object) -> Posting:
    fields: dict[str, object] = {
        "source": source,
        "source_job_id": uuid.uuid4().hex,
        "url": f"https://{source}.example.com/jobs/{uuid.uuid4().hex[:8]}",
        "company": company,
        "title": "Senior Software Engineer",
        "location": "Austin, TX",
    }
    fields.update(values)
    return Posting(**fields)  # type: ignore[arg-type]


def company_name() -> str:
    """A made-up company unique to one test, so tests don't share jobs."""
    return f"Labyrinth Logistics {uuid.uuid4().hex[:8]} Inc."


async def links(session: AsyncSession, job: Job) -> list[tuple[str, bool]]:
    rows = await session.execute(
        select(JobSource.source, JobSource.is_primary)
        .where(JobSource.job_id == job.id)
        .order_by(JobSource.first_seen_at, JobSource.source)
    )
    return [(source, primary) for source, primary in rows]


async def test_a_match_adds_a_source_to_the_existing_job(app_db: AsyncSession) -> None:
    company = company_name()
    first = await add_posting(app_db, posting("email", company), now=NOW)
    second = await add_posting(
        app_db,
        posting("usajobs", company.upper(), title="Sr Software Eng", location="austin, texas"),
        now=NOW + timedelta(hours=1),
    )
    assert second.id == first.id
    assert await links(app_db, first) == [("email", False), ("usajobs", True)]
    await app_db.rollback()


async def test_the_employer_board_becomes_the_primary_link(app_db: AsyncSession) -> None:
    company = company_name()
    job = await add_posting(app_db, posting("usajobs", company), now=NOW)
    assert await links(app_db, job) == [("usajobs", True)]

    await add_posting(app_db, posting("greenhouse", company), now=NOW + timedelta(hours=1))
    await add_posting(app_db, posting("email", company), now=NOW + timedelta(hours=2))
    await add_posting(app_db, posting("lever", company), now=NOW + timedelta(hours=3))
    assert await links(app_db, job) == [
        ("usajobs", False),
        ("greenhouse", True),
        ("email", False),
        ("lever", False),
    ]
    await app_db.rollback()


async def test_different_jobs_stay_separate(app_db: AsyncSession) -> None:
    company = company_name()
    austin = await add_posting(app_db, posting("greenhouse", company), now=NOW)
    denver = await add_posting(app_db, posting("greenhouse", company, location="Denver, CO"))
    assert austin.id != denver.id
    assert (denver.city, denver.region, denver.remote_type) == ("Denver", "CO", "onsite")
    await app_db.rollback()


async def test_seeing_a_listing_again_refreshes_it(app_db: AsyncSession) -> None:
    listing = posting("greenhouse", company_name())
    job = await add_posting(app_db, listing, now=NOW)
    again = await add_posting(app_db, listing, now=NOW + timedelta(days=2))
    assert again.id == job.id
    source = await app_db.scalar(select(JobSource).where(JobSource.job_id == job.id))
    assert source is not None
    assert (source.first_seen_at, source.last_seen_at) == (NOW, NOW + timedelta(days=2))
    await app_db.rollback()


async def test_jobs_unseen_for_7_days_close_and_reopen_when_seen(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    company = company_name()
    gone = posting("greenhouse", company, title="Thread Winder")
    async with sessions() as session:
        stale = await add_posting(session, gone, now=NOW - timedelta(days=8))
        fresh = await add_posting(
            session,
            posting("greenhouse", company, title="Maze Mapper"),
            now=NOW - timedelta(days=6),
        )
        await session.commit()

    assert await close_vanished_jobs(sessions, now=NOW) >= 1

    async with sessions() as session:
        statuses = dict(
            (
                await session.execute(
                    select(Job.id, Job.status).where(Job.id.in_([stale.id, fresh.id]))
                )
            ).all()
        )
        assert statuses == {stale.id: "closed", fresh.id: "open"}
        reopened = await add_posting(session, gone, now=NOW)
        assert reopened.status == "open"
        await session.commit()


def test_worker_closes_vanished_jobs_daily() -> None:
    jobs = [job for job in WorkerSettings.cron_jobs if job.coroutine is close_jobs]
    assert len(jobs) == 1


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,<p>hi</p>",
        "ftp://jobs.example.com/1",
        "https://jobs.example.com/a b",
        "",
    ],
)
async def test_only_web_links_go_into_the_catalog(app_db: AsyncSession, url: str) -> None:
    with pytest.raises(InvalidPosting, match="not_a_web_link"):
        await add_posting(app_db, posting("greenhouse", company_name(), url=url), now=NOW)
    await app_db.rollback()
