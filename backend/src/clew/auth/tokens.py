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
    """Keeps Clerk's public keys in memory and refreshes them when stale or rotated."""

    def __init__(self, fetch: JwksFetcher, clock: Callable[[], float] = time.monotonic) -> None:
        self._fetch = fetch
        self._clock = clock
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._lock = asyncio.Lock()

    async def get_key(self, kid: str) -> PyJWK:
        now = self._clock()
        stale = self._fetched_at is None or now - self._fetched_at > JWKS_MAX_AGE_SECONDS
        may_refetch = self._fetched_at is None or now - self._fetched_at > JWKS_MIN_REFETCH_SECONDS
        if stale or (kid not in self._keys and may_refetch):
            await self._refresh()
        key = self._keys.get(kid)
        if key is None:
            raise InvalidToken("unknown_key")
        return key

    async def _refresh(self) -> None:
        async with self._lock:
            try:
                data = await self._fetch()
            except (httpx.HTTPError, ValueError) as exc:
                if self._keys:
                    # Keep serving with the keys we have; Clerk may be briefly unreachable.
                    logger.warning("jwks_refresh_failed", extra={"error": type(exc).__name__})
                    return
                raise SignInUnavailable("could not fetch signing keys") from exc
            keys: dict[str, PyJWK] = {}
            for entry in data.get("keys", []):
                kid = entry.get("kid")
                if not kid or entry.get("kty") != "RSA":
                    continue
                try:
                    keys[kid] = PyJWK(entry, algorithm="RS256")
                except jwt.PyJWTError:
                    continue
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

        azp = claims.get("azp")
        if azp not in self._authorized_parties:
            raise InvalidToken("wrong_authorized_party")

        subject = claims["sub"]
        if not isinstance(subject, str) or not subject:
            raise InvalidToken("invalid")
        email = claims.get("email")
        return SessionClaims(subject=subject, email=email if isinstance(email, str) else None)
