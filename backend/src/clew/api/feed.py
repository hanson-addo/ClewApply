"""The job feed: open jobs ranked by fit for the signed-in user (#24).

Jobs from unverified boards (ones a user followed, not ones Clew checked) appear only to
the people following that board, and carry `unverified_board` so the card can say so (R28).
Nothing here is logged: preferences and profile skills are personal data.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, exists, false, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.catalog.merge import source_rank
from clew.catalog.normalize import normalize_company, state_code
from clew.db.session import get_session
from clew.feed.score import Fit, JobFacts, Wants, fit, skill_terms
from clew.models import (
    Company,
    CompanyFollow,
    Job,
    JobPreferences,
    JobSource,
    JobStatus,
    Profile,
    ProfileVersion,
)

router = APIRouter(tags=["feed"])

Session = Annotated[AsyncSession, Depends(get_session)]

# The newest jobs that pass the filters are scored and ranked; older ones wait until
# ranking moves into the database with embeddings.
CANDIDATES = 2000
# Characters of a description read for skill matching: the start, where skills are usually
# listed. Reading more slows the feed (p95 about 170 ms on 10,000 jobs at 1,000).
SKILL_TEXT_CHARS = 1000
NOT_US = "Pick a US state, DC or Puerto Rico. Clew lists US jobs only for now."

Source = Literal["greenhouse", "lever", "ashby", "usajobs", "email"]


class FeedJob(BaseModel):
    id: uuid.UUID
    title: str
    company: str
    # True for a board a user followed that Clew hasn't checked. Show it on the card.
    unverified_board: bool
    location: str | None
    remote_type: Literal["onsite", "hybrid", "remote"] | None
    salary_min: int | None
    salary_max: int | None
    posted_at: datetime | None
    # The link the Apply button opens: the employer's own board when one lists the job.
    apply_url: str
    apply_source: str
    # Every site listing the job, best first.
    seen_on: list[str]
    fit_score: int
    reasons: list[str]


class FeedPage(BaseModel):
    jobs: list[FeedJob]
    page: int
    per_page: int
    # Jobs that passed the filters (at most CANDIDATES).
    total: int
    has_more: bool


async def _wants(session: AsyncSession, user_id: uuid.UUID) -> tuple[Wants, JobPreferences | None]:
    prefs = await session.scalar(select(JobPreferences).where(JobPreferences.user_id == user_id))
    data = await session.scalar(
        select(ProfileVersion.data)
        .join(Profile, Profile.current_version_id == ProfileVersion.id)
        .where(Profile.user_id == user_id)
    )
    skills = _skills(data or {})
    if prefs is None:
        return Wants(skills=skills), None
    return (
        Wants(
            titles=tuple(prefs.titles),
            seniority=frozenset(prefs.seniority),
            locations=tuple((loc.get("city"), loc["region"]) for loc in prefs.locations),
            remote_ok=prefs.remote_ok,
            salary_floor=prefs.salary_floor,
            skills=skills,
        ),
        prefs,
    )


def _skills(data: dict[str, Any]) -> tuple[str, ...]:
    names: list[str] = []
    for skill in data.get("skills") or []:
        if not isinstance(skill, dict):
            continue
        if isinstance(skill.get("name"), str):
            names.append(skill["name"])
        names.extend(k for k in skill.get("keywords") or [] if isinstance(k, str))
    return tuple(names)


def _visible(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Verified companies, plus unverified boards this user follows (R28)."""
    follows = exists().where(
        CompanyFollow.company_id == Company.id, CompanyFollow.user_id == user_id
    )
    return or_(Company.verified, follows)


def _dealbreakers(prefs: JobPreferences | None) -> list[ColumnElement[bool]]:
    if prefs is None:
        return []
    rules: list[ColumnElement[bool]] = []
    for name in prefs.excluded_companies:
        norm = normalize_company(name)
        rules.append(
            ~or_(
                Company.name_norm == norm,
                Company.name_norm.startswith(f"{norm} (", autoescape=True),
            )
        )
    for keyword in prefs.excluded_keywords:
        rules.append(~Job.title.icontains(keyword, autoescape=True))
    if prefs.salary_floor is not None:
        top = func.coalesce(Job.salary_max, Job.salary_min)
        rules.append(or_(top.is_(None), top >= prefs.salary_floor))
    is_remote = Job.remote_type == "remote"
    if not prefs.remote_ok:
        rules.append(Job.remote_type.is_distinct_from("remote"))
    if prefs.locations:
        regions = sorted({loc["region"] for loc in prefs.locations})
        # Jobs we can't place stay in, so an unparsed location never hides a job.
        unplaced = and_(Job.region.is_(None), Job.remote_type.is_distinct_from("remote"))
        rules.append(
            or_(Job.region.in_(regions), is_remote if prefs.remote_ok else false(), unplaced)
        )
    return rules


def _filters(
    remote: bool | None,
    region: str | None,
    min_salary: int | None,
    posted_within_days: int | None,
    source: Source | None,
    now: datetime,
) -> list[ColumnElement[bool]]:
    rules: list[ColumnElement[bool]] = []
    if remote is True:
        rules.append(Job.remote_type == "remote")
    elif remote is False:
        rules.append(Job.remote_type.is_distinct_from("remote"))
    if region is not None:
        code = state_code(region.strip())
        if code is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, NOT_US)
        rules.append(Job.region == code)
    if min_salary is not None:
        rules.append(func.coalesce(Job.salary_max, Job.salary_min) >= min_salary)
    if posted_within_days is not None:
        since = now - timedelta(days=posted_within_days)
        rules.append(func.coalesce(Job.posted_at, Job.created_at) >= since)
    if source is not None:
        rules.append(exists().where(JobSource.job_id == Job.id, JobSource.source == source))
    return rules


@router.get(
    "/feed",
    responses={
        401: {"description": "Not signed in"},
        422: {"description": "A filter is out of range, or the state isn't in the US"},
    },
)
async def feed(
    user: CurrentUser,
    session: Session,
    remote: Annotated[bool | None, Query(description="true: remote only; false: no remote")] = None,
    region: Annotated[str | None, Query(max_length=40, description="A US state")] = None,
    min_salary: Annotated[int | None, Query(ge=0, le=2_000_000)] = None,
    posted_within_days: Annotated[int | None, Query(ge=1, le=90)] = None,
    source: Source | None = None,
    page: Annotated[int, Query(ge=1, le=100)] = 1,
    per_page: Annotated[int, Query(ge=1, le=50)] = 20,
) -> FeedPage:
    """Open jobs, best fit first. Dealbreakers from the user's preferences (excluded
    companies and keywords, places, pay floor) filter jobs out instead of lowering them."""
    now = datetime.now(UTC)
    wants, prefs = await _wants(session, user.id)
    rules = [
        Job.status == JobStatus.OPEN,
        _visible(user.id),
        *_dealbreakers(prefs),
        *_filters(remote, region, min_salary, posted_within_days, source, now),
    ]
    newest = func.coalesce(Job.posted_at, Job.created_at)
    rows = (
        await session.execute(
            select(
                Job.id,
                Job.title,
                Job.title_norm,
                Job.location,
                Job.city,
                Job.region,
                Job.remote_type,
                Job.salary_min,
                Job.salary_max,
                Job.posted_at,
                newest.label("newest"),
                func.left(Job.description, SKILL_TEXT_CHARS).label("text"),
                Company.name,
                Company.verified,
            )
            .join(Company, Company.id == Job.company_id)
            .where(and_(true(), *rules))
            .order_by(newest.desc(), Job.id)
            .limit(CANDIDATES)
        )
    ).all()

    terms = skill_terms(wants.skills)
    scored: list[tuple[Fit, Any]] = []
    for row in rows:
        facts = JobFacts(
            title_norm=row.title_norm,
            city=row.city,
            region=row.region,
            remote_type=row.remote_type,
            salary_min=row.salary_min,
            salary_max=row.salary_max,
            posted_at=row.posted_at,
            text=f"{row.title}\n{row.text or ''}".lower(),
        )
        scored.append((fit(wants, facts, now, terms), row))
    scored.sort(key=lambda item: (-item[0].score, -item[1].newest.timestamp(), item[1].id))

    start = (page - 1) * per_page
    shown = scored[start : start + per_page]
    links = await _links(session, [row.id for _, row in shown])
    jobs = [
        FeedJob(
            id=row.id,
            title=row.title,
            company=row.name,
            unverified_board=not row.verified,
            location=row.location,
            remote_type=row.remote_type,
            salary_min=row.salary_min,
            salary_max=row.salary_max,
            posted_at=row.posted_at,
            apply_url=links[row.id][0],
            apply_source=links[row.id][1],
            seen_on=links[row.id][2],
            fit_score=job_fit.score,
            reasons=job_fit.reasons,
        )
        for job_fit, row in shown
        if row.id in links
    ]
    return FeedPage(
        jobs=jobs,
        page=page,
        per_page=per_page,
        total=len(scored),
        has_more=start + per_page < len(scored),
    )


async def _links(
    session: AsyncSession, job_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str, list[str]]]:
    """Each job's Apply link and source, and every source listing it, best first."""
    if not job_ids:
        return {}
    rows = await session.execute(
        select(JobSource.job_id, JobSource.source, JobSource.url, JobSource.is_primary).where(
            JobSource.job_id.in_(job_ids)
        )
    )
    primary: dict[uuid.UUID, tuple[str, str]] = {}
    sources: dict[uuid.UUID, set[str]] = {}
    for job_id, source, url, is_primary in rows:
        sources.setdefault(job_id, set()).add(source)
        if is_primary:
            primary[job_id] = (url, source)
    return {
        job_id: (url, source, sorted(sources[job_id], key=lambda s: (source_rank(s), s)))
        for job_id, (url, source) in primary.items()
    }
