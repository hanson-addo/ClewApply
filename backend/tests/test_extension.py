"""Browser extension sign-in (#130 step 1): link codes, scoped tokens, revoking them."""

import asyncio
import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.clerk_admin import get_clerk_admin
from clew.auth.deps import get_token_verifier
from clew.auth.extension import MAX_ACTIVE_TOKENS, AttemptLimiter, bind_hash, hash_secret
from clew.config import Settings, get_settings
from clew.main import create_app
from clew.models import ExtensionLinkCode, ExtensionToken, User
from clew.storage import get_object_store
from tests.auth_helpers import SigningKey, make_token
from tests.test_account import FakeClerk
from tests.test_auth import verifier
from tests.test_resumes import MemoryStore

KEY = SigningKey("kid_extension")
FRESH = [2, -1]  # Clerk "fva": first factor 2 minutes ago.
EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"


def make_app() -> FastAPI:
    """The API with test sign-in, file storage and Clerk stand-ins."""
    app = create_app()
    test_verifier = verifier(KEY)
    store = MemoryStore()
    clerk = FakeClerk()
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    app.dependency_overrides[get_object_store] = lambda: store
    app.dependency_overrides[get_clerk_admin] = lambda: clerk
    return app


@pytest.fixture
def app() -> FastAPI:
    return make_app()


@pytest.fixture
async def api(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def new_sub() -> str:
    return f"user_ext_{uuid.uuid4().hex[:8]}"


def as_user(sub: str, fva: list[int] | None = FRESH) -> dict[str, str]:
    extra: dict[str, Any] = {} if fva is None else {"fva": fva}
    token = make_token(KEY, sub=sub, email=f"{sub}@example.test", **extra)
    return {"Authorization": f"Bearer {token}"}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def link_code(api: AsyncClient, sub: str) -> str:
    response = await api.post("/extension/link", headers=as_user(sub))
    assert response.status_code == 201, response.text
    code: str = response.json()["code"]
    return code


async def connect(api: AsyncClient, sub: str, label: str = "Chrome on macOS") -> str:
    code = await link_code(api, sub)
    response = await api.post("/extension/token", json={"code": code, "label": label})
    assert response.status_code == 201, response.text
    token: str = response.json()["token"]
    return token


# --- link codes ---------------------------------------------------------------------------


@pytest.mark.parametrize("fva", [None, [-1, -1], [10, -1]])
async def test_link_needs_a_recent_sign_in(api: AsyncClient, fva: list[int] | None) -> None:
    response = await api.post("/extension/link", headers=as_user(new_sub(), fva=fva))
    assert response.status_code == 403
    assert response.json()["clerk_error"]["reason"] == "reverification-error"


async def test_link_needs_a_session(api: AsyncClient) -> None:
    assert (await api.post("/extension/link")).status_code == 401


async def test_link_code_is_random_and_stored_only_as_a_hash(
    api: AsyncClient, db: AsyncSession
) -> None:
    sub = new_sub()
    first, second = await link_code(api, sub), await link_code(api, sub)
    assert first != second
    assert first.startswith("clk_") and len(first) >= 4 + 43  # 32 random bytes
    stored = set(await db.scalars(select(ExtensionLinkCode.code_hash)))
    assert hash_secret(first) in stored
    assert first not in stored


async def test_link_codes_are_capped_per_hour(api: AsyncClient) -> None:
    sub = new_sub()
    for _ in range(get_settings().extension_links_per_hour):
        await link_code(api, sub)
    assert (await api.post("/extension/link", headers=as_user(sub))).status_code == 429


# --- trading a code for a token -----------------------------------------------------------


async def test_connect_and_read_who_is_signed_in(api: AsyncClient, db: AsyncSession) -> None:
    sub = new_sub()
    profile = {"basics": {"name": "Jordan Testperson"}}
    assert (
        await api.put("/profile", headers=as_user(sub), json={"data": profile})
    ).status_code == 200
    token = await connect(api, sub)

    assert token.startswith("clx_")
    response = await api.get("/extension/me", headers=bearer(token))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == f"{sub}@example.test"
    assert body["profile_version"] == 1
    assert body["profile_saved_at"]
    stored = await db.scalar(
        select(ExtensionToken).where(ExtensionToken.token_hash == hash_secret(token))
    )
    assert stored is not None
    assert stored.label == "Chrome on macOS"
    assert stored.last_used_at is not None


async def test_me_before_any_profile(api: AsyncClient) -> None:
    token = await connect(api, new_sub())
    body = (await api.get("/extension/me", headers=bearer(token))).json()
    assert body["profile_version"] is None
    assert body["profile_saved_at"] is None


async def test_a_code_works_once(api: AsyncClient) -> None:
    code = await link_code(api, new_sub())
    assert (await api.post("/extension/token", json={"code": code})).status_code == 201
    again = await api.post("/extension/token", json={"code": code})
    assert again.status_code == 400
    assert again.json()["detail"] == "That link has expired. Connect again from Clew's Settings."


async def test_racing_requests_get_one_token(api: AsyncClient) -> None:
    code = await link_code(api, new_sub())
    responses = await asyncio.gather(
        *(api.post("/extension/token", json={"code": code}) for _ in range(4))
    )
    assert sorted(r.status_code for r in responses) == [201, 400, 400, 400]


async def test_an_expired_code_fails(api: AsyncClient, db: AsyncSession) -> None:
    code = await link_code(api, new_sub())
    await db.execute(
        update(ExtensionLinkCode)
        .where(ExtensionLinkCode.code_hash == hash_secret(code))
        .values(expires_at=func.now() - text("interval '1 second'"))
    )
    await db.commit()
    assert (await api.post("/extension/token", json={"code": code})).status_code == 400


async def test_a_code_for_a_deleted_account_fails(api: AsyncClient, db: AsyncSession) -> None:
    sub = new_sub()
    code = await link_code(api, sub)
    await db.execute(update(User).where(User.auth_provider_id == sub).values(deleted_at=func.now()))
    await db.commit()
    assert (await api.post("/extension/token", json={"code": code})).status_code == 400


@pytest.mark.parametrize("code", ["clk_made-up", "not-a-code", "clx_looks-like-a-token"])
async def test_unknown_codes_fail(api: AsyncClient, code: str) -> None:
    assert (await api.post("/extension/token", json={"code": code})).status_code == 400


async def test_code_goes_in_the_body_only(api: AsyncClient) -> None:
    code = await link_code(api, new_sub())
    assert (await api.post(f"/extension/token?code={code}")).status_code == 422


async def test_token_attempts_are_rate_limited(api: AsyncClient, app: FastAPI) -> None:
    app.state.extension_token_limiter = AttemptLimiter(3)
    for _ in range(3):
        assert (await api.post("/extension/token", json={"code": "clk_x"})).status_code == 400
    assert (await api.post("/extension/token", json={"code": "clk_x"})).status_code == 429


def test_attempt_limiter_window_and_memory_bound() -> None:
    limiter = AttemptLimiter(2, window_seconds=60, max_keys=3)
    assert limiter.allow("a") and limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")
    for key in ("c", "d", "e"):
        assert limiter.allow(key)
    assert len(limiter._hits) <= 3


async def test_label_is_cleaned(api: AsyncClient, db: AsyncSession) -> None:
    token = await connect(api, new_sub(), label="Chrome <b>on</b>\n\x07 Linux")
    label = await db.scalar(
        select(ExtensionToken.label).where(ExtensionToken.token_hash == hash_secret(token))
    )
    assert label == "Chrome bon/b Linux"


# --- scope ----------------------------------------------------------------------------------

EXTENSION_ROUTES = {
    ("GET", "/extension/me"),
    ("POST", "/extension/sign-out"),
    ("POST", "/sync/fills"),
}
NO_SIGN_IN = {
    ("GET", "/health"),
    ("GET", "/ready"),
    ("POST", "/extension/token"),
}


def every_route(app: FastAPI) -> list[tuple[str, str]]:
    routes: list[tuple[str, str]] = []
    for path, operations in app.openapi()["paths"].items():
        concrete = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        routes.extend((method.upper(), concrete) for method in operations)
    return routes


async def test_extension_token_is_refused_everywhere_else(app: FastAPI, api: AsyncClient) -> None:
    token = await connect(api, new_sub())
    checked = 0
    for method, path in every_route(app):
        if (method, path) in EXTENSION_ROUTES | NO_SIGN_IN:
            continue
        response = await api.request(method, path, headers=bearer(token))
        assert response.status_code == 403, (method, path, response.status_code)
        assert response.json() == {"detail": "extension_token_not_allowed"}
        checked += 1
    assert checked > 20


async def test_no_sign_in_routes_are_the_known_ones(app: FastAPI, api: AsyncClient) -> None:
    # A new route that answers without any sign-in must be added here on purpose.
    open_routes = set()
    for method, path in every_route(app):
        if (method, path) in EXTENSION_ROUTES:
            continue
        response = await api.request(method, path)
        if response.status_code not in (401, 422):
            open_routes.add((method, path))
    assert open_routes <= NO_SIGN_IN


async def test_extension_routes_refuse_a_clerk_session(api: AsyncClient) -> None:
    who = as_user(new_sub())
    assert (await api.get("/extension/me", headers=who)).status_code == 401
    assert (await api.post("/extension/sign-out", headers=who)).status_code == 401
    assert (await api.get("/extension/me")).status_code == 401


# --- disconnecting --------------------------------------------------------------------------


async def test_settings_lists_and_disconnects_a_browser(api: AsyncClient) -> None:
    sub = new_sub()
    token = await connect(api, sub)
    listed = (await api.get("/extension/connections", headers=as_user(sub))).json()
    [connection] = listed["connections"]
    assert connection["label"] == "Chrome on macOS"
    assert set(connection) == {"id", "label", "created_at", "last_used_at"}

    gone = await api.delete(f"/extension/connections/{connection['id']}", headers=as_user(sub))
    assert gone.status_code == 204
    assert (await api.get("/extension/me", headers=bearer(token))).status_code == 401
    assert (await api.get("/extension/connections", headers=as_user(sub))).json() == {
        "connections": []
    }
    again = await api.delete(f"/extension/connections/{connection['id']}", headers=as_user(sub))
    assert again.status_code == 404


async def test_cannot_disconnect_someone_elses_browser(api: AsyncClient) -> None:
    owner, other = new_sub(), new_sub()
    token = await connect(api, owner)
    [connection] = (await api.get("/extension/connections", headers=as_user(owner))).json()[
        "connections"
    ]
    response = await api.delete(
        f"/extension/connections/{connection['id']}", headers=as_user(other)
    )
    assert response.status_code == 404
    assert (await api.get("/extension/me", headers=bearer(token))).status_code == 200


async def test_signing_out_of_the_web_app_disconnects_every_browser(api: AsyncClient) -> None:
    sub, other = new_sub(), new_sub()
    tokens = [await connect(api, sub) for _ in range(2)]
    others = await connect(api, other)
    response = await api.post("/extension/connections/revoke-all", headers=as_user(sub))
    assert response.status_code == 204
    for token in tokens:
        assert (await api.get("/extension/me", headers=bearer(token))).status_code == 401
    assert (await api.get("/extension/me", headers=bearer(others))).status_code == 200


async def test_extension_sign_out_revokes_its_own_token(api: AsyncClient) -> None:
    sub = new_sub()
    token, kept = await connect(api, sub), await connect(api, sub)
    assert (await api.post("/extension/sign-out", headers=bearer(token))).status_code == 204
    assert (await api.get("/extension/me", headers=bearer(token))).status_code == 401
    assert (await api.get("/extension/me", headers=bearer(kept))).status_code == 200


async def test_at_most_ten_tokens_oldest_revoked_first(
    api: AsyncClient, app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    app.state.extension_token_limiter = AttemptLimiter(100)
    monkeypatch.setenv("CLEW_EXTENSION_LINKS_PER_HOUR", "100")
    get_settings.cache_clear()
    sub = new_sub()
    tokens = [await connect(api, sub) for _ in range(MAX_ACTIVE_TOKENS + 1)]
    assert (await api.get("/extension/me", headers=bearer(tokens[0]))).status_code == 401
    for token in tokens[1:]:
        assert (await api.get("/extension/me", headers=bearer(token))).status_code == 200
    listed = (await api.get("/extension/connections", headers=as_user(sub))).json()
    assert len(listed["connections"]) == MAX_ACTIVE_TOKENS


async def test_an_expired_token_fails_and_use_extends_it(
    api: AsyncClient, db: AsyncSession
) -> None:
    sub = new_sub()
    token, expiring = await connect(api, sub), await connect(api, sub)
    await db.execute(
        update(ExtensionToken)
        .where(ExtensionToken.token_hash == hash_secret(expiring))
        .values(expires_at=func.now() - text("interval '1 second'"))
    )
    await db.execute(
        update(ExtensionToken)
        .where(ExtensionToken.token_hash == hash_secret(token))
        .values(expires_at=func.now() + text("interval '1 day'"))
    )
    await db.commit()
    assert (await api.get("/extension/me", headers=bearer(expiring))).status_code == 401
    assert (await api.get("/extension/me", headers=bearer(token))).status_code == 200
    days_left = await db.scalar(
        select(func.extract("day", ExtensionToken.expires_at - func.now())).where(
            ExtensionToken.token_hash == hash_secret(token)
        )
    )
    assert days_left is not None and days_left >= 29


async def test_deleting_the_account_removes_every_token(api: AsyncClient, db: AsyncSession) -> None:
    sub = new_sub()
    token = await connect(api, sub)
    user_id = await db.scalar(select(User.id).where(User.auth_provider_id == sub))
    assert (await api.delete("/me", headers=as_user(sub))).status_code == 204
    for model in (ExtensionToken, ExtensionLinkCode):
        count = await db.scalar(
            select(func.count()).select_from(model).where(model.user_id == user_id)
        )
        assert count == 0
    assert (await api.get("/extension/me", headers=bearer(token))).status_code == 401


async def test_export_lists_browsers_without_hashes(api: AsyncClient) -> None:
    import io
    import json
    import zipfile

    sub = new_sub()
    token = await connect(api, sub)
    response = await api.post("/me/export", headers=as_user(sub))
    assert response.status_code == 200
    data = json.loads(zipfile.ZipFile(io.BytesIO(response.content)).read("data.json"))
    [browser] = data["connected_browsers"]
    assert browser["label"] == "Chrome on macOS"
    assert "token_hash" not in browser
    assert len(data["extension_link_codes"]) == 1
    assert "code_hash" not in data["extension_link_codes"][0]
    assert token not in response.text and hash_secret(token) not in json.dumps(data)


# --- row-level security ---------------------------------------------------------------------


async def test_unbound_api_role_sees_no_tokens(api: AsyncClient, app_db: AsyncSession) -> None:
    await connect(api, new_sub())
    assert await app_db.scalar(select(func.count()).select_from(ExtensionToken)) == 0
    assert await app_db.scalar(select(func.count()).select_from(ExtensionLinkCode)) == 0


async def test_a_bound_hash_shows_only_its_own_row(api: AsyncClient, app_db: AsyncSession) -> None:
    sub = new_sub()
    token = await connect(api, sub)
    await connect(api, sub)
    await bind_hash(app_db, hash_secret(token))
    rows = list(await app_db.scalars(select(ExtensionToken.token_hash)))
    assert rows == [hash_secret(token)]


async def test_a_bound_hash_cannot_insert_or_reassign(
    api: AsyncClient, app_db: AsyncSession, db: AsyncSession
) -> None:
    victim = new_sub()
    token = await connect(api, victim)
    attacker_id = await db.scalar(select(User.id).where(User.auth_provider_id == victim))
    await bind_hash(app_db, hash_secret("clx_planted"))
    with pytest.raises(DBAPIError):
        await app_db.execute(
            text(
                "INSERT INTO extension_tokens (user_id, token_hash, label, expires_at) "
                "VALUES (:user, :hash, 'x', now() + interval '1 day')"
            ),
            {"user": attacker_id, "hash": hash_secret("clx_planted")},
        )
    await app_db.rollback()
    await bind_hash(app_db, hash_secret(token))
    with pytest.raises(DBAPIError):
        # The API may only change the used/expiry/revoked columns.
        await app_db.execute(
            update(ExtensionToken)
            .where(ExtensionToken.token_hash == hash_secret(token))
            .values(user_id=uuid.uuid4())
        )
    await app_db.rollback()


# --- CORS -----------------------------------------------------------------------------------


def test_extension_id_must_look_like_one() -> None:
    with pytest.raises(ValueError, match="CLEW_EXTENSION_ID"):
        Settings(env="test", database_url="postgresql+asyncpg://x/y", extension_id="not-an-id")
    settings = Settings(
        env="test",
        database_url="postgresql+asyncpg://x/y",
        cors_origins=["https://app.clewapply.com"],
        extension_id=EXTENSION_ID,
    )
    assert settings.allowed_origins == [
        "https://app.clewapply.com",
        f"chrome-extension://{EXTENSION_ID}",
    ]
    assert Settings(env="test", database_url="x", extension_id="").extension_id is None


async def test_cors_allows_only_the_pinned_extension(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_EXTENSION_ID", EXTENSION_ID)
    get_settings.cache_clear()
    app = create_app()
    preflight = {"Access-Control-Request-Method": "GET"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        ours = await c.options(
            "/extension/me", headers={"Origin": f"chrome-extension://{EXTENSION_ID}", **preflight}
        )
        other = await c.options(
            "/extension/me", headers={"Origin": f"chrome-extension://{'b' * 32}", **preflight}
        )
    assert ours.headers["access-control-allow-origin"] == f"chrome-extension://{EXTENSION_ID}"
    assert "access-control-allow-origin" not in other.headers
