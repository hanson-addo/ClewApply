"""Adds postings to the job catalog, merging exact duplicates into one job (#20)."""

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.catalog.normalize import dedup_key, normalize_company, normalize_title, parse_location
from clew.models import Company, Job, JobSource, JobStatus

logger = logging.getLogger(__name__)

# A job none of its sources has listed for this long is marked closed.
CLOSE_AFTER_DAYS = 7

# Which link the feed opens when several sites list a job: the employer's own board first,
# then USAJobs, then anything else (job sites, alert emails).
ATS_SOURCES = frozenset({"greenhouse", "lever", "ashby"})


_WEB_LINK = re.compile(r"https?://\S+", re.IGNORECASE)


class InvalidPosting(ValueError):
    """A posting that can't go into the catalog. The message is a short code, never the
    posting's content."""


def source_rank(source: str) -> int:
    if source in ATS_SOURCES:
        return 0
    if source == "usajobs":
        return 1
    return 2


@dataclass(frozen=True)
class Posting:
    """One job as a source listed it, already read from the source's own format."""

    source: str
    source_job_id: str
    url: str
    company: str
    title: str
    location: str | None = None
    description: str | None = None
    posted_at: datetime | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    # The board's own company, for postings read from a company board. Unset for sources
    # that only name the company (USAJobs, alert emails), which are matched by name.
    company_id: uuid.UUID | None = None


async def add_posting(session: AsyncSession, posting: Posting, now: datetime | None = None) -> Job:
    """Adds or refreshes `posting` and returns its job. The caller commits.

    Raises InvalidPosting for a link that isn't http(s); source adapters skip those.

    A listing seen before only has its last_seen_at moved on. A new listing whose dedup key
    matches an existing job becomes another source of that job; otherwise it starts a new
    job. Inserts use ON CONFLICT, so two workers adding the same job end with one row.

    Postings from an unverified board (one a user followed, not one Clew checked) are keyed
    by their company's id, so they never merge into another company's jobs or become their
    Apply link.
    """
    if not _WEB_LINK.fullmatch(posting.url):
        # The link becomes the feed's Apply button, so only web links are kept.
        raise InvalidPosting("not_a_web_link")
    seen = now or datetime.now(UTC)
    known = await session.scalar(
        select(JobSource).where(
            JobSource.source == posting.source, JobSource.source_job_id == posting.source_job_id
        )
    )
    company = await _posting_company(session, posting)
    if known is not None:
        job = await session.get_one(Job, known.job_id)
        if not company.verified and job.company_id != company.id:
            raise InvalidPosting("listed_by_another_board")
        known.last_seen_at = seen
        known.url = posting.url
        _reopen(job, seen)
        await session.flush()
        return job

    scope = None if company.verified else f"unverified {company.id}"
    key = dedup_key(posting.company, posting.title, posting.location, scope=scope)
    job = await _job(session, posting, company, key)
    _reopen(job, seen)

    await session.execute(
        insert(JobSource)
        .values(
            job_id=job.id,
            source=posting.source,
            source_job_id=posting.source_job_id,
            url=posting.url,
            is_primary=False,
            first_seen_at=seen,
            last_seen_at=seen,
        )
        .on_conflict_do_nothing(constraint="uq_job_sources_source_job")
    )
    await _choose_primary(session, job)
    await session.flush()
    return job


async def _posting_company(session: AsyncSession, posting: Posting) -> Company:
    if posting.company_id is not None:
        return await session.get_one(Company, posting.company_id)
    return await _company(session, posting.company)


async def _company(session: AsyncSession, name: str) -> Company:
    """The company a source names. Unverified boards never hold a plain normalized name
    (theirs carries the board), so a name always finds a verified company."""
    name_norm = normalize_company(name)
    await session.execute(
        insert(Company)
        .values(name=name.strip(), name_norm=name_norm, verified=True)
        .on_conflict_do_nothing(index_elements=[Company.name_norm])
    )
    return (await session.scalars(select(Company).where(Company.name_norm == name_norm))).one()


async def _job(session: AsyncSession, posting: Posting, company: Company, key: str) -> Job:
    location = parse_location(posting.location)
    await session.execute(
        insert(Job)
        .values(
            title=posting.title.strip(),
            title_norm=normalize_title(posting.title),
            company_id=company.id,
            location=posting.location,
            city=location.city,
            region=location.region,
            remote_type=location.remote_type,
            salary_min=posting.salary_min,
            salary_max=posting.salary_max,
            description=posting.description,
            posted_at=posting.posted_at,
            dedup_key=key,
        )
        .on_conflict_do_nothing(index_elements=[Job.dedup_key])
    )
    job = await session.scalar(select(Job).where(Job.dedup_key == key))
    if job is None:  # pragma: no cover - the insert above created it
        raise RuntimeError("job vanished after insert")
    return job


def _reopen(job: Job, seen: datetime) -> None:
    if job.status == JobStatus.CLOSED:
        job.status = JobStatus.OPEN
    job.updated_at = seen


async def _choose_primary(session: AsyncSession, job: Job) -> None:
    """Makes the best-ranked source the primary one; ties keep the earliest seen."""
    sources = list(
        await session.scalars(
            select(JobSource)
            .where(JobSource.job_id == job.id)
            .order_by(JobSource.first_seen_at, JobSource.id)
            .with_for_update()
        )
    )
    best = min(sources, key=lambda s: source_rank(s.source))
    current = next((s for s in sources if s.is_primary), None)
    if current is not None and source_rank(current.source) <= source_rank(best.source):
        return
    if current is not None:
        # The one-primary index is checked per statement, so clear the old one first.
        current.is_primary = False
        await session.flush()
    best.is_primary = True


async def close_vanished_jobs(
    sessions: async_sessionmaker[AsyncSession], now: datetime | None = None
) -> int:
    """Closes open jobs that no source has listed for CLOSE_AFTER_DAYS; returns how many."""
    seen = now or datetime.now(UTC)
    cutoff = seen - timedelta(days=CLOSE_AFTER_DAYS)
    still_listed = exists().where(JobSource.job_id == Job.id, JobSource.last_seen_at >= cutoff)
    async with sessions() as session:
        closed = await session.execute(
            update(Job)
            .where(Job.status == JobStatus.OPEN, ~still_listed)
            .values(status=JobStatus.CLOSED, updated_at=seen)
            .returning(Job.id)
        )
        count = len(closed.scalars().all())
        await session.commit()
    logger.info("jobs_closed", extra={"closed": count})
    return count
