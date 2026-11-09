"""The application tracker (#26). Everything here is made up."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.api.applications import move
from clew.models import Application, ApplicationStatus, Job, Resume
from tests.test_feed import add, alice, api, bob, get_feed, sessions
from tests.test_profile import profile, save, user_id

__all__ = ["alice", "api", "bob", "sessions"]  # fixtures shared with test_feed

S = ApplicationStatus


async def board(api: AsyncClient, who: dict[str, str]) -> list[dict[str, Any]]:
    response = await api.get("/applications", headers=who)
    assert response.status_code == 200, response.text
    apps: list[dict[str, Any]] = response.json()["applications"]
    return apps


async def add_by_hand(api: AsyncClient, who: dict[str, str], **body: Any) -> dict[str, Any]:
    fields = {"title": "Thread Winder", "company": "Minotaur Freight", **body}
    response = await api.post("/applications", headers=who, json=fields)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def set_status(api: AsyncClient, who: dict[str, str], app_id: str, to: str) -> dict[str, Any]:
    response = await api.patch(f"/applications/{app_id}/status", headers=who, json={"status": to})
    assert response.status_code == 200, response.text
    moved: dict[str, Any] = response.json()
    return moved


# Status rules, without the database.

NOW = datetime(2026, 11, 8, 12, tzinfo=UTC)


def fresh(status: ApplicationStatus = S.SAVED) -> Application:
    return Application(status=status, applied_at=None, closed_at=None)


@pytest.mark.parametrize("to", [S.APPLIED, S.INTERVIEW, S.OFFER, S.REJECTED, S.WITHDRAWN])
def test_any_status_past_saved_sets_applied_at(to: ApplicationStatus) -> None:
    app = fresh()
    move(app, to, NOW)
    assert (app.status, app.applied_at) == (to, NOW)


def test_applied_at_is_set_once_and_kept() -> None:
    app = fresh()
    move(app, S.APPLIED, NOW)
    move(app, S.SAVED, NOW + timedelta(days=1))
    move(app, S.INTERVIEW, NOW + timedelta(days=2))
    assert app.applied_at == NOW


def test_saved_stays_unapplied() -> None:
    app = fresh(S.APPLIED)
    move(app, S.SAVED, NOW)
    assert (app.applied_at, app.closed_at) == (None, None)


def test_closing_and_reopening() -> None:
    app = fresh()
    move(app, S.APPLIED, NOW)
    move(app, S.WITHDRAWN, NOW + timedelta(days=3))
    assert app.closed_at == NOW + timedelta(days=3)
    # Rejected after withdrawn is still closed: the close date stays.
    move(app, S.REJECTED, NOW + timedelta(days=4))
    assert (app.status, app.closed_at) == (S.REJECTED, NOW + timedelta(days=3))
    move(app, S.APPLIED, NOW + timedelta(days=5))
    assert app.status == S.APPLIED
    assert app.closed_at is None
    assert app.applied_at == NOW


# The API.


async def test_add_by_hand_and_read_back(api: AsyncClient, alice: dict[str, str]) -> None:
    created = await add_by_hand(
        api, alice, url="https://jobs.example.test/42", notes="Ask about the maze."
    )
    assert created["status"] == "applied"
    assert created["applied_at"] is not None
    assert (created["job_id"], created["job_status"], created["closed_at"]) == (None, None, None)
    got = (await api.get(f"/applications/{created['id']}", headers=alice)).json()
    assert got == created
    assert [a["id"] for a in await board(api, alice)] == [created["id"]]


async def test_add_by_hand_as_saved_with_a_date(api: AsyncClient, alice: dict[str, str]) -> None:
    saved = await add_by_hand(api, alice, status="saved", applied_at="2026-10-20T09:00:00Z")
    # A Saved application hasn't been sent, so the date is ignored.
    assert saved["applied_at"] is None
    edited = await api.patch(
        f"/applications/{saved['id']}", headers=alice, json={"applied_at": "2026-10-21T09:00:00Z"}
    )
    assert edited.json()["applied_at"] is None
    notes = "Line one\nLine two\twith a tab"
    assert (await add_by_hand(api, alice, notes=notes))["notes"] == notes
    when = "2026-10-20T09:00:00Z"
    dated = await add_by_hand(api, alice, applied_at=when)
    assert dated["applied_at"].startswith("2026-10-20T09:00:00")


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": "Thread Winder"},
        {"title": "   ", "company": "Minotaur Freight"},
        {"title": "Thread Winder", "company": "Minotaur Freight", "url": "javascript:alert(1)"},
        {"title": "Thread Winder", "company": "Minotaur Freight", "url": "ftp://x.example.test"},
        {"title": "Thread Winder", "company": "Minotaur Freight", "url": "https://a.test/x y"},
        {"title": "Thread\x07 Winder", "company": "Minotaur Freight"},
        {"title": "Thread Winder", "company": "Minotaur\x00 Freight"},
        {"title": "Thread Winder", "company": "Minotaur Freight", "notes": "bell\x07"},
        {"title": "Thread Winder", "company": "Minotaur Freight", "status": "ghosted"},
        {"title": "x" * 301, "company": "Minotaur Freight"},
        {"title": "Thread Winder", "company": "Minotaur Freight", "notes": "n" * 5001},
        {"title": "Thread Winder", "company": "Minotaur Freight", "profile_version": 0},
    ],
)
async def test_bad_applications_are_refused(
    api: AsyncClient, alice: dict[str, str], body: dict[str, Any]
) -> None:
    response = await api.post("/applications", headers=alice, json=body)
    assert response.status_code == 422, response.text
    assert await board(api, alice) == []


async def test_every_status_change(api: AsyncClient, alice: dict[str, str]) -> None:
    app = await add_by_hand(api, alice, status="saved")
    for to in ["applied", "interview", "offer", "rejected", "withdrawn", "saved"]:
        moved = await set_status(api, alice, app["id"], to)
        assert moved["status"] == to
        assert (moved["closed_at"] is not None) == (to in {"rejected", "withdrawn"})
    bad = await api.patch(
        f"/applications/{app['id']}/status", headers=alice, json={"status": "closed"}
    )
    assert bad.status_code == 422


async def test_reopen_keeps_notes_what_was_sent_and_applied_date(
    api: AsyncClient, alice: dict[str, str]
) -> None:
    await save(api, alice, profile())
    app = await add_by_hand(api, alice, notes="Second round Friday.", profile_version=1)
    withdrawn = await set_status(api, alice, app["id"], "withdrawn")
    assert withdrawn["status"] == "withdrawn"
    reopened = await set_status(api, alice, app["id"], "applied")
    assert reopened["closed_at"] is None
    for kept in ["notes", "profile_version", "applied_at"]:
        assert reopened[kept] == app[kept]
    # It survives a reload.
    assert (await api.get(f"/applications/{app['id']}", headers=alice)).json()["status"] == (
        "applied"
    )


async def test_rejected_and_withdrawn_stay_apart(api: AsyncClient, alice: dict[str, str]) -> None:
    one = await add_by_hand(api, alice, title="Maze Mapper")
    two = await add_by_hand(api, alice, title="Thread Winder")
    await set_status(api, alice, one["id"], "rejected")
    await set_status(api, alice, two["id"], "withdrawn")
    statuses = {a["title"]: a["status"] for a in await board(api, alice)}
    assert statuses == {"Maze Mapper": "rejected", "Thread Winder": "withdrawn"}


async def test_edit_notes_link_and_what_was_sent(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    app = await add_by_hand(api, alice, url="https://jobs.example.test/1")
    owner = await user_id(alice, api)
    async with sessions() as session:
        resume = Resume(
            user_id=owner,
            file_key=f"test/{uuid.uuid4().hex}",
            filename="resume.pdf",
            content_type="application/pdf",
            size_bytes=10,
            sha256="0" * 64,
            scan_status="clean",
        )
        session.add(resume)
        await session.commit()
    changed = await api.patch(
        f"/applications/{app['id']}",
        headers=alice,
        json={"notes": "Called back.", "url": None, "resume_id": str(resume.id)},
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert (body["notes"], body["url"], body["resume_id"]) == ("Called back.", None, str(resume.id))
    assert (body["resume_name"], body["resume_deleted"]) == ("resume.pdf", False)
    assert body["title"] == app["title"]

    # After the user deletes the file, the record of what was sent stays, marked deleted.
    async with sessions() as session:
        await session.execute(
            update(Resume).where(Resume.id == resume.id).values(deleted_at=datetime.now(UTC))
        )
        await session.commit()
    [listed] = await board(api, alice)
    assert (listed["resume_id"], listed["resume_deleted"]) == (str(resume.id), True)

    # Removing the file row clears only the link to it.
    async with sessions() as session:
        await session.delete(await session.get(Resume, resume.id))
        await session.commit()
    after = (await api.get(f"/applications/{app['id']}", headers=alice)).json()
    assert (after["resume_id"], after["notes"]) == (None, "Called back.")


@pytest.mark.parametrize(
    "change",
    [
        {"title": None},
        {"company": ""},
        {"notes": None},
        {"url": "data:text/html,hi"},
        {"resume_id": str(uuid.uuid4())},
        {"profile_version": 99},
    ],
)
async def test_bad_edits_are_refused(
    api: AsyncClient, alice: dict[str, str], change: dict[str, Any]
) -> None:
    app = await add_by_hand(api, alice)
    response = await api.patch(f"/applications/{app['id']}", headers=alice, json=change)
    assert response.status_code == 422, response.text
    assert (await api.get(f"/applications/{app['id']}", headers=alice)).json() == app


async def test_another_users_resume_cannot_be_recorded(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    owner = await user_id(bob, api)
    async with sessions() as session:
        resume = Resume(
            user_id=owner,
            file_key=f"test/{uuid.uuid4().hex}",
            filename="resume.pdf",
            content_type="application/pdf",
            size_bytes=10,
            sha256="0" * 64,
            scan_status="clean",
        )
        session.add(resume)
        await session.commit()
    response = await api.post(
        "/applications",
        headers=alice,
        json={"title": "Maze Mapper", "company": "Minotaur Freight", "resume_id": str(resume.id)},
    )
    assert response.status_code == 422


async def test_delete(api: AsyncClient, alice: dict[str, str]) -> None:
    app = await add_by_hand(api, alice)
    assert (await api.delete(f"/applications/{app['id']}", headers=alice)).status_code == 204
    assert (await api.get(f"/applications/{app['id']}", headers=alice)).status_code == 404
    assert (await api.delete(f"/applications/{app['id']}", headers=alice)).status_code == 404
    assert await board(api, alice) == []


async def test_other_users_applications_are_404(
    api: AsyncClient, alice: dict[str, str], bob: dict[str, str]
) -> None:
    app = await add_by_hand(api, alice)
    url = f"/applications/{app['id']}"
    assert (await api.get(url, headers=bob)).status_code == 404
    assert (await api.patch(url, headers=bob, json={"notes": "x"})).status_code == 404
    assert (
        await api.patch(f"{url}/status", headers=bob, json={"status": "offer"})
    ).status_code == 404
    assert (await api.delete(url, headers=bob)).status_code == 404
    assert await board(api, bob) == []
    assert (await api.get(url, headers=alice)).json() == app


async def test_routes_need_a_session(api: AsyncClient) -> None:
    some = uuid.uuid4()
    assert (await api.get("/applications")).status_code == 401
    assert (await api.post("/applications", json={})).status_code == 401
    assert (await api.get(f"/applications/{some}")).status_code == 401
    assert (await api.delete(f"/applications/{some}")).status_code == 401


# Saving in the feed.


async def test_saving_a_job_adds_it_to_saved(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    job = await add(sessions, title="Maze Mapper")
    assert (await api.post(f"/jobs/{job.id}/save", headers=alice)).status_code == 204
    [app] = await board(api, alice)
    assert (app["job_id"], app["status"], app["title"]) == (str(job.id), "saved", "Maze Mapper")
    assert app["job_status"] == "open"
    assert app["url"].startswith("https://greenhouse.example.com/")
    # Saving again changes nothing.
    await api.post(f"/jobs/{job.id}/save", headers=alice)
    assert len(await board(api, alice)) == 1

    # Once the posting closes, the card says so.
    async with sessions() as session:
        await session.execute(update(Job).where(Job.id == job.id).values(status="closed"))
        await session.commit()
    assert (await board(api, alice))[0]["job_status"] == "closed"


async def test_unsaving_removes_only_a_still_saved_application(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    kept = await add(sessions, title="Maze Mapper")
    dropped = await add(sessions, title="Thread Winder")
    for job in (kept, dropped):
        await api.post(f"/jobs/{job.id}/save", headers=alice)
    applied = next(a for a in await board(api, alice) if a["title"] == "Maze Mapper")
    await set_status(api, alice, applied["id"], "applied")

    await api.delete(f"/jobs/{kept.id}/feedback", headers=alice)
    await api.post(f"/jobs/{dropped.id}/dismiss", headers=alice)
    assert [a["title"] for a in await board(api, alice)] == ["Maze Mapper"]


async def test_deleting_an_application_unsaves_its_job(
    api: AsyncClient, alice: dict[str, str], sessions: async_sessionmaker[AsyncSession]
) -> None:
    job = await add(sessions)
    await api.post(f"/jobs/{job.id}/save", headers=alice)
    [app] = await board(api, alice)
    await api.delete(f"/applications/{app['id']}", headers=alice)
    assert (await get_feed(api, alice))["jobs"][0]["saved"] is False


async def test_logging_a_feed_job_as_applied(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    job = await add(sessions, title="Maze Mapper")
    created = await api.post("/applications", headers=alice, json={"job_id": str(job.id)})
    assert created.status_code == 201, created.text
    assert (created.json()["title"], created.json()["status"]) == ("Maze Mapper", "applied")
    again = await api.post("/applications", headers=alice, json={"job_id": str(job.id)})
    assert (again.status_code, again.json()["detail"]) == (409, "already_tracked")
    missing = await api.post("/applications", headers=bob, json={"job_id": str(uuid.uuid4())})
    assert missing.status_code == 404
