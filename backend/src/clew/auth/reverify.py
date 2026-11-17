"""Reverification: some actions need the user to have proved it's them in the last few minutes.

Exporting data and deleting the account (AUTH-15) refuse unless Clerk's session token shows a
first factor (an email code or a passkey) verified within REVERIFY_MINUTES. Otherwise they
answer 403 in the shape Clerk's `useReverification` hook understands, so the web app shows
Clerk's own "confirm it's you" step and then retries.
"""

from typing import Annotated, Any

from fastapi import Depends, Request
from fastapi.responses import JSONResponse

from clew.auth.deps import get_session_claims
from clew.auth.tokens import SessionClaims

REVERIFY_MINUTES = 10


class ReverificationRequired(Exception):
    """The user must confirm it's them before this action."""


def reverification_body() -> dict[str, Any]:
    # Matches @clerk/shared's reverificationError("first_factor" for 10 minutes).
    return {
        "clerk_error": {
            "type": "forbidden",
            "reason": "reverification-error",
            "metadata": {
                "reverification": {"level": "first_factor", "afterMinutes": REVERIFY_MINUTES}
            },
        }
    }


async def reverification_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(status_code=403, content=reverification_body())


async def require_recent_sign_in(
    claims: Annotated[SessionClaims, Depends(get_session_claims)],
) -> None:
    age = claims.first_factor_age
    # Same rule as Clerk's own check: fresh enough when the age is under the limit.
    if age is None or age >= REVERIFY_MINUTES:
        raise ReverificationRequired


RecentSignIn = Depends(require_recent_sign_in)
