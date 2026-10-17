# Clew

One profile and one job feed for every site you job hunt on.

Clew keeps a single master profile and resume. A Clew browser add-on fills your latest profile into each job site (LinkedIn, Indeed, ZipRecruiter, USAJobs) inside your own logged-in browser, and you approve every change before it is saved. Jobs from USAJobs, company career pages and your job alert emails land in one deduplicated feed, ranked by how well they fit you.

- Design doc: https://claude.ai/code/artifact/cd08badf-820c-494f-afd9-307e715d1171
- Clickable mockups: https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D

## Status

Phase 1 (foundation) is starting: sign-in, resume upload and parsing, master profile with versions, job feed with dedup and ranking, application tracker.

## Planned layout

```
apps/web/        React + TypeScript (Vite) web app
apps/extension/  Browser add-on (Manifest V3, TypeScript)
backend/         Python 3.12, FastAPI, SQLAlchemy, Alembic
docs/            Specs, threat model, test plans
```

## Run it locally

You need Docker, Python 3.12 with [uv](https://docs.astral.sh/uv/), and Node 22.

```sh
docker compose up -d                   # Postgres with pgvector (5432) and Redis (6379), local only

cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn clew.main:app --reload  # API on http://localhost:8000 (docs at /docs)

cd ../apps/web
cp .env.example .env.local
npm install
npm run dev                            # Web app on http://localhost:5173
```

Checks that CI runs on every pull request:

```sh
cd backend  && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
```

When an API route changes, refresh the shared types so the web app's client stays in step:

```sh
cd backend  && uv run python -m clew.openapi > openapi.json
cd apps/web && npm run gen:api
```

## Stack

| Layer | Choice |
| --- | --- |
| Web app | React, TypeScript, Vite |
| Browser add-on | TypeScript, Manifest V3 |
| API | Python 3.12, FastAPI, Pydantic v2 |
| Database | PostgreSQL with pgvector |
| Background jobs | Redis + worker queue |
| Files | S3-compatible storage |
| Sign-in | Clerk |
| Hosting | Render to start |

## How changes get in

Every change goes on a branch and becomes a pull request. A reviewer checks it for bugs and quality, security must sign off with a written verdict, automated checks must pass, and the owner merges it. Nothing is pushed straight to `main`. See [CLAUDE.md](CLAUDE.md) for the full team rules.

## License

Proprietary. All rights reserved.
