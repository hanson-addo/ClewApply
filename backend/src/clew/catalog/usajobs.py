"""Federal jobs from the USAJobs Search API (#18).

GET https://data.usajobs.gov/api/search with the key in Authorization-Key and the email it
was issued to in User-Agent (developer.usajobs.gov). Only this fixed host is called, with
fixed query parameters. Once a day the worker reads every open job that the public can
apply to, so jobs taken down stop being seen and close after CLOSE_AFTER_DAYS.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.catalog.boards import MAX_BOARD_BYTES, MAX_URL_CHARS, _text, _when, _whole, plain_text
from clew.catalog.merge import InvalidPosting, Posting, add_posting
from clew.models import JobSource, RawPosting

logger = logging.getLogger(__name__)

SOURCE = "usajobs"
SEARCH_URL = "https://data.usajobs.gov/api/search"
# The most the API returns per page.
PAGE_SIZE = 500
# A safety stop: 60 pages of 500 is more than the open public listings on USAJobs.
MAX_PAGES = 60
TIMEOUT_SECONDS = 30
# Tries per page. Rate limits (429) and server errors wait 2, 4, 8 s, or the server's
# Retry-After when it is shorter than RETRY_AFTER_CAP.
TRIES = 4
RETRY_AFTER_CAP = 60
# A pause between pages, so a full read doesn't hammer the API.
PAGE_PAUSE_SECONDS = 1.0
# Time allowed for one run of the worker job.
USAJOBS_RUN_TIMEOUT_SECONDS = 60 * 60

Sleep = Callable[[float], Awaitable[None]]


class UsajobsUnavailable(Exception):
    """The API couldn't be read. The message is a short code, never response content."""


def client_headers(api_key: str, email: str) -> dict[str, str]:
    # httpx sends Host: data.usajobs.gov from the URL itself.
    return {"Authorization-Key": api_key, "User-Agent": email}


def search_params(page: int) -> dict[str, str]:
    # Jobs anyone can apply to; "Status" jobs are for current federal employees only.
    return {"WhoMayApply": "public", "ResultsPerPage": str(PAGE_SIZE), "Page": str(page)}


async def fetch_page(client: httpx.AsyncClient, page: int, sleep: Sleep = asyncio.sleep) -> Any:
    """One page of search results as JSON. Retries rate limits, server errors and network
    errors with backoff; raises UsajobsUnavailable when the tries run out or the answer is
    another error, too large, or not JSON."""
    code = "no_tries"
    retry_after: str | None = None
    for attempt in range(TRIES):
        if attempt:
            await sleep(retry_wait(attempt, retry_after))
        retry_after = None
        try:
            async with client.stream(
                "GET", SEARCH_URL, params=search_params(page), timeout=TIMEOUT_SECONDS
            ) as response:
                if response.status_code == 429 or response.status_code >= 500:
                    code = f"status_{response.status_code}"
                    retry_after = response.headers.get("Retry-After")
                    continue
                if response.status_code != 200:
                    # 401/403: a wrong key or email. Retrying won't help.
                    raise UsajobsUnavailable(f"status_{response.status_code}")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BOARD_BYTES:
                        raise UsajobsUnavailable("too_large")
        except httpx.HTTPError as error:
            code = type(error).__name__
            continue
        try:
            return httpx.Response(200, content=bytes(body)).json()
        except ValueError:
            raise UsajobsUnavailable("not_json") from None
    raise UsajobsUnavailable(code)


def retry_wait(attempt: int, retry_after: str | None) -> float:
    """Seconds before try number `attempt` (counted from 0): the server's Retry-After in
    seconds when it sent one, at most RETRY_AFTER_CAP, else 2, 4, 8."""
    if retry_after and retry_after.strip().isdigit():
        return float(min(int(retry_after), RETRY_AFTER_CAP))
    return float(2**attempt)


def page_items(data: Any) -> tuple[list[dict[str, Any]], int]:
    """The job objects in one page, and the number of pages the search has."""
    result = data.get("SearchResult") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        return [], 0
    items = result.get("SearchResultItems")
    pages = (result.get("UserArea") or {}).get("NumberOfPages")
    jobs = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    try:
        count = int(str(pages))
    except ValueError:
        count = 1 if jobs else 0
    return jobs, count


def to_posting(item: dict[str, Any]) -> Posting | None:
    """One search result as a catalog posting, or None for a job outside the US or one
    missing its id, title or link."""
    job = item.get("MatchedObjectDescriptor")
    if not isinstance(job, dict):
        return None
    job_id = item.get("MatchedObjectId") or job.get("PositionID")
    title = _text(job.get("PositionTitle"))
    url = job.get("PositionURI")
    company = _text(job.get("OrganizationName"), 200) or _text(job.get("DepartmentName"), 200)
    if job_id in (None, "") or not title or not company:
        return None
    if not isinstance(url, str) or len(url) > MAX_URL_CHARS:
        return None
    location = _location(job)
    if location is None:
        return None
    details = (job.get("UserArea") or {}).get("Details") or {}
    if not isinstance(details, dict):
        details = {}
    low, high = _yearly_pay(job.get("PositionRemuneration"))
    return Posting(
        source=SOURCE,
        source_job_id=str(job_id)[:255],
        url=url.strip(),
        company=company,
        title=title,
        location=location,
        description=plain_text(_str(details.get("JobSummary")))
        or plain_text(_str(job.get("QualificationSummary"))),
        posted_at=_when(job.get("PublicationStartDate")),
        salary_min=low,
        salary_max=high,
    )


def _str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _location(job: dict[str, Any]) -> str | None:
    """The job's US location as text, or None when none of its places is in the US. A job
    in several places shows the first one; a remote job says so first."""
    places = job.get("PositionLocation")
    names = [
        name
        for place in (places if isinstance(places, list) else [])
        if isinstance(place, dict)
        and str(place.get("CountryCode", "")).strip().lower() in {"united states", "us", "usa"}
        and (name := _text(place.get("LocationName"), 200))
    ]
    remote = ((job.get("UserArea") or {}).get("Details") or {}).get("RemoteIndicator") is True
    if not names:
        # Remote federal jobs can list "Anywhere in the U.S." with no country.
        return "Remote - US" if remote else None
    if remote and "remote" not in names[0].lower():
        return f"Remote - {names[0]}"
    return names[0]


def _yearly_pay(value: Any) -> tuple[int | None, int | None]:
    """Pay per year in dollars ("PA" is per annum). Hourly pay isn't stored as yearly."""
    if not isinstance(value, list):
        return None, None
    for pay in value:
        if isinstance(pay, dict) and pay.get("RateIntervalCode") == "PA":
            return _number(pay.get("MinimumRange")), _number(pay.get("MaximumRange"))
    return None, None


def _number(value: Any) -> int | None:
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return None
    return _whole(value)


async def poll_usajobs(
    sessions: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    now: datetime | None = None,
    sleep: Sleep = asyncio.sleep,
) -> int:
    """Reads every page of open public listings and adds the US ones; returns how many
    were added or seen. Stops at the first page that can't be read."""
    seen = now or datetime.now(UTC)
    count = 0
    page, pages = 1, 1
    while page <= min(pages, MAX_PAGES):
        if page > 1:
            await sleep(PAGE_PAUSE_SECONDS)
        try:
            data = await fetch_page(client, page, sleep)
        except UsajobsUnavailable as error:
            logger.warning("usajobs_unavailable", extra={"page": page, "error": str(error)})
            break
        items, pages = page_items(data)
        count += await _add_page(sessions, items, seen)
        page += 1
    if pages > MAX_PAGES:
        logger.warning("usajobs_pages_capped", extra={"pages": pages})
    logger.info("usajobs_polled", extra={"jobs": count, "pages": page - 1})
    return count


async def _add_page(
    sessions: async_sessionmaker[AsyncSession], items: list[dict[str, Any]], seen: datetime
) -> int:
    count = 0
    async with sessions() as session:
        for item in items:
            # A savepoint per job, so one odd job is skipped without losing the page.
            try:
                async with session.begin_nested():
                    count += await _add_job(session, item, seen)
            except InvalidPosting as error:
                logger.info("posting_skipped", extra={"source": SOURCE, "error": str(error)})
            except Exception as error:
                # API JSON is outside input. Log the kind of failure only, never content.
                logger.warning(
                    "posting_failed", extra={"source": SOURCE, "error": type(error).__name__}
                )
        await session.commit()
    return count


async def _add_job(session: AsyncSession, item: dict[str, Any], seen: datetime) -> int:
    posting = to_posting(item)
    if posting is None:
        return 0
    known = await session.scalar(
        select(JobSource.id).where(
            JobSource.source == SOURCE, JobSource.source_job_id == posting.source_job_id
        )
    )
    if known is None:
        # Every open listing is read daily, so only a listing's first sighting is kept;
        # a copy a day would fill raw_postings with the same jobs.
        session.add(
            RawPosting(
                source=SOURCE, source_job_id=posting.source_job_id, payload=item, fetched_at=seen
            )
        )
    await add_posting(session, posting, now=seen)
    return 1
