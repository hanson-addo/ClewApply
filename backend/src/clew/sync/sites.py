"""The job sites the extension fills, and the profile fields each one has.

A field's key is what the extension reports after filling it, and what the Sync Center names
when it's behind. Keys for jobs and schools carry the entry's own id ("work.3f9a01bc.title"), so
reordering the list doesn't make every entry look changed. A version saved before entries had
ids falls back to the entry's position ("work.0.title").
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


def _entry(section: str, entry: Work | Education, i: int) -> str:
    return f"{section}.{entry.id or i}"


def _jobs(profile: ProfileData, *, duties: bool = False) -> list[SiteField]:
    fields: list[SiteField] = []
    for i, job in enumerate(profile.work[:MAX_JOBS]):
        fields += _job_fields(_entry("work", job, i), i + 1, job, duties)
    return fields


def _job_fields(key: str, n: int, job: Work, duties: bool) -> list[SiteField]:
    fields = [
        SiteField(f"{key}.title", f"Job {n}: title", job.position),
        SiteField(f"{key}.company", f"Job {n}: company", job.name),
        SiteField(f"{key}.dates", f"Job {n}: dates", _dates(job.startDate, job.endDate)),
    ]
    if duties:
        fields.append(SiteField(f"{key}.duties", f"Job {n}: duties", job.summary))
    return fields


def _schools(profile: ProfileData, *, split_degree: bool = False) -> list[SiteField]:
    fields: list[SiteField] = []
    for i, school in enumerate(profile.education[:MAX_SCHOOLS]):
        fields += _school_fields(_entry("education", school, i), i + 1, school, split_degree)
    return fields


def _school_fields(key: str, n: int, school: Education, split_degree: bool) -> list[SiteField]:
    if split_degree:
        # Sites with separate boxes for the degree and the field of study.
        degree = [
            SiteField(f"{key}.degree", f"School {n}: degree", school.studyType),
            SiteField(f"{key}.field", f"School {n}: field of study", school.area),
        ]
    else:
        degree = [
            SiteField(f"{key}.degree", f"School {n}: degree", _join(school.studyType, school.area))
        ]
    return [
        SiteField(f"{key}.school", f"School {n}: name", school.institution),
        *degree,
        SiteField(f"{key}.dates", f"School {n}: dates", _dates(school.startDate, school.endDate)),
    ]


def _linkedin(profile: ProfileData) -> list[SiteField]:
    # No skills: LinkedIn adds them one at a time through a search box, which the extension
    # can't fill without choosing for the user.
    return [
        SiteField("headline", "Headline", profile.basics.label),
        SiteField("about", "About", profile.basics.summary),
        SiteField("location", "Location", _location(profile)),
        *_jobs(profile),
        *_schools(profile, split_degree=True),
    ]


def _indeed(profile: ProfileData) -> list[SiteField]:
    # No skills: Indeed adds them one at a time, each with its own years of experience. Its
    # education form has a level-of-education list apart from the field of study.
    return [
        SiteField("headline", "Headline", profile.basics.label),
        SiteField("summary", "Summary", profile.basics.summary),
        SiteField("location", "Location", _location(profile)),
        *_jobs(profile, duties=True),
        *_schools(profile, split_degree=True),
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
