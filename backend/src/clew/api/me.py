"""The signed-in user's own account."""

import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from clew.auth.deps import CurrentUser

router = APIRouter(tags=["account"])


class Me(BaseModel):
    id: uuid.UUID
    email: str
    plan: str


@router.get("/me", responses={401: {"description": "Not signed in"}})
async def me(user: CurrentUser) -> Me:
    """Who is signed in. The first call after sign-up creates the Clew account."""
    return Me(id=user.id, email=user.email, plan=user.plan)
