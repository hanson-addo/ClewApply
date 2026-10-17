"""Verify Clerk session tokens (short-lived RS256 JWTs) against Clerk's published keys.

Checks on every request (threat model R2): signature with a key from the issuer's JWKS,
algorithm pinned to RS256, issuer, expiry and not-before, and that the token was minted for
one of our own web origins ("azp", Clerk's equivalent of an audience).

Never log a token or its claims. Failures are reported by reason only.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWK

logger = logging.getLogger(__name__)

ALGORITHMS = ["RS256"]
CLOCK_SKEW_SECONDS = 5
JWKS_MAX_AGE_SECONDS = 60 * 60
# An unknown key id triggers a refetch (Clerk rotated keys), but at most this often,
# so a flood of junk tokens can't make us hammer Clerk.
JWKS_MIN_REFETCH_SECONDS = 30

JwksFetcher = Callable[[], Awaitable[Mapping[str, Any]]]


class InvalidToken(Exception):
    """The token is missing, malformed, expired, or not ours. Maps to 401."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class SignInUnavailable(Exception):
    """Sign-in isn't configured, or Clerk's keys can't be fetched. Maps to 503."""


@dataclass(frozen=True)
class SessionClaims:
    """The parts of a verified token Clew uses."""

    subject: str
    email: str | None


def http_jwks_fetcher(url: str, timeout: float = 5.0) -> JwksFetcher:
    async def fetch() -> Mapping[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url)
            response.raise_for_status()
            data: Mapping[str, Any] = response.json()
            return data

    return fetch


class JwksCache:
    """Keeps Clerk's public keys in memory and refreshes them when stale or rotated.

    At most one fetch runs at a time, and any attempt, successful or not, starts a
    JWKS_MIN_REFETCH_SECONDS back-off. A burst of requests with junk key ids, or Clerk being
    slow or down, therefore costs at most one fetch per back-off window.
    """

    def __init__(self, fetch: JwksFetcher, clock: Callable[[], float] = time.monotonic) -> None:
        self._fetch = fetch
        self._clock = clock
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._last_attempt_at: float | None = None
        self._lock = asyncio.Lock()

    async def get_key(self, kid: str) -> PyJWK:
        # With no keys yet, wait for any fetch already in flight rather than failing early.
        if not self._keys or self._needs_refresh(kid):
            await self._refresh(kid)
        if not self._keys:
            raise SignInUnavailable("no signing keys available")
        key = self._keys.get(kid)
        if key is None:
            raise InvalidToken("unknown_key")
        return key

    def _needs_refresh(self, kid: str) -> bool:
        now = self._clock()
        if (
            self._last_attempt_at is not None
            and now - self._last_attempt_at < JWKS_MIN_REFETCH_SECONDS
        ):
            return False
        if self._fetched_at is None or now - self._fetched_at > JWKS_MAX_AGE_SECONDS:
            return True
        return kid not in self._keys

    async def _refresh(self, kid: str) -> None:
        async with self._lock:
            # Another request may have refreshed while this one waited for the lock.
            if not self._needs_refresh(kid):
                return
            self._last_attempt_at = self._clock()
            try:
                data = await self._fetch()
            except (httpx.HTTPError, ValueError) as exc:
                # Keep serving with any keys we have; Clerk may be briefly unreachable.
                logger.warning("jwks_refresh_failed", extra={"error": type(exc).__name__})
                return
            raw_keys = data.get("keys") if isinstance(data, Mapping) else None
            if not isinstance(raw_keys, list):
                logger.warning("jwks_refresh_failed", extra={"error": "bad_shape"})
                return
            keys: dict[str, PyJWK] = {}
            for entry in raw_keys:
                if not isinstance(entry, Mapping):
                    continue
                entry_kid = entry.get("kid")
                if not entry_kid or entry.get("kty") != "RSA":
                    continue
                try:
                    keys[entry_kid] = PyJWK(dict(entry), algorithm="RS256")
                except jwt.PyJWTError:
                    continue
            if keys:
                self._keys = keys
                self._fetched_at = self._clock()


class TokenVerifier:
    def __init__(self, issuer: str, authorized_parties: list[str], jwks: JwksCache) -> None:
        self._issuer = issuer
        self._authorized_parties = set(authorized_parties)
        self._jwks = jwks

    async def verify(self, token: str) -> SessionClaims:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise InvalidToken("malformed") from exc
        if header.get("alg") not in ALGORITHMS:
            raise InvalidToken("bad_algorithm")
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise InvalidToken("missing_key_id")

        key = await self._jwks.get_key(kid)
        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key=key,
                algorithms=ALGORITHMS,
                issuer=self._issuer,
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": ["exp", "iat", "iss", "sub"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise InvalidToken("expired") from exc
        except jwt.InvalidIssuerError as exc:
            raise InvalidToken("wrong_issuer") from exc
        except jwt.PyJWTError as exc:
            raise InvalidToken("invalid") from exc

        # Clerk marks sessions with unfinished sign-in tasks as "pending"; only active ones count.
        if claims.get("sts", "active") != "active":
            raise InvalidToken("session_not_active")

        azp = claims.get("azp")
        if azp not in self._authorized_parties:
            raise InvalidToken("wrong_authorized_party")

        subject = claims["sub"]
        if not isinstance(subject, str) or not subject:
            raise InvalidToken("invalid")
        email = claims.get("email")
        return SessionClaims(subject=subject, email=email if isinstance(email, str) else None)
