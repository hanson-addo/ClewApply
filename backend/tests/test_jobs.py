"""One job in full, and saving or dismissing it (#24). Everything here is made up."""

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.catalog.companies import board_company
from clew.db.session import bind_user
from clew.models import Job, JobFeedback, JobSource
from tests.test_feed import add, alice, api, bob, company, get_feed, sessions, titles

__all__ = ["alice", "api", "bob", "sessions"]  # fixtures shared with test_feed


async def test_job_detail_has_everything(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    name = company()
    job = await add(sessions, "usajobs", name, description="Wind thread through the maze.")
    await add(sessions, "greenhouse", name)
    response = await api.get(f"/jobs/{job.id}", headers=alice)
    assert response.status_code == 200
    detail: dict[str, Any] = response.json()
    assert detail["description"] == "Wind thread through the maze."
    assert (detail["status"], detail["saved"], detail["dismissed"]) == ("open", False, False)
    assert [(item["source"], item["is_primary"]) for item in detail["listings"]] == [
        ("greenhouse", True),
        ("usajobs", False),
    ]
    assert detail["apply_source"] == "greenhouse"
    assert detail["seen_on"] == ["greenhouse", "usajobs"]
    assert 0 <= detail["fit_score"] <= 100
    assert [part["label"] for part in detail["fit_parts"]] == [
        "Title",
        "Skills",
        "Location",
        "Posted",
        "Level",
        "Pay",
    ]
    assert all(0 <= part["value"] <= 100 for part in detail["fit_parts"])


async def test_closed_jobs_can_still_be_opened(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    job = await add(sessions)
    async with sessions() as session:
        await session.execute(update(Job).where(Job.id == job.id).values(status="closed"))
        await session.commit()
    assert (await api.get(f"/jobs/{job.id}", headers=alice)).json()["status"] == "closed"


async def test_unknown_and_unverified_jobs_are_404(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    assert (await api.get(f"/jobs/{uuid.uuid4()}", headers=alice)).status_code == 404
    token = f"minotaur-{uuid.uuid4().hex[:8]}"
    follow = {"ats_type": "ashby", "board_token": token}
    await api.post("/companies/follow", headers=alice, json=follow)
    async with sessions() as session:
        board = await board_company(session, "ashby", token)
        await session.commit()
    job = await add(sessions, "ashby", board.name, company_id=board.id)

    detail = (await api.get(f"/jobs/{job.id}", headers=alice)).json()
    assert detail["unverified_board"] is True
    # Bob doesn't follow the board: to him it doesn't exist (R28).
    assert (await api.get(f"/jobs/{job.id}", headers=bob)).status_code == 404
    assert (await api.post(f"/jobs/{job.id}/save", headers=bob)).status_code == 404
    assert (await api.post(f"/jobs/{job.id}/dismiss", headers=bob)).status_code == 404


async def test_dismissed_jobs_leave_the_feed_until_undone(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    job = await add(sessions, title="Thread Winder")
    await add(sessions, title="Maze Mapper")
    assert (await api.post(f"/jobs/{job.id}/dismiss", headers=alice)).status_code == 204
    assert titles(await get_feed(api, alice)) == ["Maze Mapper"]
    assert (await api.get(f"/jobs/{job.id}", headers=alice)).json()["dismissed"] is True

    assert (await api.delete(f"/jobs/{job.id}/feedback", headers=alice)).status_code == 204
    assert sorted(titles(await get_feed(api, alice))) == ["Maze Mapper", "Thread Winder"]
    assert (await api.delete(f"/jobs/{job.id}/feedback", headers=alice)).status_code == 404


async def test_saving_marks_the_job_and_filters_to_saved(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    job = await add(sessions, title="Thread Winder")
    await add(sessions, title="Maze Mapper")
    assert (await api.post(f"/jobs/{job.id}/save", headers=alice)).status_code == 204
    assert (await api.post(f"/jobs/{job.id}/save", headers=alice)).status_code == 204
    feed = await get_feed(api, alice)
    assert {j["title"]: j["saved"] for j in feed["jobs"]} == {
        "Thread Winder": True,
        "Maze Mapper": False,
    }
    assert titles(await get_feed(api, alice, saved="true")) == ["Thread Winder"]

    # Dismissing a saved job replaces the save, and saving brings it back.
    await api.post(f"/jobs/{job.id}/dismiss", headers=alice)
    assert titles(await get_feed(api, alice, saved="true")) == []
    await api.post(f"/jobs/{job.id}/save", headers=alice)
    assert "Thread Winder" in titles(await get_feed(api, alice))


async def test_feedback_is_private(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
    app_db: AsyncSession,
) -> None:
    job = await add(sessions)
    await api.post(f"/jobs/{job.id}/dismiss", headers=alice)
    assert titles(await get_feed(api, bob)) == ["Software Engineer"]
    assert (await api.delete(f"/jobs/{job.id}/feedback", headers=bob)).status_code == 404

    # Row-level security: bob's session sees none of alice's feedback.
    bob_id = uuid.UUID((await api.get("/me", headers=bob)).json()["id"])
    await bind_user(app_db, bob_id)
    assert (await app_db.scalars(select(JobFeedback))).all() == []
    await app_db.rollback()


async def test_a_job_without_a_primary_link_still_shows(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    name = company()
    job = await add(sessions, "email", name)
    await add(sessions, "usajobs", name)
    async with sessions() as session:
        await session.execute(
            update(JobSource).where(JobSource.job_id == job.id).values(is_primary=False)
        )
        await session.commit()
    [card] = (await get_feed(api, alice))["jobs"]
    assert card["apply_source"] == "usajobs"


async def test_job_routes_need_a_session(api: AsyncClient) -> None:
    job_id = uuid.uuid4()
    assert (await api.get(f"/jobs/{job_id}")).status_code == 401
    assert (await api.post(f"/jobs/{job_id}/save")).status_code == 401
    assert (await api.post(f"/jobs/{job_id}/dismiss")).status_code == 401
    assert (await api.delete(f"/jobs/{job_id}/feedback")).status_code == 401
