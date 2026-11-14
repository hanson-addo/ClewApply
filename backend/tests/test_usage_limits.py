"""Per-user caps on uploads and profile saves, and pruning old profile versions (#64)."""

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from clew.api.profile import TOO_MANY_SAVES
from clew.api.resumes import TOO_MANY_STORED, TOO_MANY_UPLOADS
from clew.auth.deps import get_token_verifier
from clew.config import get_settings
from clew.main import create_app
from clew.maintenance import main, prune_profile_versions
from clew.models import Profile, ProfileVersion, Resume, UsageEvent, UsageKind
from clew.scanning import get_malware_scanner
from clew.storage import get_object_store
from tests.auth_helpers import SigningKey, make_token
from tests.file_helpers import FAKE_PDF
from tests.test_auth import verifier
from tests.test_resumes import FakeScanner, MemoryStore

KEY = SigningKey("kid_usage_limits")


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    store, scanner = MemoryStore(), FakeScanner()
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    app.dependency_overrides[get_object_store] = lambda: store
    app.dependency_overrides[get_malware_scanner] = lambda: scanner
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def new_user() -> dict[str, str]:
    sub = f"user_limits_{uuid.uuid4().hex[:8]}"
    return {"Authorization": f"Bearer {make_token(KEY, sub=sub, email=f'{sub}@example.test')}"}


async def user_id(api: AsyncClient, who: dict[str, str]) -> uuid.UUID:
    return uuid.UUID((await api.get("/me", headers=who)).json()["id"])


async def upload(api: AsyncClient, who: dict[str, str], data: bytes = FAKE_PDF) -> Any:
    return await api.post("/resumes", headers=who, files={"file": ("cv.pdf", data, "x/y")})


def profile(name: str) -> dict[str, Any]:
    return {"data": {"basics": {"name": name}}}


# --- uploads -------------------------------------------------------------------------------


async def test_uploads_per_hour_are_capped(
    api: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "resume_uploads_per_hour", 2)
    who = new_user()
    assert (await upload(api, who)).status_code == 201
    # A file refused for its type never reaches the scan, so it doesn't count.
    assert (await upload(api, who, b"not a resume")).status_code == 415
    assert (await upload(api, who)).status_code == 201

    refused = await upload(api, who)
    assert refused.status_code == 429
    assert refused.json() == {"detail": TOO_MANY_UPLOADS}

    # Uploads older than an hour no longer count.
    await db.execute(
        update(UsageEvent)
        .where(UsageEvent.user_id == await user_id(api, who))
        .values(created_at=func.now() - timedelta(hours=1, minutes=1))
    )
    await db.commit()
    assert (await upload(api, who)).status_code == 201


async def test_stored_resumes_are_capped(
    api: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "resumes_stored_max", 2)
    who = new_user()
    first = (await upload(api, who)).json()["id"]
    assert (await upload(api, who)).status_code == 201

    refused = await upload(api, who)
    assert refused.status_code == 429
    assert refused.json() == {"detail": TOO_MANY_STORED}

    # A deleted resume frees its place.
    await db.execute(
        update(Resume).where(Resume.id == uuid.UUID(first)).values(deleted_at=func.now())
    )
    await db.commit()
    assert (await upload(api, who)).status_code == 201


async def test_one_users_uploads_dont_count_for_another(
    api: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "resume_uploads_per_hour", 1)
    alice, bob = new_user(), new_user()
    assert (await upload(api, alice)).status_code == 201
    assert (await upload(api, bob)).status_code == 201
    assert (await upload(api, alice)).status_code == 429


# --- profile saves -------------------------------------------------------------------------


async def test_profile_saves_per_hour_are_capped(
    api: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "profile_saves_per_hour", 2)
    who = new_user()
    assert (await api.put("/profile", headers=who, json=profile("Jordan One"))).status_code == 200
    assert (await api.put("/profile", headers=who, json=profile("Jordan Two"))).status_code == 200
    # Saving the same data again adds no version, so it doesn't count.
    assert (await api.put("/profile", headers=who, json=profile("Jordan Two"))).status_code == 200

    refused = await api.put("/profile", headers=who, json=profile("Jordan Three"))
    assert refused.status_code == 429
    assert refused.json() == {"detail": TOO_MANY_SAVES}
    current = await api.get("/profile", headers=who)
    assert current.json()["data"]["basics"]["name"] == "Jordan Two"


# --- pruning -------------------------------------------------------------------------------


@pytest.fixture
async def owner_sessions(
    test_database: str, db: AsyncSession
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Sessions as a plain role (no superuser, no BYPASSRLS), like a managed database's
    owner, so forced row-level security applies to the prune as it would in production."""
    role = f"clew_test_pruner_{uuid.uuid4().hex[:8]}"
    await db.execute(text(f"CREATE ROLE {role} NOLOGIN NOSUPERUSER NOBYPASSRLS"))
    await db.execute(text(f"GRANT SELECT ON users, profiles TO {role}"))
    await db.execute(text(f"GRANT SELECT, DELETE ON profile_versions TO {role}"))
    await db.commit()
    engine = create_async_engine(test_database)

    @event.listens_for(engine.sync_engine, "connect")
    def _as_role(connection: Any, _record: Any) -> None:
        cursor = connection.cursor()
        cursor.execute(f"SET ROLE {role}")
        cursor.close()

    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()
    await db.execute(text(f"REVOKE ALL ON users, profiles, profile_versions FROM {role}"))
    await db.execute(text(f"DROP ROLE {role}"))
    await db.commit()


async def versions(db: AsyncSession, uid: uuid.UUID) -> list[int]:
    rows = await db.scalars(
        select(ProfileVersion.number)
        .where(ProfileVersion.user_id == uid)
        .order_by(ProfileVersion.number)
    )
    return list(rows)


async def test_pruning_keeps_the_newest_versions_and_the_current_one(
    api: AsyncClient,
    db: AsyncSession,
    owner_sessions: async_sessionmaker[AsyncSession],
) -> None:
    alice, bob = new_user(), new_user()
    for n in range(5):
        await api.put("/profile", headers=alice, json=profile(f"Alice {n}"))
    for n in range(2):
        await api.put("/profile", headers=bob, json=profile(f"Bob {n}"))
    alice_id, bob_id = await user_id(api, alice), await user_id(api, bob)
    # Make Alice's oldest version current, as if she had gone back to it.
    oldest = await db.scalar(
        select(ProfileVersion.id).where(
            ProfileVersion.user_id == alice_id, ProfileVersion.number == 1
        )
    )
    await db.execute(
        update(Profile).where(Profile.user_id == alice_id).values(current_version_id=oldest)
    )
    await db.commit()

    deleted = await prune_profile_versions(owner_sessions, keep=2)

    assert await versions(db, alice_id) == [1, 4, 5]
    assert await versions(db, bob_id) == [1, 2]
    assert deleted >= 2
    # Running it again finds nothing more of theirs to delete.
    await prune_profile_versions(owner_sessions, keep=2)
    assert await versions(db, alice_id) == [1, 4, 5]


async def test_upload_usage_is_recorded_as_its_own_kind(api: AsyncClient, db: AsyncSession) -> None:
    who = new_user()
    await upload(api, who)
    kinds = await db.scalars(
        select(UsageEvent.kind).where(UsageEvent.user_id == await user_id(api, who))
    )
    assert list(kinds) == [UsageKind.RESUME_UPLOAD]


def test_fetch_jobs_runs_the_worker_fetches(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    ran: list[str] = []

    async def boards(ctx: dict[str, Any]) -> None:
        ran.append("boards")

    async def usajobs(ctx: dict[str, Any]) -> None:
        ran.append("usajobs")

    monkeypatch.setattr("clew.worker.poll_boards", boards)
    monkeypatch.setattr("clew.worker.read_usajobs", usajobs)
    main(["fetch-jobs"])
    assert ran == ["boards", "usajobs"]
    assert capsys.readouterr().out == "Done.\n"
