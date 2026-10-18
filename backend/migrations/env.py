"""Alembic migrations, run as the table owner.

The URL comes from CLEW_MIGRATIONS_DATABASE_URL (or CLEW_DATABASE_URL), never from alembic.ini.
"""

import asyncio

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import clew.models  # noqa: F401  (registers every table on Base.metadata)
from clew.config import get_settings
from clew.db.base import Base

target_metadata = Base.metadata


def migrations_url() -> str:
    settings = get_settings()
    return settings.migrations_database_url or settings.database_url


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(migrations_url())
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_migrations_offline() -> None:
    context.configure(
        url=migrations_url(),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
