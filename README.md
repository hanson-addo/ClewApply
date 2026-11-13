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
docker compose up -d                   # Postgres, MinIO file storage, ClamAV virus scanner and Redis, local only

cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn clew.main:app --reload  # API on http://localhost:8000 (docs at /docs)
uv run arq clew.worker.WorkerSettings  # In a second terminal: reads resumes, fetches jobs

cd ../apps/web
cp .env.example .env.local
npm install
npm run dev                            # Web app on http://localhost:5173
```

The virus scanner downloads its signatures the first time it starts, which takes a few minutes. Resume uploads answer "try again" until it's ready.

The API logs in to Postgres as `clew_app`, a role that row-level security applies to, and migrations run as `clew`, the owner. A new Docker volume creates `clew_app` for you. If your volume is older than that, run `uv run alembic upgrade head` and then this once: `docker compose exec postgres psql -U clew -c "ALTER ROLE clew_app LOGIN PASSWORD 'clew_app'"`. Details are in [docs/setup/database.md](docs/setup/database.md).

Reading resumes into a draft profile needs an Anthropic API key. Put it in `backend/.env` as `CLEW_ANTHROPIC_API_KEY` and never commit it. Without a key, uploads still work and the app says reading resumes is unavailable.

Federal jobs come from the free USAJobs Search API. Request a key at developer.usajobs.gov, then put it in `backend/.env` as `CLEW_USAJOBS_API_KEY`, with the email it was issued to as `CLEW_USAJOBS_EMAIL`. Never commit either. The worker reads USAJobs once a day at 07:00 UTC; without the key it skips USAJobs.

Sign-in needs a Clerk development instance. The one-time setup is in [docs/setup/clerk.md](docs/setup/clerk.md). Without it, the app still runs, but signed-in pages say sign-in isn't set up.

Checks that CI runs on every pull request:

```sh
cd backend  && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
```

End-to-end tests start the API and web app themselves (Postgres must be running). See [e2e/README.md](e2e/README.md):

```sh
cd e2e && npm install && npx playwright install chromium && npm test
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
