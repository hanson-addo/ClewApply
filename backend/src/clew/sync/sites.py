"""The job sites the extension fills, and the profile fields each one has.

A field's key is what the extension reports after filling it, and what the Sync Center names
when it's behind. Keys for list entries carry the entry's position ("work.0.title"), the same
order as the profile editor shows them.
"""

from collections.abc import Callable
from dataclasses import dataclass

from clew.profile.schema import Education, ProfileData, Work

# The extension fills at most this many jobs and schools per site.
MAX_JOBS = 10
MAX_SCHOOLS = 5


@dataclass(frozen=True)
class SiteField:
    key: str
    label: str
    value: str | None


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    # Where "Open your profile" goes: the site's own page, in a normal new tab.
    profile_url: str
    fields: Callable[[ProfileData], list[SiteField]]


def _join(*parts: str | None, sep: str = " ") -> str | None:
    text = sep.join(p.strip() for p in parts if p and p.strip())
    return text or None


def _dates(start: str | None, end: str | None) -> str | None:
    if not start and not end:
        return None
    return f"{start or ''} to {end or 'present'}".strip()


def _location(profile: ProfileData) -> str | None:
    place = profile.basics.location
    return _join(place.city, place.region, sep=", ") if place else None


def _skills(profile: ProfileData) -> str | None:
    names = [s.name.strip() for s in profile.skills if s.name and s.name.strip()]
    return ", ".join(names) or None


def _jobs(profile: ProfileData, *, duties: bool = False) -> list[SiteField]:
    fields: list[SiteField] = []
    for i, job in enumerate(profile.work[:MAX_JOBS]):
        n = i + 1
        fields += _job_fields(i, n, job, duties)
    return fields


def _job_fields(i: int, n: int, job: Work, duties: bool) -> list[SiteField]:
    fields = [
        SiteField(f"work.{i}.title", f"Job {n}: title", job.position),
        SiteField(f"work.{i}.company", f"Job {n}: company", job.name),
        SiteField(f"work.{i}.dates", f"Job {n}: dates", _dates(job.startDate, job.endDate)),
    ]
    if duties:
        fields.append(SiteField(f"work.{i}.duties", f"Job {n}: duties", job.summary))
    return fields


def _schools(profile: ProfileData) -> list[SiteField]:
    fields: list[SiteField] = []
    for i, school in enumerate(profile.education[:MAX_SCHOOLS]):
        fields += _school_fields(i, i + 1, school)
    return fields


def _school_fields(i: int, n: int, school: Education) -> list[SiteField]:
    return [
        SiteField(f"education.{i}.school", f"School {n}: name", school.institution),
        SiteField(
            f"education.{i}.degree", f"School {n}: degree", _join(school.studyType, school.area)
        ),
        SiteField(
            f"education.{i}.dates", f"School {n}: dates", _dates(school.startDate, school.endDate)
        ),
    ]


def _linkedin(profile: ProfileData) -> list[SiteField]:
    return [
        SiteField("headline", "Headline", profile.basics.label),
        SiteField("about", "About", profile.basics.summary),
        SiteField("location", "Location", _location(profile)),
        *_jobs(profile),
        *_schools(profile),
        SiteField("skills", "Skills", _skills(profile)),
    ]


def _indeed(profile: ProfileData) -> list[SiteField]:
    return [
        SiteField("headline", "Headline", profile.basics.label),
        SiteField("summary", "Summary", profile.basics.summary),
        SiteField("location", "Location", _location(profile)),
        *_jobs(profile),
        *_schools(profile),
        SiteField("skills", "Skills", _skills(profile)),
    ]


def _usajobs(profile: ProfileData) -> list[SiteField]:
    return [
        SiteField("location", "Location", _location(profile)),
        *_jobs(profile, duties=True),
        *_schools(profile),
        SiteField("skills", "Skills", _skills(profile)),
    ]


SITES: dict[str, Site] = {
    site.id: site
    for site in (
        Site("linkedin", "LinkedIn", "https://www.linkedin.com/in/me/", _linkedin),
        Site("indeed", "Indeed", "https://profile.indeed.com/", _indeed),
        Site("usajobs", "USAJobs", "https://www.usajobs.gov/applicant/profile/", _usajobs),
    )
}
