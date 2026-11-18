"""The fit score and its reasons (#23). Every job and person here is made up."""

from datetime import UTC, datetime, timedelta

import pytest

from clew.feed import weights
from clew.feed.score import (
    JobFacts,
    Wants,
    fit,
    job_seniority,
    location_part,
    recency_part,
    salary_part,
    seniority_part,
    skill_terms,
    skills_part,
    title_part,
)

NOW = datetime(2026, 11, 6, 12, 0, tzinfo=UTC)


def job(**values: object) -> JobFacts:
    fields: dict[str, object] = {
        "title_norm": "senior software engineer",
        "city": "Austin",
        "region": "TX",
        "remote_type": "onsite",
        "salary_min": None,
        "salary_max": None,
        "posted_at": NOW,
        "text": "senior software engineer\nwe use python and postgres.",
    }
    fields.update(values)
    return JobFacts(**fields)  # type: ignore[arg-type]


def test_weights_add_up_to_one() -> None:
    total = sum(
        (
            weights.TITLE,
            weights.SKILLS,
            weights.LOCATION,
            weights.RECENCY,
            weights.SENIORITY,
            weights.SALARY,
        )
    )
    assert total == pytest.approx(1.0)


def test_title_matches_after_normalizing() -> None:
    part = title_part(Wants(titles=("Sr. Software Eng.",)), job())
    assert part.value == 1.0
    assert part.reason == "Title matches “Sr. Software Eng.”"


def test_title_partly_matching_has_no_reason() -> None:
    part = title_part(Wants(titles=("Data Engineer",)), job())
    assert part.value == 0.5
    assert part.reason is None


def test_title_with_no_wanted_titles_is_neutral() -> None:
    assert title_part(Wants(), job()).value == 0.5


@pytest.mark.parametrize(
    ("title", "level"),
    [
        ("senior software engineer", "senior"),
        ("staff engineer", "lead"),
        ("engineering manager", "manager"),
        ("software engineering intern", "intern"),
        ("vice president operations", "executive"),
        ("software engineer", None),
        ("associate director", "manager"),
        ("senior product manager", "senior"),
        ("product manager", None),
        ("engineering manager product", "manager"),
    ],
)
def test_job_seniority(title: str, level: str | None) -> None:
    assert job_seniority(title) == level


def test_seniority() -> None:
    assert seniority_part(Wants(seniority=frozenset({"senior"})), job()).value == 1.0
    assert seniority_part(Wants(seniority=frozenset({"entry"})), job()).value == 0.0
    # No level word reads as mid level.
    plain = job(title_norm="software engineer")
    assert seniority_part(Wants(seniority=frozenset({"mid"})), plain).value == 1.0
    assert seniority_part(Wants(), job()).value == 0.5


def test_skills_match_whole_words_only() -> None:
    wants = Wants(skills=("Python", "Go", "C++", "SQL", "Machine Learning", "Rust", "C", "Node.js"))
    terms = skill_terms(wants.skills)
    text = "python, c++ and sql. machine\n learning, node.js too. no golang or rusty mysql."
    part = skills_part(wants, job(text=text), terms)
    assert part.reason == "Mentions 5 of your skills"
    assert part.value == pytest.approx(5 / 8)


def test_skills_cap_at_a_full_match() -> None:
    skills = tuple(f"skill{n}" for n in range(30))
    text = " ".join(skills[: weights.SKILLS_FOR_FULL_MATCH])
    wants = Wants(skills=skills)
    assert skills_part(wants, job(text=text), skill_terms(skills)).value == 1.0


def test_no_skills_is_neutral() -> None:
    assert skills_part(Wants(), job(), None).value == 0.5


def test_location() -> None:
    austin = Wants(locations=(("Austin", "TX"),))
    assert location_part(austin, job()).reason == "In Austin, TX, where you want to work"
    assert location_part(Wants(locations=((None, "TX"),)), job()).value == 1.0
    assert location_part(austin, job(city="Dallas")).value == 0.6
    remote = job(city=None, region=None, remote_type="remote")
    assert location_part(austin, remote).reason == "Remote, as you prefer"
    assert location_part(Wants(remote_ok=False), remote).value == 0.0
    assert location_part(Wants(), job()).value == 0.5
    # A place we couldn't read is neutral, not a miss.
    assert location_part(austin, job(city=None, region=None, remote_type=None)).value == 0.5


def test_salary() -> None:
    floor = Wants(salary_floor=120_000)
    assert salary_part(floor, job(salary_max=150_000)).reason == "Pays up to $150,000"
    assert salary_part(floor, job(salary_min=100_000)).value == 0.0
    # Not posted: neutral, never a penalty.
    assert salary_part(floor, job()).value == 0.5


def test_recency_halves_every_14_days() -> None:
    assert recency_part(job(), NOW).value == 1.0
    assert recency_part(job(posted_at=NOW - timedelta(days=14)), NOW).value == pytest.approx(0.5)
    assert recency_part(job(posted_at=NOW - timedelta(days=1)), NOW).reason == "Posted yesterday"
    assert recency_part(job(posted_at=None), NOW).value == 0.5


def test_a_strong_match_scores_high_with_three_reasons() -> None:
    wants = Wants(
        titles=("Senior Software Engineer",),
        seniority=frozenset({"senior"}),
        locations=(("Austin", "TX"),),
        salary_floor=120_000,
        skills=("Python", "Postgres"),
    )
    result = fit(wants, job(salary_max=160_000), NOW)
    assert result.score >= 95
    assert result.reasons == [
        "Title matches “Senior Software Engineer”",
        "Mentions 2 of your skills",
        "In Austin, TX, where you want to work",
    ]
    # The bars under "Why it fits you": every part, each 0-100.
    assert [(p.label, p.value) for p in result.parts] == [
        ("Title", 100),
        ("Skills", 100),
        ("Location", 100),
        ("Posted", 100),
        ("Level", 100),
        ("Pay", 100),
    ]


def test_a_weak_match_scores_low() -> None:
    wants = Wants(
        titles=("Registered Nurse",),
        seniority=frozenset({"entry"}),
        locations=(("Portland", "OR"),),
        skills=("Patient care",),
    )
    old = job(posted_at=NOW - timedelta(days=60))
    assert fit(wants, old, NOW).score < 10
    assert fit(wants, old, NOW).reasons == []
    parts = {p.label: p.value for p in fit(wants, old, NOW).parts}
    assert parts["Title"] == 0
    assert parts["Location"] == 0
    assert 0 <= parts["Posted"] < 10


def test_scores_stay_between_0_and_100() -> None:
    assert 0 <= fit(Wants(), job(), NOW).score <= 100
