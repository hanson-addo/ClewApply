from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from clew import __version__
from clew.config import get_settings
from clew.db.session import get_session
from clew.main import create_app


async def test_health_is_ok(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


async def test_ready_reaches_database(client: AsyncClient) -> None:
    response = await client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_ready_reports_unavailable_database() -> None:
    class BrokenSession:
        async def execute(self, *_: object) -> None:
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    async def broken_session() -> AsyncIterator[AsyncSession]:
        yield BrokenSession()  # type: ignore[misc]

    app = create_app()
    app.dependency_overrides[get_session] = broken_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}


async def test_docs_hidden_outside_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEW_ENV", "production")
    get_settings.cache_clear()
    try:
        app = create_app()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/docs")).status_code == 404
    finally:
        get_settings.cache_clear()
