"""Letting Clew's AI read your resumes (#75): see it, agree to it, or withdraw it."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import CurrentUser
from clew.consent import POLICY_VERSION, consent_state
from clew.db.session import get_session
from clew.models import AiConsentEvent

router = APIRouter(tags=["account"])

Session = Annotated[AsyncSession, Depends(get_session)]


class AiConsentOut(BaseModel):
    # True only when the user agreed to the current policy version.
    agreed: bool
    # When the user last agreed, whatever version; null after a withdrawal or never.
    agreed_at: datetime | None
    agreed_policy_version: str | None
    # The version the consent text links to now. Send it back when agreeing.
    policy_version: str


class AiConsentIn(BaseModel):
    agreed: bool
    # The version shown to the user. Agreeing needs the current one, so nobody agrees to
    # text they weren't shown.
    policy_version: Annotated[str, Field(max_length=32)]


async def _out(session: AsyncSession, user: CurrentUser) -> AiConsentOut:
    state = await consent_state(session, user.id)
    return AiConsentOut(
        agreed=state.agreed,
        agreed_at=state.agreed_at,
        agreed_policy_version=state.agreed_policy_version,
        policy_version=POLICY_VERSION,
    )


@router.get("/me/ai-consent", responses={401: {"description": "Not signed in"}})
async def get_ai_consent(user: CurrentUser, session: Session) -> AiConsentOut:
    """Whether Clew's AI may read this user's resumes."""
    return await _out(session, user)


@router.put(
    "/me/ai-consent",
    responses={
        401: {"description": "Not signed in"},
        409: {"description": "policy_version isn't the current one (detail: policy_changed)"},
    },
)
async def set_ai_consent(body: AiConsentIn, user: CurrentUser, session: Session) -> AiConsentOut:
    """Agree to, or withdraw, AI reading. Each change is kept as a new record. Withdrawing
    stops every read that hasn't reached the AI yet; a resume already sent can't be
    recalled, and drafts already made are kept."""
    if body.agreed and body.policy_version != POLICY_VERSION:
        raise HTTPException(status.HTTP_409_CONFLICT, "policy_changed")
    current = await consent_state(session, user.id)
    already = current.agreed if body.agreed else current.agreed_at is None
    if not already:
        session.add(
            AiConsentEvent(user_id=user.id, agreed=body.agreed, policy_version=POLICY_VERSION)
        )
        await session.commit()
    return await _out(session, user)
