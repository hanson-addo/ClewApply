"""FastAPI entry point: `uvicorn clew.main:app`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clew import __version__
from clew.api import (
    applications,
    companies,
    consent,
    feed,
    health,
    jobs,
    me,
    preferences,
    profile,
    resume_parse,
    resumes,
)
from clew.config import get_settings
from clew.db.role_check import app_role_problems
from clew.db.session import get_engine
from clew.limits import BodySizeLimit
from clew.resumes.files import MAX_RESUME_BYTES


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if get_settings().env == "production":
        problems = await app_role_problems(get_engine())
        if problems:
            # Refuse to serve: with this role, one missed user check could leak other users' data.
            raise RuntimeError(
                "CLEW_DATABASE_URL must use the app role (clew_app member); the role "
                + ", ".join(problems)
            )
    yield


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
        lifespan=lifespan,
    )
    # Room for the multipart wrapping around a 10 MB file; the route checks the file exactly.
    # Added before CORS so CORS stays outermost and a 413 still carries CORS headers.
    app.add_middleware(
        BodySizeLimit, path_prefix="/resumes", max_bytes=MAX_RESUME_BYTES + 64 * 1024
    )
    app.add_middleware(
        BodySizeLimit,
        path_prefix="/profile",
        max_bytes=profile.MAX_PROFILE_BYTES,
        message=profile.TOO_LARGE,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(consent.router)
    app.include_router(profile.router)
    app.include_router(preferences.router)
    app.include_router(companies.router)
    app.include_router(feed.router)
    app.include_router(jobs.router)
    app.include_router(applications.router)
    app.include_router(resumes.router)
    app.include_router(resume_parse.router)
    return app


app = create_app()
