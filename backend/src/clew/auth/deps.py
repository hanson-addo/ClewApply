"""FastAPI dependencies: `CurrentUser` gives every route the signed-in Clew user."""

import logging
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.tokens import (
    InvalidToken,
    JwksCache,
    SessionClaims,
    SignInUnavailable,
    TokenVerifier,
    http_jwks_fetcher,
)
from clew.config import get_settings
from clew.db.session import get_session
from clew.models import User

logger = logging.getLogger(__name__)

bearer = HTTPBearer(auto_error=False, description="Clerk session token")

UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Sign in to continue.",
    headers={"WWW-Authenticate": "Bearer"},
)


@lru_cache
def get_token_verifier() -> TokenVerifier | None:
    settings = get_settings()
    if settings.clerk_issuer is None:
        return None
    jwks = JwksCache(http_jwks_fetcher(f"{settings.clerk_issuer}/.well-known/jwks.json"))
    return TokenVerifier(settings.clerk_issuer, settings.cors_origins, jwks)


async def get_session_claims(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    verifier: Annotated[TokenVerifier | None, Depends(get_token_verifier)],
) -> SessionClaims:
    if verifier is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is not set up yet.")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UNAUTHORIZED
    try:
        return await verifier.verify(credentials.credentials)
    except InvalidToken as exc:
        logger.info("auth_rejected", extra={"reason": exc.reason})
        raise UNAUTHORIZED from None
    except SignInUnavailable:
        logger.error("auth_unavailable")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is temporarily unavailable."
        ) from None


async def get_current_user(
    claims: Annotated[SessionClaims, Depends(get_session_claims)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    user = await session.scalar(select(User).where(User.auth_provider_id == claims.subject))
    if user is None:
        if claims.email is None:
            # The Clerk session token needs an "email" claim (see backend/README setup).
            logger.warning("auth_rejected", extra={"reason": "missing_email_claim"})
            raise UNAUTHORIZED
        # First sign-in creates the account. ON CONFLICT covers two first requests racing.
        await session.execute(
            insert(User)
            .values(auth_provider_id=claims.subject, email=claims.email)
            .on_conflict_do_nothing(index_elements=[User.auth_provider_id])
        )
        await session.commit()
        user = await session.scalar(select(User).where(User.auth_provider_id == claims.subject))
        if user is None:  # pragma: no cover - the insert or the racing insert created it
            raise UNAUTHORIZED
    elif claims.email is not None and claims.email.lower() != user.email.lower():
        # Clerk owns the email address (and verifies changes); keep ours in step.
        await session.execute(update(User).where(User.id == user.id).values(email=claims.email))
        await session.commit()
        await session.refresh(user)

    if user.deleted_at is not None:
        raise UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
