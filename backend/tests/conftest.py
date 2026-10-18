import os
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Tests run as "test". The owner URL points at the local/CI server; each test run creates
# its own throwaway database there, migrates it as the owner, and drops it at the end.
# The API under test connects as the app role, exactly as in production, so row-level
# security is in force for every API test.
os.environ.setdefault("CLEW_ENV", "test")
os.environ.setdefault(
    "CLEW_MIGRATIONS_DATABASE_URL",
    os.environ.get("CLEW_DATABASE_URL", "postgresql+asyncpg://clew:clew@localhost:5432/clew"),
)
os.environ["CLEW_DATABASE_URL"] = os.environ["CLEW_MIGRATIONS_DATABASE_URL"]
from alembic import command
from alembic.config import Config

from clew.config import get_settings
from clew.db.rls import APP_ROLE
from clew.db.session import get_engine, get_sessionmaker
from clew.main import create_app

OWNER_URL = os.environ["CLEW_MIGRATIONS_DATABASE_URL"]
APP_ROLE_PASSWORD = "clew_app"  # noqa: S105 - local/CI test database only
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _clear_caches() -> None:
    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()


@pytest.fixture(scope="session", autouse=True)
def test_database() -> Iterator[str]:
    base_url = make_url(OWNER_URL)
    name = f"clew_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(
        base_url.set(drivername="postgresql+psycopg", database="postgres"),
        isolation_level="AUTOCOMMIT",
    )
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))

    owner_url = base_url.set(database=name).render_as_string(hide_password=False)
    os.environ["CLEW_MIGRATIONS_DATABASE_URL"] = owner_url
    os.environ["CLEW_DATABASE_URL"] = owner_url
    _clear_caches()
    command.upgrade(Config(os.path.join(BACKEND_DIR, "alembic.ini")), "head")
    with admin.connect() as conn:
        # The migration creates the role without a login; tests give it one.
        conn.execute(text(f"ALTER ROLE {APP_ROLE} LOGIN PASSWORD '{APP_ROLE_PASSWORD}'"))
    os.environ["CLEW_DATABASE_URL"] = (
        make_url(owner_url)
        .set(username=APP_ROLE, password=APP_ROLE_PASSWORD)
        .render_as_string(hide_password=False)
    )
    _clear_caches()
    try:
        yield owner_url
    finally:
        _clear_caches()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
        os.environ["CLEW_DATABASE_URL"] = OWNER_URL
        os.environ["CLEW_MIGRATIONS_DATABASE_URL"] = OWNER_URL


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def db(test_database: str) -> AsyncIterator[AsyncSession]:
    """A session as the table owner (a superuser locally and in CI), which skips row-level
    security, for setting up and checking data directly."""
    engine = create_async_engine(test_database)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def app_db() -> AsyncIterator[AsyncSession]:
    """A session as the API's own role, with row-level security in force."""
    async with get_sessionmaker()() as session:
        yield session
