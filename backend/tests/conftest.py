import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

# Tests run as "test" against the local/CI database unless the caller says otherwise.
os.environ.setdefault("CLEW_ENV", "test")
os.environ.setdefault("CLEW_DATABASE_URL", "postgresql+asyncpg://clew:clew@localhost:5432/clew")

from clew.main import create_app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
