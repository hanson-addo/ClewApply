"""Extension tokens: how the browser extension signs in without a password or cookies (#130).

The web app asks for a one-time link code (`POST /extension/link`, signed in through Clerk,
recently verified), hands it to the extension, and the extension trades it for an extension
token (`POST /extension/token`). Codes and tokens are random 256-bit values; only their
SHA-256 hashes are stored, and neither is ever logged.

An extension token works only on the extension's own endpoints (`ExtensionUser`). Everywhere
else, `clew.auth.deps` answers it with 403.
"""

import hashlib
import secrets
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from clew.db.session import bind_user, get_session
from clew.models import ExtensionLinkCode, ExtensionToken, User

TOKEN_PREFIX = "clx_"  # noqa: S105 - a prefix, not a secret
CODE_PREFIX = "clk_"
CODE_LIFETIME = timedelta(minutes=2)
TOKEN_LIFETIME = timedelta(days=30)
MAX_ACTIVE_TOKENS = 10

SET_HASH = text("SELECT set_config('app.extension_hash', :hash, true)")

extension_bearer = HTTPBearer(auto_error=False, description="Clew extension token")

UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Connect the extension again from Clew's Settings.",
    headers={"WWW-Authenticate": "Bearer"},
)


def new_secret(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def is_extension_token(credential: str) -> bool:
    return credential.startswith(TOKEN_PREFIX)


async def bind_hash(session: AsyncSession, secret_hash: str) -> None:
    """Lets this transaction see the one link code or token with this hash (migration 0016)."""
    await session.execute(SET_HASH, {"hash": secret_hash})


async def redeem_link_code(session: AsyncSession, code: str) -> uuid.UUID | None:
    """Marks the code used and returns its user, or None if it's unknown, used or expired.

    One UPDATE does the check and the marking, so two requests racing with the same code
    can't both succeed.
    """
    if not code.startswith(CODE_PREFIX):
        return None
    await bind_hash(session, hash_secret(code))
    user_id: uuid.UUID | None = await session.scalar(
        update(ExtensionLinkCode)
        .where(
            ExtensionLinkCode.code_hash == hash_secret(code),
            ExtensionLinkCode.used_at.is_(None),
            ExtensionLinkCode.expires_at > func.now(),
        )
        .values(used_at=func.now())
        .returning(ExtensionLinkCode.user_id)
    )
    return user_id


async def revoke_beyond_limit(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Keeps at most MAX_ACTIVE_TOKENS working tokens, revoking the oldest first."""
    extra = (
        select(ExtensionToken.id)
        .where(
            ExtensionToken.user_id == user_id,
            ExtensionToken.revoked_at.is_(None),
            ExtensionToken.expires_at > func.now(),
        )
        .order_by(ExtensionToken.created_at.desc(), ExtensionToken.id.desc())
        .offset(MAX_ACTIVE_TOKENS)
    )
    await session.execute(
        update(ExtensionToken)
        .where(ExtensionToken.user_id == user_id, ExtensionToken.id.in_(extra))
        .values(revoked_at=func.now())
    )


async def revoke_all(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(ExtensionToken)
        .where(ExtensionToken.user_id == user_id, ExtensionToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )


@dataclass(frozen=True)
class ExtensionAuth:
    user: User
    token_id: uuid.UUID


async def get_extension_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(extension_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ExtensionAuth:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UNAUTHORIZED
    token = credentials.credentials
    if not is_extension_token(token):
        raise UNAUTHORIZED
    token_hash = hash_secret(token)
    await bind_hash(session, token_hash)
    # Using the token keeps it alive for another 30 days.
    found = (
        await session.execute(
            update(ExtensionToken)
            .where(
                ExtensionToken.token_hash == token_hash,
                ExtensionToken.revoked_at.is_(None),
                ExtensionToken.expires_at > func.now(),
            )
            .values(last_used_at=func.now(), expires_at=func.now() + TOKEN_LIFETIME)
            .returning(ExtensionToken.id, ExtensionToken.user_id)
        )
    ).first()
    if found is None:
        await session.rollback()
        raise UNAUTHORIZED
    token_id, user_id = found
    # `users` has no row policy; filter by the token's own user (see clew.auth.deps).
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None or user.deleted_at is not None:
        await session.rollback()
        raise UNAUTHORIZED
    await session.commit()
    await bind_user(session, user.id)
    return ExtensionAuth(user=user, token_id=token_id)


ExtensionUser = Annotated[ExtensionAuth, Depends(get_extension_auth)]


class AttemptLimiter:
    """At most `limit` attempts per `window_seconds` for each key (the caller's address).

    Kept in memory per API process: it slows guessing, and the codes themselves are 256-bit
    random, single use and live two minutes, so guessing can't succeed anyway.
    """

    def __init__(self, limit: int, window_seconds: float = 60.0, max_keys: int = 10_000) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if key not in self._hits and len(self._hits) >= self.max_keys:
            self._forget_idle(now)
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True

    def _forget_idle(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] >= self.window]:
            del self._hits[key]
        if len(self._hits) >= self.max_keys:
            # Still full of active callers: start over rather than grow without bound.
            self._hits.clear()
