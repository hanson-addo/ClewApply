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

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) running. Nothing else.

```sh
cp .env.example .env    # then fill in the two Clerk values (docs/setup/clerk.md)
docker compose up       # first run builds for a few minutes; later runs start in seconds
```

Open http://localhost:5173. The API is on http://localhost:8000 (docs at /docs). `docker compose up` starts Postgres, file storage (MinIO), the virus scanner (ClamAV), Redis, the API (it updates the database first), the worker and the web app. Code changes reload on their own. Stop with Ctrl+C; `docker compose down` removes the containers and keeps your data.

- The virus scanner downloads its signatures the first time it starts, which takes a few minutes. Until then uploads answer "try again".
- Reading resumes needs `CLEW_ANTHROPIC_API_KEY` in `.env`. Without it, uploads still work and the app says reading is unavailable.
- Federal jobs need `CLEW_USAJOBS_API_KEY` and `CLEW_USAJOBS_EMAIL` (a free key from developer.usajobs.gov). The worker reads USAJobs daily at 07:00 UTC and company boards hourly. To fetch now: `docker compose exec worker python -m clew.maintenance fetch-jobs`.
- After every `git pull`, run `docker compose up --build -V`. `--build` installs any new packages, the API brings the database up to date as it starts, and `-V` replaces the web app's old copy of its packages, which Docker would otherwise keep. Your data is in named volumes, so it stays.
- Never commit `.env`; git ignores it.

The API logs in to Postgres as `clew_app`, a role that row-level security applies to, and migrations run as `clew`, the owner. A new Docker volume creates `clew_app` for you. If your volume is older than that, run this once: `docker compose exec postgres psql -U clew -c "ALTER ROLE clew_app LOGIN PASSWORD 'clew_app'"`. Details are in [docs/setup/database.md](docs/setup/database.md).

### Without Docker for the app (for running tests)

The checks and end-to-end tests below run the API and web app on your machine. Start only the services with `docker compose up -d postgres minio clamav redis`, then use `backend/.env.example` and `apps/web/.env.example` (copy to `backend/.env` and `apps/web/.env.local`). You need Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 22.

```sh
cd backend  && uv sync && uv run alembic upgrade head && uv run uvicorn clew.main:app --reload
cd backend  && uv run arq clew.worker.WorkerSettings    # second terminal
cd apps/web && npm install && npm run dev                # third terminal
```

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
