"""Download your data and delete your account (#31), both behind reverification (AUTH-15)."""

import io
import json
import uuid
import zipfile
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from clew.account import EXPORTED
from clew.auth.clerk_admin import ClerkBackendApi, NoClerkAdmin, get_clerk_admin
from clew.auth.deps import get_token_verifier
from clew.config import get_settings
from clew.main import create_app
from clew.models import Resume, User
from clew.scanning import get_malware_scanner
from clew.storage import get_object_store
from tests.auth_helpers import SigningKey, make_token
from tests.file_helpers import FAKE_PDF
from tests.test_auth import verifier
from tests.test_resumes import FakeScanner, MemoryStore

KEY = SigningKey("kid_account")
FRESH = [2, -1]  # Clerk "fva": first factor 2 minutes ago, no second factor.


class FakeClerk:
    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.ok = True

    async def delete_user(self, clerk_user_id: str) -> bool:
        self.deleted.append(clerk_user_id)
        return self.ok


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def clerk() -> FakeClerk:
    return FakeClerk()


@pytest.fixture
async def api(store: MemoryStore, clerk: FakeClerk) -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    scanner = FakeScanner()
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    app.dependency_overrides[get_object_store] = lambda: store
    app.dependency_overrides[get_malware_scanner] = lambda: scanner
    app.dependency_overrides[get_clerk_admin] = lambda: clerk
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def as_user(sub: str, fva: list[int] | None = FRESH) -> dict[str, str]:
    extra: dict[str, Any] = {} if fva is None else {"fva": fva}
    token = make_token(KEY, sub=sub, email=f"{sub}@example.test", **extra)
    return {"Authorization": f"Bearer {token}"}


async def set_up(api: AsyncClient, sub: str) -> dict[str, str]:
    """A made-up user with a profile, preferences, an application and a resume."""
    who = as_user(sub)
    profile = {"basics": {"name": "Jordan Testperson", "email": f"{sub}@example.test"}}
    assert (await api.put("/profile", headers=who, json={"data": profile})).status_code == 200
    prefs = {"titles": ["Thread Analyst"], "locations": [], "remote_ok": True}
    assert (await api.put("/preferences", headers=who, json=prefs)).status_code == 200
    app = {"title": "Thread Analyst", "company": "Labyrinth Logistics", "status": "saved"}
    assert (await api.post("/applications", headers=who, json=app)).status_code == 201
    files = {"file": ("Jordan CV.pdf", FAKE_PDF, "application/pdf")}
    assert (await api.post("/resumes", headers=who, files=files)).status_code == 201
    return who


# --- reverification -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fva",
    [None, [-1, -1], [10, -1], [45, 3]],
    ids=["no claim", "never verified", "exactly 10 minutes", "only a fresh second factor"],
)
async def test_both_actions_need_a_recent_sign_in(api: AsyncClient, fva: list[int] | None) -> None:
    who = as_user(f"user_acct_stale_{uuid.uuid4().hex[:6]}", fva=fva)
    for response in (
        await api.post("/me/export", headers=who),
        await api.delete("/me", headers=who),
    ):
        assert response.status_code == 403
        # The shape Clerk's useReverification hook looks for.
        assert response.json() == {
            "clerk_error": {
                "type": "forbidden",
                "reason": "reverification-error",
                "metadata": {"reverification": {"level": "first_factor", "afterMinutes": 10}},
            }
        }
    assert (await api.get("/me", headers=who)).status_code == 200


async def test_both_actions_need_a_session(api: AsyncClient) -> None:
    assert (await api.post("/me/export")).status_code == 401
    assert (await api.delete("/me")).status_code == 401


# --- export ---------------------------------------------------------------------------------


async def test_export_has_every_table_and_the_resume_file(api: AsyncClient) -> None:
    who = await set_up(api, "user_acct_export")
    response = await api.post("/me/export", headers=who)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-disposition"] == 'attachment; filename="clew-data.zip"'
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert archive.read("resumes/01-Jordan CV.pdf") == FAKE_PDF
    data = json.loads(archive.read("data.json"))
    assert data["account"]["email"] == "user_acct_export@example.test"
    assert set(EXPORTED) <= set(data)
    assert data["profile_versions"][0]["data"]["basics"]["name"] == "Jordan Testperson"
    assert data["applications"][0]["company"] == "Labyrinth Logistics"
    assert data["job_preferences"][0]["titles"] == ["Thread Analyst"]
    assert data["resumes"][0]["filename"] == "Jordan CV.pdf"
    # Internal fields stay out.
    assert "file_key" not in data["resumes"][0]
    assert all(
        "user_id" not in row for rows in data.values() if isinstance(rows, list) for row in rows
    )


async def test_export_holds_only_the_users_own_data(api: AsyncClient) -> None:
    await set_up(api, "user_acct_other")
    who = await set_up(api, "user_acct_mine")
    data = json.loads(
        zipfile.ZipFile(io.BytesIO((await api.post("/me/export", headers=who)).content)).read(
            "data.json"
        )
    )
    assert "user_acct_other" not in json.dumps(data)
    assert len(data["applications"]) == 1


async def test_exports_are_capped_per_hour(api: AsyncClient) -> None:
    who = as_user("user_acct_export_cap")
    for _ in range(5):
        assert (await api.post("/me/export", headers=who)).status_code == 200
    response = await api.post("/me/export", headers=who)
    assert response.status_code == 429


async def test_every_per_user_table_is_exported(db: AsyncSession) -> None:
    tables = set(
        await db.scalars(
            text(
                "SELECT table_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_name = 'user_id'"
            )
        )
    )
    exported = {model.__tablename__ for model in EXPORTED.values()}
    assert tables == exported, "add the new table to clew.account.EXPORTED"


# --- delete ---------------------------------------------------------------------------------


async def count_rows(db: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    counts = {}
    for model in EXPORTED.values():
        table = model.__tablename__
        counts[table] = await db.scalar(
            text(f"SELECT count(*) FROM {table} WHERE user_id = :id"),  # noqa: S608 - our names
            {"id": user_id},
        )
    return counts


async def test_delete_removes_files_and_every_row(
    api: AsyncClient, store: MemoryStore, db: AsyncSession
) -> None:
    who = await set_up(api, "user_acct_delete")
    other = await set_up(api, "user_acct_keep")
    user_id = await db.scalar(select(User.id).where(User.auth_provider_id == "user_acct_delete"))
    assert user_id is not None
    keys = set(await db.scalars(select(Resume.file_key).where(Resume.user_id == user_id)))
    assert keys and keys <= set(store.objects)
    deletions_before = await db.scalar(text("SELECT count(*) FROM account_deletions"))

    response = await api.delete("/me", headers=who)

    assert response.status_code == 204
    assert await db.scalar(select(User.id).where(User.id == user_id)) is None
    assert set((await count_rows(db, user_id)).values()) == {0}
    assert not keys & set(store.objects)
    # Only the audit entry is left, and it doesn't say who.
    assert (
        await db.scalar(text("SELECT count(*) FROM account_deletions"))
        == (deletions_before or 0) + 1
    )
    # The other user is untouched.
    assert (await api.get("/applications", headers=other)).json()["applications"]
    assert (await api.post("/me/export", headers=other)).status_code == 200


async def test_delete_removes_the_sign_in_account_at_clerk(
    api: AsyncClient, clerk: FakeClerk
) -> None:
    who = await set_up(api, "user_acct_clerk")
    assert (await api.delete("/me", headers=who)).status_code == 204
    assert clerk.deleted == ["user_acct_clerk"]


async def test_clerk_failing_still_deletes_clews_data(
    api: AsyncClient, clerk: FakeClerk, db: AsyncSession
) -> None:
    who = await set_up(api, "user_acct_clerk_down")
    clerk.ok = False
    assert (await api.delete("/me", headers=who)).status_code == 204
    assert (
        await db.scalar(select(User.id).where(User.auth_provider_id == "user_acct_clerk_down"))
        is None
    )


async def test_storage_failure_leaves_the_clerk_account(
    api: AsyncClient, store: MemoryStore, clerk: FakeClerk
) -> None:
    who = await set_up(api, "user_acct_clerk_kept")
    store.fail = True
    assert (await api.delete("/me", headers=who)).status_code == 503
    assert clerk.deleted == []


async def test_a_still_valid_token_after_deleting_starts_an_empty_account(api: AsyncClient) -> None:
    # Clerk ends the sessions, but a token issued just before stays valid for up to a minute.
    who = await set_up(api, "user_acct_again")
    first = (await api.get("/me", headers=who)).json()["id"]
    assert (await api.delete("/me", headers=who)).status_code == 204

    me = await api.get("/me", headers=who)
    assert me.status_code == 200
    assert me.json()["id"] != first
    assert (await api.get("/profile", headers=who)).status_code == 404


async def test_storage_failure_deletes_nothing_from_the_database(
    api: AsyncClient, store: MemoryStore, db: AsyncSession
) -> None:
    who = await set_up(api, "user_acct_storage_down")
    store.fail = True
    response = await api.delete("/me", headers=who)
    assert response.status_code == 503
    assert "wasn't deleted" in response.json()["detail"]
    store.fail = False
    user = await db.scalar(select(User).where(User.auth_provider_id == "user_acct_storage_down"))
    assert user is not None
    assert (await count_rows(db, user.id))["profile_versions"] == 1
    # Trying again works.
    assert (await api.delete("/me", headers=who)).status_code == 204


async def test_the_api_role_can_only_delete_the_bound_user(app_db: AsyncSession) -> None:
    # No user bound: the function refuses rather than deleting anything.
    with pytest.raises(Exception, match="no user is bound"):
        await app_db.execute(text("SELECT delete_current_account(0)"))
    await app_db.rollback()
    # And the API role still can't delete users directly.
    with pytest.raises(Exception, match="permission denied"):
        await app_db.execute(text("DELETE FROM users WHERE false"))
    await app_db.rollback()
    assert await app_db.scalar(select(func.count()).select_from(User)) is not None


# --- Clerk Backend API ------------------------------------------------------------------------


def clerk_api(handler: Any) -> ClerkBackendApi:
    return ClerkBackendApi(SecretStr("test-secret-key"), transport=httpx.MockTransport(handler))


async def test_clerk_api_deletes_the_user_with_the_secret_key() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"deleted": True})

    assert await clerk_api(handler).delete_user("user_abc/../x") is True
    assert seen[0].method == "DELETE"
    assert str(seen[0].url) == "https://api.clerk.com/v1/users/user_abc%2F..%2Fx"
    assert seen[0].headers["Authorization"] == "Bearer test-secret-key"


@pytest.mark.parametrize(("status", "ok"), [(404, True), (500, False), (401, False)])
async def test_clerk_api_answers(status: int, ok: bool) -> None:
    assert await clerk_api(lambda _: httpx.Response(status)).delete_user("user_abc") is ok


async def test_clerk_api_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    assert await clerk_api(handler).delete_user("user_abc") is False


async def test_without_a_secret_key_the_clerk_user_is_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_CLERK_SECRET_KEY", "")
    get_settings.cache_clear()
    try:
        admin = get_clerk_admin()
        assert isinstance(admin, NoClerkAdmin)
        assert await admin.delete_user("user_abc") is False
    finally:
        get_settings.cache_clear()
