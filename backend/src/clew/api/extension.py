"""The browser extension's sign-in and its scoped endpoints (#130, step 1).

Web app (Clerk session):
- `POST /extension/link` makes a one-time link code. Needs a sign-in in the last 10 minutes.
- `GET /extension/connections` lists connected browsers; `DELETE` one to disconnect it.
- `POST /extension/connections/revoke-all` disconnects every browser (the web app calls it when
  the user signs out).

Extension (no Clerk session):
- `POST /extension/token` trades a link code for an extension token.
- `GET /extension/me` and `POST /extension/sign-out` take the extension token. They are the
  only routes that do; every other route answers an extension token with 403.
"""

import re
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.auth.extension import (
    CODE_LIFETIME,
    CODE_PREFIX,
    TOKEN_LIFETIME,
    TOKEN_PREFIX,
    AttemptLimiter,
    ExtensionUser,
    hash_secret,
    new_secret,
    redeem_link_code,
    revoke_all,
    revoke_beyond_limit,
)
from clew.auth.reverify import RecentSignIn
from clew.config import get_settings
from clew.db.session import bind_user, get_session
from clew.models import (
    ExtensionLinkCode,
    ExtensionToken,
    Profile,
    ProfileVersion,
    UsageEvent,
    UsageKind,
)
from clew.usage import lock_user, used_within

router = APIRouter(prefix="/extension", tags=["extension"])

Session = Annotated[AsyncSession, Depends(get_session)]

TOO_MANY_LINKS = "You've connected a browser several times this hour. Try again later."
TOO_MANY_ATTEMPTS = "Too many tries. Wait a minute, then connect again from Clew's Settings."
LINK_INVALID = "That link has expired. Connect again from Clew's Settings."
NOT_FOUND = "That browser isn't connected."

REVERIFY_RESPONSE: dict[int | str, dict[str, Any]] = {
    403: {
        "description": "Confirm it's you first: Clerk reverification (a code or passkey in the "
        "last 10 minutes). The body is Clerk's reverification hint."
    }
}
EXTENSION_AUTH_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "The extension token is unknown, revoked or expired"}
}

# Anything that isn't a letter, digit, space or a little punctuation is dropped from labels.
LABEL_UNSAFE = re.compile(r"[^\w .,()/+-]", re.UNICODE)


class LinkCode(BaseModel):
    code: str
    expires_at: datetime


class TokenRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    # Which browser this is, shown in Settings, e.g. "Chrome on macOS".
    label: str = Field(default="Chrome", max_length=80)

    @field_validator("label")
    @classmethod
    def plain_label(cls, value: str) -> str:
        return " ".join(LABEL_UNSAFE.sub("", value).split()) or "Chrome"


class ExtensionTokenOut(BaseModel):
    token: str
    expires_at: datetime


class Connection(BaseModel):
    id: uuid.UUID
    label: str
    created_at: datetime
    last_used_at: datetime | None


class Connections(BaseModel):
    connections: list[Connection]


class ExtensionMe(BaseModel):
    email: str
    # The current profile version's number and when it was saved; null before the first save.
    profile_version: int | None
    profile_saved_at: datetime | None


# --- web app ------------------------------------------------------------------------------


@router.post(
    "/link",
    dependencies=[RecentSignIn],
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"description": "Not signed in"},
        429: {"description": "Too many link codes this hour"},
        **REVERIFY_RESPONSE,
    },
)
async def create_link_code(user: CurrentUser, session: Session) -> LinkCode:
    """A one-time code the web app hands to the extension. Single use, valid 2 minutes."""
    await lock_user(session, user.id)
    if (
        await used_within(session, user.id, UsageKind.EXTENSION_LINK, timedelta(hours=1))
        >= get_settings().extension_links_per_hour
    ):
        await session.rollback()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_LINKS)
    code = new_secret(CODE_PREFIX)
    expires_at: datetime = (await session.execute(select(func.now() + CODE_LIFETIME))).scalar_one()
    session.add(UsageEvent(user_id=user.id, kind=UsageKind.EXTENSION_LINK))
    session.add(
        ExtensionLinkCode(user_id=user.id, code_hash=hash_secret(code), expires_at=expires_at)
    )
    await session.commit()
    return LinkCode(code=code, expires_at=expires_at)


def _active() -> Any:
    return (ExtensionToken.revoked_at.is_(None), ExtensionToken.expires_at > func.now())


@router.get("/connections", responses={401: {"description": "Not signed in"}})
async def list_connections(user: CurrentUser, session: Session) -> Connections:
    """Browsers the extension is connected in, newest first."""
    rows = await session.scalars(
        select(ExtensionToken)
        .where(ExtensionToken.user_id == user.id, *_active())
        .order_by(ExtensionToken.created_at.desc())
    )
    return Connections(
        connections=[
            Connection(
                id=row.id, label=row.label, created_at=row.created_at, last_used_at=row.last_used_at
            )
            for row in rows
        ]
    )


@router.delete(
    "/connections/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"description": "Not signed in"}, 404: {"description": NOT_FOUND}},
)
async def disconnect(connection_id: uuid.UUID, user: CurrentUser, session: Session) -> Response:
    """Disconnects one browser: its token stops working at once."""
    revoked = await session.scalar(
        update(ExtensionToken)
        .where(ExtensionToken.id == connection_id, ExtensionToken.user_id == user.id, *_active())
        .values(revoked_at=func.now())
        .returning(ExtensionToken.id)
    )
    if revoked is None:
        await session.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/connections/revoke-all",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"description": "Not signed in"}},
)
async def disconnect_all(user: CurrentUser, session: Session) -> Response:
    """Disconnects every browser. The web app calls this when the user signs out."""
    await revoke_all(session, user.id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- extension ----------------------------------------------------------------------------


def _caller(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post(
    "/token",
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"description": LINK_INVALID},
        429: {"description": "Too many attempts from this address"},
    },
)
async def create_token(body: TokenRequest, request: Request, session: Session) -> ExtensionTokenOut:
    """Trades a one-time link code for an extension token (30 days, extended while in use)."""
    limiter: AttemptLimiter = request.app.state.extension_token_limiter
    if not limiter.allow(_caller(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_ATTEMPTS)
    user_id = await redeem_link_code(session, body.code)
    if user_id is None:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, LINK_INVALID)
    await bind_user(session, user_id)
    await lock_user(session, user_id)
    token = new_secret(TOKEN_PREFIX)
    expires_at: datetime = (await session.execute(select(func.now() + TOKEN_LIFETIME))).scalar_one()
    session.add(
        ExtensionToken(
            user_id=user_id,
            token_hash=hash_secret(token),
            label=body.label,
            expires_at=expires_at,
        )
    )
    await session.flush()
    await revoke_beyond_limit(session, user_id)
    await session.commit()
    return ExtensionTokenOut(token=token, expires_at=expires_at)


@router.get("/me", responses=EXTENSION_AUTH_RESPONSES)
async def extension_me(auth: ExtensionUser, session: Session) -> ExtensionMe:
    """Who the extension is signed in as, and which profile version is current."""
    current = (
        await session.execute(
            select(ProfileVersion.number, ProfileVersion.created_at)
            .join(Profile, Profile.current_version_id == ProfileVersion.id)
            .where(Profile.user_id == auth.user.id, ProfileVersion.user_id == auth.user.id)
        )
    ).first()
    return ExtensionMe(
        email=auth.user.email,
        profile_version=current.number if current else None,
        profile_saved_at=current.created_at if current else None,
    )


@router.post(
    "/sign-out", status_code=status.HTTP_204_NO_CONTENT, responses=EXTENSION_AUTH_RESPONSES
)
async def extension_sign_out(auth: ExtensionUser, session: Session) -> Response:
    """Revokes the token the extension signed in with."""
    await session.execute(
        update(ExtensionToken)
        .where(ExtensionToken.id == auth.token_id, ExtensionToken.user_id == auth.user.id)
        .values(revoked_at=func.now())
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
