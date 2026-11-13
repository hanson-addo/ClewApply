"""AI reading consent (#75). Uploading never needs it; sending resume text to Anthropic does.

The server enforces it: uploads queue a read only with consent to the current policy
version, POST /resumes/{id}/parse answers 403 without it, and the worker checks again right
before any text is sent, so a read still queued when the user withdraws is dropped.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clew.models import AiConsentEvent

# The privacy policy version the consent text points to. Raising it asks every user to agree
# again (#76 sets the first published version).
POLICY_VERSION = "2026-11-draft"

NO_CONSENT = "You haven't agreed to let Clew's AI read your resume."


@dataclass(frozen=True)
class ConsentState:
    # Agreed, to the current policy version.
    agreed: bool
    # The latest agreement, whatever its version; None after a withdrawal or never.
    agreed_at: datetime | None
    agreed_policy_version: str | None


async def consent_state(session: AsyncSession, user_id: uuid.UUID) -> ConsentState:
    latest = await session.scalar(
        select(AiConsentEvent)
        .where(AiConsentEvent.user_id == user_id)
        .order_by(AiConsentEvent.created_at.desc(), AiConsentEvent.id.desc())
        .limit(1)
    )
    if latest is None or not latest.agreed:
        return ConsentState(agreed=False, agreed_at=None, agreed_policy_version=None)
    return ConsentState(
        agreed=latest.policy_version == POLICY_VERSION,
        agreed_at=latest.created_at,
        agreed_policy_version=latest.policy_version,
    )


async def has_ai_consent(session: AsyncSession, user_id: uuid.UUID) -> bool:
    return (await consent_state(session, user_id)).agreed
