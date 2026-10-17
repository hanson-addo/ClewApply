"""FastAPI entry point: `uvicorn clew.main:app`."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clew import __version__
from clew.api import health
from clew.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    is_local = settings.env == "local"
    app = FastAPI(
        title="Clew API",
        version=__version__,
        # Interactive docs and the public schema only for local development.
        # `python -m clew.openapi` calls app.openapi() directly, so it still works.
        docs_url="/docs" if is_local else None,
        openapi_url="/openapi.json" if is_local else None,
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router)
    return app


app = create_app()
