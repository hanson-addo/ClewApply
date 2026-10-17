"""Health checks used by Render and CI."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from clew import __version__
from clew.db.session import get_session

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok"]
    version: str


class Readiness(BaseModel):
    status: Literal["ok", "unavailable"]
    database: Literal["ok", "unavailable"]


@router.get("/health")
async def health() -> Health:
    """The process is up. Does not touch the database."""
    return Health(status="ok", version=__version__)


@router.get("/ready", responses={503: {"model": Readiness}})
async def ready(
    response: Response, session: Annotated[AsyncSession, Depends(get_session)]
) -> Readiness:
    """The process can reach the database."""
    try:
        await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return Readiness(status="unavailable", database="unavailable")
    return Readiness(status="ok", database="ok")
