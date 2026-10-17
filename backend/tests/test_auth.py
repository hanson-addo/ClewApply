import base64
import json
import logging
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import get_token_verifier
from clew.auth.tokens import InvalidToken, JwksCache, SignInUnavailable, TokenVerifier
from clew.main import create_app
from clew.models import User
from tests.auth_helpers import ISSUER, WEB_ORIGIN, SigningKey, make_token

KEY = SigningKey("kid_current")
OTHER_KEY = SigningKey("kid_current")  # same kid, different key: a forged signature


def static_jwks(*keys: SigningKey) -> JwksCache:
    async def fetch() -> Mapping[str, Any]:
        return {"keys": [k.jwk() for k in keys]}

    return JwksCache(fetch)


def verifier(*keys: SigningKey) -> TokenVerifier:
    return TokenVerifier(ISSUER, [WEB_ORIGIN], static_jwks(*keys))


@pytest.fixture
async def api() -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- /me end to end ---------------------------------------------------------------------


async def test_first_sign_in_creates_free_user(api: AsyncClient, db: AsyncSession) -> None:
    token = make_token(KEY, sub="user_test_first", email="first@example.test")
    response = await api.get("/me", headers=bearer(token))

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "first@example.test"
    assert body["plan"] == "free"
    user = await db.scalar(select(User).where(User.auth_provider_id == "user_test_first"))
    assert user is not None
    assert str(user.id) == body["id"]


async def test_returning_user_gets_same_account(api: AsyncClient) -> None:
    token = make_token(KEY, sub="user_test_returning", email="back@example.test")
    first = (await api.get("/me", headers=bearer(token))).json()
    second = (await api.get("/me", headers=bearer(token))).json()
    assert first["id"] == second["id"]


async def test_each_token_sees_only_its_own_account(api: AsyncClient) -> None:
    alice = await api.get("/me", headers=bearer(make_token(KEY, sub="user_test_a")))
    bob = await api.get("/me", headers=bearer(make_token(KEY, sub="user_test_b")))
    assert alice.json()["id"] != bob.json()["id"]


async def test_email_change_at_clerk_is_synced(api: AsyncClient) -> None:
    sub = "user_test_email_change"
    await api.get("/me", headers=bearer(make_token(KEY, sub=sub, email="old@example.test")))
    response = await api.get(
        "/me", headers=bearer(make_token(KEY, sub=sub, email="new@example.test"))
    )
    assert response.json()["email"] == "new@example.test"


async def test_deleted_user_is_rejected(api: AsyncClient, db: AsyncSession) -> None:
    sub = "user_test_deleted"
    await api.get("/me", headers=bearer(make_token(KEY, sub=sub)))
    await db.execute(
        update(User).where(User.auth_provider_id == sub).values(deleted_at=datetime.now(UTC))
    )
    await db.commit()
    assert (await api.get("/me", headers=bearer(make_token(KEY, sub=sub)))).status_code == 401


async def test_first_sign_in_without_email_claim_is_rejected(api: AsyncClient) -> None:
    token = make_token(KEY, sub="user_test_no_email", email=None)
    assert (await api.get("/me", headers=bearer(token))).status_code == 401


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer"},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Bearer not-a-jwt"},
    ],
    ids=["missing", "empty", "basic-auth", "garbage"],
)
async def test_missing_or_malformed_token_is_401(api: AsyncClient, headers: dict[str, str]) -> None:
    response = await api.get("/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_rejection_does_not_log_the_token(
    api: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    token = make_token(KEY, expires_in=-60)
    with caplog.at_level(logging.DEBUG):
        await api.get("/me", headers=bearer(token))
    assert token not in caplog.text
    assert token.split(".")[1] not in caplog.text
    assert "riley@example.test" not in caplog.text


async def test_sign_in_not_configured_is_503() -> None:
    app = create_app()
    app.dependency_overrides[get_token_verifier] = lambda: None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/me", headers=bearer(make_token(KEY)))
    assert response.status_code == 503


# --- Token verification rules (threat model R2) ------------------------------------------


async def test_valid_token_passes() -> None:
    claims = await verifier(KEY).verify(make_token(KEY))
    assert claims.subject == "user_test_riley"
    assert claims.email == "riley@example.test"


@pytest.mark.parametrize(
    ("token_kwargs", "reason"),
    [
        ({"expires_in": -60}, "expired"),
        ({"iss": "https://evil.clerk.accounts.dev"}, "wrong_issuer"),
        ({"azp": "https://evil.example"}, "wrong_authorized_party"),
        ({"azp": None}, "wrong_authorized_party"),
        ({"kid": "kid_unknown"}, "unknown_key"),
        ({"nbf": 2_000_000_000}, "invalid"),
    ],
    ids=["expired", "wrong-issuer", "wrong-azp", "no-azp", "unknown-kid", "not-yet-valid"],
)
async def test_bad_tokens_are_rejected(token_kwargs: dict[str, Any], reason: str) -> None:
    with pytest.raises(InvalidToken) as exc:
        await verifier(KEY).verify(make_token(KEY, **token_kwargs))
    assert exc.value.reason == reason


async def test_forged_signature_is_rejected() -> None:
    with pytest.raises(InvalidToken, match="invalid"):
        await verifier(KEY).verify(make_token(OTHER_KEY))


def _b64(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


async def test_alg_none_is_rejected() -> None:
    payload = {"sub": "user_x", "iss": ISSUER, "azp": WEB_ORIGIN, "exp": 2_000_000_000}
    token = f"{_b64({'alg': 'none', 'kid': KEY.kid})}.{_b64(payload)}."
    with pytest.raises(InvalidToken, match="bad_algorithm"):
        await verifier(KEY).verify(token)


async def test_hs256_with_public_key_is_rejected() -> None:
    # Classic key-confusion attack: sign HS256 using the public key as the HMAC secret.
    payload = {"sub": "user_x", "iss": ISSUER, "azp": WEB_ORIGIN, "exp": 2_000_000_000}
    header = _b64({"alg": "HS256", "kid": KEY.kid, "typ": "JWT"})
    token = f"{header}.{_b64(payload)}.c2lnbmF0dXJl"
    with pytest.raises(InvalidToken, match="bad_algorithm"):
        await verifier(KEY).verify(token)


# --- Key cache ---------------------------------------------------------------------------


async def test_rotated_key_is_picked_up() -> None:
    new_key = SigningKey("kid_rotated")
    served = [KEY]
    now = [0.0]

    async def fetch() -> Mapping[str, Any]:
        return {"keys": [k.jwk() for k in served]}

    cache = JwksCache(fetch, clock=lambda: now[0])
    v = TokenVerifier(ISSUER, [WEB_ORIGIN], cache)
    await v.verify(make_token(KEY))

    served.append(new_key)
    now[0] = 31.0  # past the minimum refetch gap
    claims = await v.verify(make_token(new_key))
    assert claims.subject == "user_test_riley"


async def test_unknown_kid_does_not_refetch_too_often() -> None:
    calls = 0

    async def fetch() -> Mapping[str, Any]:
        nonlocal calls
        calls += 1
        return {"keys": [KEY.jwk()]}

    cache = JwksCache(fetch, clock=lambda: 0.0)
    await cache.get_key(KEY.kid)
    for _ in range(5):
        with pytest.raises(InvalidToken):
            await cache.get_key("kid_junk")
    assert calls == 1


async def test_unreachable_clerk_with_no_keys_is_unavailable() -> None:
    async def fetch() -> Mapping[str, Any]:
        raise httpx.ConnectError("down")

    with pytest.raises(SignInUnavailable):
        await JwksCache(fetch).get_key(KEY.kid)


async def test_unreachable_clerk_keeps_cached_keys() -> None:
    now = [0.0]
    up = [True]

    async def fetch() -> Mapping[str, Any]:
        if not up[0]:
            raise httpx.ConnectError("down")
        return {"keys": [KEY.jwk()]}

    cache = JwksCache(fetch, clock=lambda: now[0])
    await cache.get_key(KEY.kid)
    up[0] = False
    now[0] = 2 * 60 * 60.0  # keys are stale, refresh fails
    assert await cache.get_key(KEY.kid) is not None
