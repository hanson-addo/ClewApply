"""Database engine and per-request sessions."""

import uuid
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session, SessionTransaction

from clew.config import get_settings

USER_ID_KEY = "user_id"
SET_USER_ID = text("SELECT set_config('app.user_id', :user_id, true)")


class ClewSession(Session):
    """Session that re-binds the signed-in user at the start of every transaction."""


@event.listens_for(ClewSession, "after_begin")
def _bind_user_to_transaction(
    session: Session, transaction: SessionTransaction, connection: Connection
) -> None:
    user_id: Any = session.info.get(USER_ID_KEY)
    if user_id is not None:
        # is_local=true: the setting ends with the transaction, so a pooled connection
        # never carries one user's id into another request.
        connection.execute(SET_USER_ID, {"user_id": str(user_id)})


async def bind_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Scope row-level security to this user for the rest of the session."""
    session.info[USER_ID_KEY] = user_id
    if session.in_transaction():
        await session.execute(SET_USER_ID, {"user_id": str(user_id)})


@lru_cache
def get_engine() -> AsyncEngine:
    return create_async_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False, sync_session_class=ClewSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session
