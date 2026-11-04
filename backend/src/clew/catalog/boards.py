"""Public job boards of companies on Greenhouse, Lever and Ashby (#19).

Each ATS publishes a company's open jobs at an unauthenticated endpoint meant for career
sites and job boards:
- Greenhouse Job Board API: GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
- Lever Postings API: GET api.lever.co/v0/postings/{token}?mode=json
- Ashby Job Postings API: GET api.ashbyhq.com/posting-api/job-board/{token}

Only these fixed hosts are called; the board token is checked before it goes in the path.
No sign-in, no scraping of HTML pages.
"""

import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import httpx

from clew.catalog.merge import Posting
from clew.catalog.normalize import parse_location

Ats = Literal["greenhouse", "lever", "ashby"]
ATS_TYPES: tuple[Ats, ...] = ("greenhouse", "lever", "ashby")

# Board tokens are short slugs ("examplecorp", "Example-Corp"); nothing that could change
# the path or host.
BOARD_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")

_URLS: dict[Ats, str] = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true",
    "lever": "https://api.lever.co/v0/postings/{token}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
}
TIMEOUT_SECONDS = 20
MAX_BOARD_BYTES = 25 * 1024 * 1024
MAX_DESCRIPTION_CHARS = 20_000
MAX_URL_CHARS = 2000

_US_WORDS = re.compile(r"\b(united states|usa|u\.s\.a?\.?|us)\b", re.IGNORECASE)
_US_COUNTRIES = {"us", "usa", "united states", "united states of america"}
_TAGS = re.compile(r"<[^>]+>")
_BLANKS = re.compile(r"[ \t\r\f\v]+")


class BoardUnavailable(Exception):
    """The board couldn't be read. The message is a short code, never response content."""


@dataclass(frozen=True)
class Board:
    ats: Ats
    token: str
    company: str


def board_url(ats: Ats, token: str) -> str:
    if not BOARD_TOKEN.fullmatch(token):
        raise ValueError("bad_board_token")
    return _URLS[ats].format(token=token)


async def fetch_board(client: httpx.AsyncClient, board: Board) -> dict[str, Any] | list[Any]:
    """The board's raw JSON. Raises BoardUnavailable for a missing board, an error status,
    a response over MAX_BOARD_BYTES, or anything that isn't JSON."""
    url = board_url(board.ats, board.token)
    try:
        async with client.stream("GET", url, timeout=TIMEOUT_SECONDS) as response:
            if response.status_code == 404:
                raise BoardUnavailable("not_found")
            if response.status_code != 200:
                raise BoardUnavailable(f"status_{response.status_code}")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BOARD_BYTES:
                    raise BoardUnavailable("too_large")
    except httpx.HTTPError as error:
        raise BoardUnavailable(type(error).__name__) from None
    try:
        data = httpx.Response(200, content=bytes(body)).json()
    except ValueError:
        raise BoardUnavailable("not_json") from None
    if not isinstance(data, dict | list):
        raise BoardUnavailable("not_json")
    return data


def board_jobs(board: Board, data: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    """The list of job objects inside a board response."""
    items = data if isinstance(data, list) else data.get("jobs", [])
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def to_posting(board: Board, job: dict[str, Any]) -> Posting | None:
    """One board job as a catalog posting, or None when it isn't a listed US job."""
    match board.ats:
        case "greenhouse":
            return _greenhouse(board, job)
        case "lever":
            return _lever(board, job)
        case "ashby":
            return _ashby(board, job)


def in_us(location: str | None, country: str | None = None) -> bool:
    """Clew lists US jobs only at launch. A job counts when its country is the US, its
    location names a US state, or it says "Remote" with no other country."""
    if country:
        return country.strip().lower() in _US_COUNTRIES
    if not location or not location.strip():
        return False
    if parse_location(location).region or _US_WORDS.search(location):
        return True
    parts = [p.strip().lower() for p in re.split(r"[,;/()|-]", location) if p.strip()]
    return bool(parts) and all(p in {"remote", "anywhere", "hybrid"} for p in parts)


def plain_text(content: str | None, *, escaped: bool = False) -> str | None:
    """Job descriptions as plain text: the feed shows them as text, never as HTML."""
    if not content:
        return None
    text = html.unescape(content) if escaped else content
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d)>", "\n", text)
    text = html.unescape(_TAGS.sub("", text))
    lines = [_BLANKS.sub(" ", line).strip() for line in text.splitlines()]
    text = "\n".join(line for line in lines if line)
    return text[:MAX_DESCRIPTION_CHARS] or None


def _text(value: Any, limit: int = 300) -> str | None:
    return value.strip()[:limit] or None if isinstance(value, str) else None


def _when(value: Any) -> datetime | None:
    if isinstance(value, int | float):  # Lever: milliseconds since 1970
        return datetime.fromtimestamp(value / 1000, UTC)
    if isinstance(value, str):
        try:
            when = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return when if when.tzinfo else when.replace(tzinfo=UTC)
    return None


def _with_mode(location: str | None, mode: str | None) -> str | None:
    """Puts the work mode into the location text, where parse_location reads it."""
    if mode not in {"remote", "hybrid"}:
        return location
    if location and mode in location.lower():
        return location
    return f"{mode.title()} - {location}" if location else mode.title()


def _posting(board: Board, job_id: Any, url: Any, title: Any, **rest: Any) -> Posting | None:
    title_text = _text(title)
    if job_id in (None, "") or not isinstance(url, str) or not title_text:
        return None
    if len(url) > MAX_URL_CHARS:
        return None
    return Posting(
        source=board.ats,
        source_job_id=str(job_id)[:255],
        url=url.strip(),
        company=board.company,
        title=title_text,
        **rest,
    )


def _greenhouse(board: Board, job: dict[str, Any]) -> Posting | None:
    location = _text((job.get("location") or {}).get("name"))
    if not in_us(location):
        return None
    return _posting(
        board,
        job.get("id"),
        job.get("absolute_url"),
        job.get("title"),
        location=location,
        # Greenhouse sends the description as HTML with its tags escaped.
        description=plain_text(job.get("content"), escaped=True),
        posted_at=_when(job.get("first_published") or job.get("updated_at")),
    )


def _lever(board: Board, job: dict[str, Any]) -> Posting | None:
    categories = job.get("categories") or {}
    mode = {"remote": "remote", "hybrid": "hybrid"}.get(str(job.get("workplaceType")))
    location = _with_mode(_text(categories.get("location")), mode)
    country = _text(job.get("country"), 60)
    if not in_us(location, country):
        return None
    salary = job.get("salaryRange") or {}
    yearly_usd = salary.get("currency") == "USD" and salary.get("interval") == "per-year-salary"
    return _posting(
        board,
        job.get("id"),
        job.get("hostedUrl"),
        job.get("text"),
        location=location,
        description=plain_text(job.get("descriptionPlain")),
        posted_at=_when(job.get("createdAt")),
        salary_min=_whole(salary.get("min")) if yearly_usd else None,
        salary_max=_whole(salary.get("max")) if yearly_usd else None,
    )


def _ashby(board: Board, job: dict[str, Any]) -> Posting | None:
    if job.get("isListed") is False:
        return None
    address = ((job.get("address") or {}).get("postalAddress")) or {}
    mode = {"Remote": "remote", "Hybrid": "hybrid"}.get(str(job.get("workplaceType")))
    location = _with_mode(_text(job.get("location")), mode)
    if not in_us(location, _text(address.get("addressCountry"), 60)):
        return None
    return _posting(
        board,
        job.get("id") or job.get("jobUrl"),
        job.get("jobUrl"),
        job.get("title"),
        location=location,
        description=plain_text(job.get("descriptionPlain")),
        posted_at=_when(job.get("publishedAt")),
    )


def _whole(value: Any) -> int | None:
    if isinstance(value, int | float) and 0 <= value <= 10_000_000:
        return int(value)
    return None
