"""The shared job catalog tables (#17): constraints, app-role access and raw-posting cleanup.
Every company and job here is made up."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.catalog_cleanup import delete_old_raw_postings
from clew.models import Company, Job, JobSource, RawPosting
from clew.models.catalog import RAW_POSTING_DAYS
from clew.worker import WorkerSettings, clean_raw_postings


def _key() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


async def _company(db: AsyncSession) -> Company:
    tag = uuid.uuid4().hex[:8]
    company = Company(name=f"Labyrinth Logistics {tag}", name_norm=f"labyrinth logistics {tag}")
    db.add(company)
    await db.flush()
    return company


async def _job(db: AsyncSession, **values: object) -> Job:
    company = await _company(db)
    job = Job(
        title="Thread Engineer",
        title_norm="thread engineer",
        company_id=company.id,
        dedup_key=_key(),
        **values,
    )
    db.add(job)
    await db.flush()
    return job


def _source(job: Job, *, primary: bool, source_job_id: str | None = None) -> JobSource:
    return JobSource(
        job_id=job.id,
        source="greenhouse",
        source_job_id=source_job_id or uuid.uuid4().hex,
        url="https://boards.example.com/labyrinth/jobs/1",
        is_primary=primary,
    )


@pytest.fixture
async def owner_sessions(test_database: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(test_database)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def test_new_job_is_open_and_has_an_embedding_column(db: AsyncSession) -> None:
    job = await _job(db)
    await db.refresh(job)
    assert job.status == "open"
    kind = await db.scalar(
        text(
            "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
            "WHERE attrelid = 'jobs'::regclass AND attname = 'embedding'"
        )
    )
    assert kind == "vector"
    await db.rollback()


@pytest.mark.parametrize(
    "values", [{"status": "deleted"}, {"remote_type": "moon"}], ids=["status", "remote_type"]
)
async def test_job_rejects_unknown_values(db: AsyncSession, values: dict[str, str]) -> None:
    with pytest.raises(IntegrityError):
        await _job(db, **values)
    await db.rollback()


async def test_same_dedup_key_cannot_be_two_jobs(db: AsyncSession) -> None:
    job = await _job(db)
    db.add(
        Job(title="Other", title_norm="other", company_id=job.company_id, dedup_key=job.dedup_key)
    )
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


async def test_a_source_listing_belongs_to_one_job(db: AsyncSession) -> None:
    first = await _job(db)
    second = await _job(db)
    db.add(_source(first, primary=True, source_job_id="gh-1001"))
    await db.flush()
    db.add(_source(second, primary=True, source_job_id="gh-1001"))
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


async def test_a_job_has_at_most_one_primary_link(db: AsyncSession) -> None:
    job = await _job(db)
    db.add_all([_source(job, primary=True), _source(job, primary=False)])
    await db.flush()
    db.add(_source(job, primary=True))
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


async def test_deleting_a_job_removes_its_links(db: AsyncSession) -> None:
    job = await _job(db)
    db.add(_source(job, primary=True))
    await db.flush()
    await db.execute(delete(Job).where(Job.id == job.id))
    left = await db.scalar(select(func.count()).where(JobSource.job_id == job.id))
    assert left == 0
    await db.rollback()


async def test_app_role_can_write_the_catalog_but_not_delete_jobs(
    app_db: AsyncSession,
) -> None:
    job = await _job(app_db)
    app_db.add(_source(job, primary=True))
    app_db.add(RawPosting(source="greenhouse", source_job_id="gh-2002", payload={"title": "x"}))
    await app_db.flush()
    job.status = "closed"
    await app_db.flush()
    await app_db.execute(delete(RawPosting).where(RawPosting.source_job_id == "gh-2002"))
    with pytest.raises(DBAPIError, match="permission denied"):
        await app_db.execute(delete(Job).where(Job.id == job.id))
    await app_db.rollback()


async def test_cleanup_deletes_only_postings_older_than_30_days(
    owner_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
    tag = uuid.uuid4().hex
    ages = {"old": RAW_POSTING_DAYS + 1, "edge": RAW_POSTING_DAYS - 1, "new": 0}
    async with owner_sessions() as session:
        session.add_all(
            RawPosting(
                source="usajobs",
                source_job_id=f"{tag}-{label}",
                payload={},
                fetched_at=now - timedelta(days=days),
            )
            for label, days in ages.items()
        )
        await session.commit()

    assert await delete_old_raw_postings(owner_sessions, now=now) >= 1

    async with owner_sessions() as session:
        kept = await session.scalars(
            select(RawPosting.source_job_id).where(RawPosting.source_job_id.like(f"{tag}-%"))
        )
        assert sorted(kept) == [f"{tag}-edge", f"{tag}-new"]


def test_worker_cleans_raw_postings_daily() -> None:
    jobs = [job for job in WorkerSettings.cron_jobs if job.coroutine is clean_raw_postings]
    assert len(jobs) == 1
    assert (jobs[0].hour, jobs[0].minute) == (9, 0)
