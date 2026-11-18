"""The fit score: 0 to 100, with up to three reasons the user can read (#23).

Pure functions over plain values, so each part is easy to test. Dealbreakers (excluded
companies and keywords, places the user won't work, pay below their floor) are filters in
the feed query, not low scores here.
"""

from dataclasses import dataclass, field
from datetime import datetime

from clew.catalog.normalize import normalize_title
from clew.feed import weights

# Title words that say how senior a job is, mapped to the preferences' levels.
_SENIORITY_WORDS: dict[str, str] = {
    "intern": "intern",
    "internship": "intern",
    "junior": "entry",
    "entry": "entry",
    "graduate": "entry",
    "associate": "entry",
    "senior": "senior",
    "staff": "lead",
    "principal": "lead",
    "lead": "lead",
    "manager": "manager",
    "director": "manager",
    "head": "manager",
    "vice": "executive",
    "chief": "executive",
}


@dataclass(frozen=True)
class Wants:
    """What one user wants, read once per feed request."""

    titles: tuple[str, ...] = ()
    seniority: frozenset[str] = frozenset()
    # (city or None, region) pairs; city None means anywhere in the state.
    locations: tuple[tuple[str | None, str], ...] = ()
    remote_ok: bool = True
    salary_floor: int | None = None
    skills: tuple[str, ...] = ()


@dataclass(frozen=True)
class JobFacts:
    title_norm: str
    city: str | None
    region: str | None
    remote_type: str | None
    salary_min: int | None
    salary_max: int | None
    posted_at: datetime | None
    # The title and the start of the description, lowercased, for skill matching.
    text: str = ""


@dataclass(frozen=True)
class FitPart:
    """One thing the score weighs, for the "Why it fits you" bars: how well it matched (0-100).

    When there was nothing to compare (the job doesn't say, or the user has no preference),
    `value` is None and `note` says which. The score counts such a part as a neutral half match,
    but the bars must not show it as one.
    """

    label: str
    value: int | None
    note: str | None = None


@dataclass(frozen=True)
class Fit:
    score: int
    reasons: list[str] = field(default_factory=list)
    parts: list[FitPart] = field(default_factory=list)


@dataclass(frozen=True)
class _Part:
    weight: float
    value: float
    reason: str | None = None
    # Set when there was nothing to compare: "Not listed" or "No preference".
    unknown: str | None = None


NOT_LISTED = "Not listed"
NO_PREFERENCE = "No preference"


def _neutral(weight: float, why: str) -> _Part:
    return _Part(weight, 0.5, unknown=why)


def title_part(wants: Wants, job: JobFacts) -> _Part:
    if not wants.titles:
        return _neutral(weights.TITLE, NO_PREFERENCE)
    job_words = set(job.title_norm.split())
    best, best_title = 0.0, ""
    for title in wants.titles:
        words = set(normalize_title(title).split())
        if not words:
            continue
        share = len(words & job_words) / len(words)
        if share > best:
            best, best_title = share, title
    reason = f"Title matches “{best_title}”" if best >= 1 else None
    return _Part(weights.TITLE, best, reason)


# When a title has several level words, the most senior decides ("Associate Director" is a
# manager role, not an entry one).
_LEVEL_ORDER = ("executive", "manager", "lead", "senior", "entry", "intern")
# "Manager" in these titles names the job, not a people-manager level.
_IC_MANAGERS = {"product", "program", "project", "account", "case", "community"}


def job_seniority(title_norm: str) -> str | None:
    words = title_norm.split()
    levels: set[str] = set()
    for index, word in enumerate(words):
        level = _SENIORITY_WORDS.get(word)
        if level == "manager" and word == "manager" and index and words[index - 1] in _IC_MANAGERS:
            continue
        if level is not None:
            levels.add(level)
    return next((level for level in _LEVEL_ORDER if level in levels), None)


def seniority_part(wants: Wants, job: JobFacts) -> _Part:
    level = job_seniority(job.title_norm)
    if not wants.seniority:
        return _neutral(weights.SENIORITY, NO_PREFERENCE)
    if level is None:
        # Most mid-level titles carry no level word.
        level = "mid"
    if level in wants.seniority:
        return _Part(weights.SENIORITY, 1.0, f"{level.capitalize()} level, as you prefer")
    return _Part(weights.SENIORITY, 0.0)


def skill_terms(skills: tuple[str, ...]) -> tuple[str, ...]:
    """Each skill lowercased with its spaces collapsed, without repeats. Built once per
    feed request."""
    terms = {" ".join(skill.lower().split()) for skill in skills}
    return tuple(sorted(term for term in terms if term))


def _is_word_char(char: str) -> bool:
    # + and # count as part of a word, so "C" doesn't match inside "C++" or "C#".
    return char.isalnum() or char in "_+#"


def _mentions(text: str, term: str) -> bool:
    """Whether `term` appears in `text` as whole words. A plain substring search first,
    then a check of the characters around each hit; far faster than a regex per job."""
    start = text.find(term)
    while start != -1:
        end = start + len(term)
        before_ok = start == 0 or not _is_word_char(text[start - 1])
        after_ok = end == len(text) or not _is_word_char(text[end])
        if before_ok and after_ok:
            return True
        start = text.find(term, start + 1)
    return False


def skills_part(wants: Wants, job: JobFacts, terms: tuple[str, ...] | None) -> _Part:
    if not terms:
        return _neutral(weights.SKILLS, NO_PREFERENCE)
    text = " ".join(job.text.split())
    found = [term for term in terms if _mentions(text, term)]
    if not found:
        return _Part(weights.SKILLS, 0.0)
    value = min(1.0, len(found) / min(len(terms), weights.SKILLS_FOR_FULL_MATCH))
    return _Part(weights.SKILLS, value, f"Mentions {len(found)} of your skills")


def location_part(wants: Wants, job: JobFacts) -> _Part:
    if job.remote_type == "remote":
        if wants.remote_ok:
            return _Part(weights.LOCATION, 1.0, "Remote, as you prefer")
        return _Part(weights.LOCATION, 0.0)
    # No places wanted, or one we couldn't read: neutral, since the feed keeps such jobs.
    if not wants.locations:
        return _neutral(weights.LOCATION, NO_PREFERENCE)
    if job.region is None:
        return _neutral(weights.LOCATION, NOT_LISTED)
    place = f"{job.city}, {job.region}" if job.city else job.region
    for city, region in wants.locations:
        if region != job.region:
            continue
        if city is None:
            return _Part(weights.LOCATION, 1.0, f"In {place}, where you want to work")
        if job.city and city.casefold() == job.city.casefold():
            return _Part(weights.LOCATION, 1.0, f"In {place}, where you want to work")
    if any(region == job.region for _, region in wants.locations):
        return _Part(weights.LOCATION, 0.6)
    return _Part(weights.LOCATION, 0.0)


def salary_part(wants: Wants, job: JobFacts) -> _Part:
    top = job.salary_max or job.salary_min
    # No floor set, or no pay posted: neutral.
    if wants.salary_floor is None:
        return _neutral(weights.SALARY, NO_PREFERENCE)
    if top is None:
        return _neutral(weights.SALARY, NOT_LISTED)
    if top >= wants.salary_floor:
        return _Part(weights.SALARY, 1.0, f"Pays up to ${top:,}")
    return _Part(weights.SALARY, 0.0)


def recency_part(job: JobFacts, now: datetime) -> _Part:
    if job.posted_at is None:
        return _neutral(weights.RECENCY, NOT_LISTED)
    days = max(0.0, (now - job.posted_at).total_seconds() / 86_400)
    value = 0.5 ** (days / weights.RECENCY_HALF_LIFE_DAYS)
    whole = int(days)
    when = "today" if whole == 0 else "yesterday" if whole == 1 else f"{whole} days ago"
    return _Part(weights.RECENCY, value, f"Posted {when}")


def fit(wants: Wants, job: JobFacts, now: datetime, terms: tuple[str, ...] | None = None) -> Fit:
    """The job's fit for this user. Pass `terms` from skill_terms(wants.skills) when
    scoring many jobs, so they are built once."""
    if terms is None:
        terms = skill_terms(wants.skills)
    named = [
        ("Title", title_part(wants, job)),
        ("Skills", skills_part(wants, job, terms)),
        ("Location", location_part(wants, job)),
        ("Posted", recency_part(job, now)),
        ("Level", seniority_part(wants, job)),
        ("Pay", salary_part(wants, job)),
    ]
    parts = [part for _, part in named]
    total = sum(p.weight for p in parts)
    score = round(100 * sum(p.weight * p.value for p in parts) / total)
    strong = [p for p in parts if p.reason and p.value >= weights.REASON_THRESHOLD]
    strong.sort(key=lambda p: p.weight * p.value, reverse=True)
    return Fit(
        score=score,
        reasons=[p.reason for p in strong[:3] if p.reason],
        parts=[
            FitPart(label, None, part.unknown)
            if part.unknown
            else FitPart(label, round(100 * part.value))
            for label, part in named
        ],
    )
