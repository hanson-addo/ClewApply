"""The job feed API (#24), including R28: unverified boards' jobs reach only their
followers. Every company, job and person here is made up."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.api import feed as feed_api
from clew.auth.deps import get_token_verifier
from clew.catalog.companies import board_company
from clew.catalog.merge import Posting, add_posting
from clew.main import create_app
from clew.models import Job, JobStatus
from tests.auth_helpers import SigningKey, make_token
from tests.test_auth import verifier

KEY = SigningKey("kid_feed")
NOW = datetime.now(UTC)


@pytest.fixture
async def sessions(test_database: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(test_database)
    makers = async_sessionmaker(engine, expire_on_commit=False)
    # Each test starts from an empty feed: other tests' jobs are closed.
    async with makers() as session:
        await session.execute(
            update(Job).where(Job.status == JobStatus.OPEN).values(status=JobStatus.CLOSED)
        )
        await session.commit()
    yield makers
    await engine.dispose()


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def as_user(name: str) -> dict[str, str]:
    sub = f"user_feed_{name}_{uuid.uuid4().hex[:8]}"
    return {"Authorization": f"Bearer {make_token(KEY, sub=sub, email=f'{sub}@example.test')}"}


@pytest.fixture
def alice() -> dict[str, str]:
    return as_user("alice")


@pytest.fixture
def bob() -> dict[str, str]:
    return as_user("bob")


def company() -> str:
    return f"Labyrinth Logistics {uuid.uuid4().hex[:8]}"


async def add(
    sessions: async_sessionmaker[AsyncSession],
    source: str = "greenhouse",
    company_name: str | None = None,
    **values: object,
) -> Job:
    fields: dict[str, object] = {
        "source": source,
        "source_job_id": uuid.uuid4().hex,
        "url": f"https://{source}.example.com/jobs/{uuid.uuid4().hex[:8]}",
        "company": company_name or company(),
        "title": "Software Engineer",
        "location": "Austin, TX",
        "posted_at": NOW - timedelta(days=1),
    }
    fields.update(values)
    async with sessions() as session:
        job = await add_posting(session, Posting(**fields), now=NOW)  # type: ignore[arg-type]
        await session.commit()
        return job


async def get_feed(api: AsyncClient, user: dict[str, str], **params: Any) -> dict[str, Any]:
    response = await api.get("/feed", headers=user, params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def titles(body: dict[str, Any]) -> list[str]:
    return [job["title"] for job in body["jobs"]]


async def test_feed_ranks_by_fit_with_reasons(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    await add(sessions, title="Registered Nurse", location="Portland, OR")
    await add(sessions, title="Senior Data Engineer", description="Spark and SQL.")
    await add(sessions, title="Sr. Software Engineer", description="Python and Postgres.")
    prefs = {"titles": ["Senior Software Engineer"], "locations": [{"region": "TX"}]}
    assert (await api.put("/preferences", headers=alice, json=prefs)).status_code == 200
    profile = {"data": {"skills": [{"name": "Python", "keywords": ["Postgres"]}]}}
    assert (await api.put("/profile", headers=alice, json=profile)).status_code in (200, 201)

    body = await get_feed(api, alice)
    # Portland is outside the user's places, so it's filtered out, not ranked low.
    assert titles(body) == ["Sr. Software Engineer", "Senior Data Engineer"]
    best = body["jobs"][0]
    assert best["fit_score"] > body["jobs"][1]["fit_score"]
    assert best["reasons"][:2] == [
        "Title matches “Senior Software Engineer”",
        "Mentions 2 of your skills",
    ]
    assert best["unverified_board"] is False
    assert best["apply_source"] == "greenhouse"
    assert best["apply_url"].startswith("https://greenhouse.example.com/")


async def test_seen_on_lists_every_source_best_first(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    name = company()
    await add(sessions, "email", name)
    await add(sessions, "usajobs", name)
    await add(sessions, "lever", name)
    [job] = (await get_feed(api, alice))["jobs"]
    assert job["seen_on"] == ["lever", "usajobs", "email"]
    assert job["apply_source"] == "lever"


async def test_unverified_boards_reach_only_their_followers(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    token = f"minotaur-{uuid.uuid4().hex[:8]}"
    follow = {"ats_type": "lever", "board_token": token}
    assert (await api.post("/companies/follow", headers=alice, json=follow)).status_code == 201
    async with sessions() as session:
        board = await board_company(session, "lever", token)
        await session.commit()
    await add(sessions, "lever", board.name, title="Maze Mapper", company_id=board.id)

    [job] = (await get_feed(api, alice))["jobs"]
    assert (job["title"], job["unverified_board"]) == ("Maze Mapper", True)
    assert (await get_feed(api, bob))["jobs"] == []

    await api.delete(f"/companies/follow/lever/{token}", headers=alice)
    assert (await get_feed(api, alice))["jobs"] == []


async def test_dealbreakers_filter_jobs_out(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    skipped = company()
    await add(sessions, company_name=f"{skipped}, Inc.", title="Kept Out By Company")
    await add(sessions, title="Night Shift Engineer")
    await add(sessions, title="Underpaid Engineer", salary_max=50_000)
    await add(sessions, title="Remote Engineer", location="Remote")
    await add(sessions, title="Engineer With Pay Not Posted")
    await add(sessions, title="Engineer Somewhere", location=None)
    prefs = {
        "excluded_companies": [skipped],
        "excluded_keywords": ["night shift"],
        "salary_floor": 90_000,
        "remote_ok": False,
        "locations": [{"region": "TX"}],
    }
    assert (await api.put("/preferences", headers=alice, json=prefs)).status_code == 200
    body = await get_feed(api, alice)
    # A job we can't place stays in, so a missing location never hides it.
    assert sorted(titles(body)) == ["Engineer Somewhere", "Engineer With Pay Not Posted"]


async def test_filters(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    await add(sessions, title="Remote One", location="Remote")
    await add(sessions, title="Denver One", location="Denver, CO", salary_max=150_000)
    await add(sessions, "usajobs", title="Old One", posted_at=NOW - timedelta(days=40))

    assert titles(await get_feed(api, alice, remote="true")) == ["Remote One"]
    assert set(titles(await get_feed(api, alice, remote="false"))) == {"Denver One", "Old One"}
    assert titles(await get_feed(api, alice, region="Colorado")) == ["Denver One"]
    assert titles(await get_feed(api, alice, min_salary=100_000)) == ["Denver One"]
    assert "Old One" not in titles(await get_feed(api, alice, posted_within_days=30))
    assert titles(await get_feed(api, alice, source="usajobs")) == ["Old One"]


async def test_closed_jobs_leave_the_feed(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    job = await add(sessions)
    async with sessions() as session:
        await session.execute(update(Job).where(Job.id == job.id).values(status="closed"))
        await session.commit()
    assert (await get_feed(api, alice))["jobs"] == []


async def test_pagination(
    api: AsyncClient,
    alice: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for day in range(5):
        await add(sessions, title=f"Engineer {day}", posted_at=NOW - timedelta(days=day))
    first = await get_feed(api, alice, per_page=2)
    second = await get_feed(api, alice, per_page=2, page=2)
    third = await get_feed(api, alice, per_page=2, page=3)
    assert (first["total"], first["has_more"], third["has_more"]) == (5, True, False)
    seen = titles(first) + titles(second) + titles(third)
    # Equal fit otherwise, so newer jobs come first.
    assert seen == [f"Engineer {day}" for day in range(5)]

    monkeypatch.setattr(feed_api, "CANDIDATES", 3)
    assert (await get_feed(api, alice))["total"] == 3


@pytest.mark.parametrize(
    "params",
    [
        {"region": "Ontario"},
        {"page": 0},
        {"per_page": 51},
        {"posted_within_days": 91},
        {"min_salary": -1},
        {"source": "linkedin"},
    ],
)
async def test_bad_filters(api: AsyncClient, alice: dict[str, str], params: dict[str, Any]) -> None:
    assert (await api.get("/feed", headers=alice, params=params)).status_code == 422


async def test_feed_needs_a_session(api: AsyncClient) -> None:
    assert (await api.get("/feed")).status_code == 401


# --- The jobs map (#119) ------------------------------------------------------------------


async def get_map(api: AsyncClient, user: dict[str, str]) -> dict[str, Any]:
    response = await api.get("/feed/map", headers=user)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_map_pins_placed_jobs_best_fit_first(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    await add(sessions, title="Data Engineer", location="Austin, TX")
    await add(sessions, title="Senior Software Engineer", location="Dallas, TX")
    await add(sessions, title="Remote Engineer", location="Remote")
    prefs = {
        "titles": ["Senior Software Engineer"],
        "locations": [{"city": "Austin", "region": "TX"}],
    }
    assert (await api.put("/preferences", headers=alice, json=prefs)).status_code == 200

    body = await get_map(api, alice)
    assert [pin["title"] for pin in body["pins"]] == ["Senior Software Engineer", "Data Engineer"]
    dallas = body["pins"][0]
    assert dallas["lat"] == pytest.approx(32.78, abs=0.05)
    assert dallas["unverified_board"] is False
    # The remote job passes the filters but has no pin.
    assert body["unplaced"] == 1
    assert body["center"] == {"lat": pytest.approx(30.267), "lng": pytest.approx(-97.743)}


async def test_map_follows_the_feed_rules(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    token = f"minotaur-{uuid.uuid4().hex[:8]}"
    follow = {"ats_type": "lever", "board_token": token}
    assert (await api.post("/companies/follow", headers=alice, json=follow)).status_code == 201
    async with sessions() as session:
        board = await board_company(session, "lever", token)
        await session.commit()
    await add(sessions, "lever", board.name, title="Maze Mapper", company_id=board.id)
    dismissed = await add(sessions, title="Dismissed Engineer")
    await add(sessions, title="Night Shift Engineer")
    assert (await api.post(f"/jobs/{dismissed.id}/dismiss", headers=alice)).status_code == 204
    prefs = {"excluded_keywords": ["night shift"]}
    assert (await api.put("/preferences", headers=alice, json=prefs)).status_code == 200

    # R28: the unverified board's job shows only to its follower, labeled.
    [pin] = (await get_map(api, alice))["pins"]
    assert (pin["title"], pin["unverified_board"]) == ("Maze Mapper", True)
    assert {p["title"] for p in (await get_map(api, bob))["pins"]} == {
        "Dismissed Engineer",
        "Night Shift Engineer",
    }
    assert (await get_map(api, bob))["center"] is None


async def test_map_needs_a_session(api: AsyncClient) -> None:
    assert (await api.get("/feed/map")).status_code == 401
