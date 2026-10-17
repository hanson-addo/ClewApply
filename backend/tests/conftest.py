import os
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

# Tests run as "test". The base URL points at the local/CI server; each test run creates
# its own throwaway database there, migrates it, and drops it at the end.
os.environ.setdefault("CLEW_ENV", "test")
os.environ.setdefault("CLEW_DATABASE_URL", "postgresql+asyncpg://clew:clew@localhost:5432/clew")

from alembic import command
from alembic.config import Config

from clew.config import get_settings
from clew.db.session import get_engine, get_sessionmaker
from clew.main import create_app

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _clear_caches() -> None:
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()


@pytest.fixture(scope="session", autouse=True)
def test_database() -> Iterator[str]:
    base_url = make_url(os.environ["CLEW_DATABASE_URL"])
    name = f"clew_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(
        base_url.set(drivername="postgresql+psycopg", database="postgres"),
        isolation_level="AUTOCOMMIT",
    )
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))

    test_url = base_url.set(database=name).render_as_string(hide_password=False)
    os.environ["CLEW_DATABASE_URL"] = test_url
    _clear_caches()
    command.upgrade(Config(os.path.join(BACKEND_DIR, "alembic.ini")), "head")
    try:
        yield test_url
    finally:
        _clear_caches()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
        os.environ["CLEW_DATABASE_URL"] = base_url.render_as_string(hide_password=False)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def db() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session
