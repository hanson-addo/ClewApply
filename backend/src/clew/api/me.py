"""The signed-in user's own account: who they are, a copy of their data, and deleting it."""

import uuid
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from clew.account import build_export, delete_account, file_chunks
from clew.api.resumes import Store
from clew.auth.deps import CurrentUser
from clew.auth.reverify import RecentSignIn
from clew.config import get_settings
from clew.db.session import get_session
from clew.models import UsageEvent, UsageKind
from clew.storage import StorageUnavailable
from clew.usage import lock_user, used_within

router = APIRouter(tags=["account"])

Session = Annotated[AsyncSession, Depends(get_session)]

REVERIFY_RESPONSE: dict[int | str, dict[str, Any]] = {
    403: {
        "description": "Confirm it's you first: Clerk reverification (a code or passkey in the "
        "last 10 minutes). The body is Clerk's reverification hint."
    }
}
TOO_MANY_EXPORTS = "You've downloaded your data several times this hour. Try again later."
EXPORT_FAILED = "We couldn't prepare your file. Try again in a few minutes."
DELETE_FAILED = "We couldn't delete your account. Nothing was removed. Try again, or contact us."


class Me(BaseModel):
    id: uuid.UUID
    email: str
    plan: str


@router.get(
    "/me",
    responses={
        401: {"description": "Not signed in"},
        403: {"description": "The account has no email address (detail: email_required)"},
    },
)
async def me(user: CurrentUser) -> Me:
    """Who is signed in. The first call after sign-up creates the Clew account."""
    return Me(id=user.id, email=user.email, plan=user.plan)


@router.post(
    "/me/export",
    dependencies=[RecentSignIn],
    response_class=StreamingResponse,
    responses={
        200: {"content": {"application/zip": {}}, "description": "clew-data.zip"},
        401: {"description": "Not signed in"},
        429: {"description": "Too many exports this hour"},
        503: {"description": "File storage is unavailable"},
        **REVERIFY_RESPONSE,
    },
)
async def export_data(user: CurrentUser, session: Session, store: Store) -> StreamingResponse:
    """A zip of everything Clew stores for the user: data.json and their resume files."""
    await lock_user(session, user.id)
    if (
        await used_within(session, user.id, UsageKind.DATA_EXPORT, timedelta(hours=1))
        >= get_settings().data_exports_per_hour
    ):
        await session.rollback()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_EXPORTS)
    session.add(UsageEvent(user_id=user.id, kind=UsageKind.DATA_EXPORT))
    await session.commit()
    try:
        archive = await build_export(session, store, user)
    except StorageUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, EXPORT_FAILED) from None
    return StreamingResponse(
        file_chunks(archive),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="clew-data.zip"',
            "Cache-Control": "no-store",
        },
    )


@router.delete(
    "/me",
    dependencies=[RecentSignIn],
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"description": "Not signed in"},
        503: {"description": "File storage is unavailable; nothing was deleted from the database"},
        **REVERIFY_RESPONSE,
    },
)
async def delete_me(user: CurrentUser, session: Session, store: Store) -> Response:
    """Deletes the account: every resume file, then the profile, every version, applications,
    settings, drafts and history. Signing in again later starts a new, empty account."""
    try:
        await delete_account(session, store, user.id)
    except StorageUnavailable:
        await session.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, DELETE_FAILED) from None
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
