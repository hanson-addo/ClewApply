# Clew end-to-end tests

Playwright tests that start the real API and a production build of the web app, then drive them in Chromium. Test IDs in the specs (AUTH-06, X-01 and so on) match the [test plan](../docs/qa/e2e-test-plan.md).

## Run them

You need everything from the main [README](../README.md#run-it-locally) (Postgres running, `uv sync` in `backend`, `npm install` in `apps/web`).

```sh
cd e2e
npm install
npx playwright install chromium   # once
npm test
```

The config starts the API on port 8000 (with `CLEW_ENV=test`) and the web app on port 4173. If they are already running, it reuses them. On a machine with Chromium already installed, set `PLAYWRIGHT_CHROMIUM_PATH` to its path instead of running `playwright install`.

### Signed-in tests

`tests/signed-in.spec.ts` and the API specs sign in through the Clerk development instance. They run only when these are set, and are skipped otherwise:

| Variable | Value |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Development publishable key (`pk_test_…`) |
| `CLERK_SECRET_KEY` | Development secret key (`sk_test_…`). Never a production key |
| `CLEW_CLERK_ISSUER` | The instance's Frontend API URL |

In CI they come from GitHub Actions secrets, and only for this repository's own branches. Locally, export them in your shell; never commit them. Signed-in tests share at most three Clerk test users per run, one per Playwright worker, named `e2e-<run id>-pool-<n>+clerk_test@example.com`; before each test the user's Clew account is wiped in the database (this needs `CLEW_MIGRATIONS_DATABASE_URL` and `psql`), so every test still starts as a brand-new user. Only the sign-up test creates its own user. These are Clerk's test addresses, which use the fixed code 424242 and get no real email. The teardown deletes only the current run's users, so runs that overlap on the shared instance never delete each other's.

If old test users ever pile up (the development instance holds at most 100), delete them from the repository folder with `node e2e/scripts/delete-test-users.mjs`. It reads the development key from `CLERK_SECRET_KEY` or `CLEW_CLERK_SECRET_KEY` (environment, `.env` or `backend/.env`), refuses anything but an `sk_test_` key, touches only `e2e-...+clerk_test@` users older than an hour, and asks before deleting.

### Upload tests

`tests/resume-upload-api.spec.ts` also needs file storage and the virus scanner. It runs only when `CLEW_S3_BUCKET` and `CLEW_CLAMAV_HOST` are set (and the Clerk keys above). CI starts MinIO (Bitnami's build, since MinIO no longer publishes images on Docker Hub) and ClamAV in the end-to-end job. Locally, run `docker compose up -d minio clamav` from the repository root, wait for ClamAV to finish loading its signatures, and export the `CLEW_S3_*` and `CLEW_CLAMAV_*` values from `backend/.env.example`. Every test file is built in memory at test time (`tests/files.ts`), including the harmless EICAR antivirus test string.

`tests/resume-parse-api.spec.ts` checks reading a resume into a draft profile. It also needs Redis: it runs only when `CLEW_REDIS_URL` is set as well (`docker compose up -d redis`, then `redis://localhost:6379/0`). The config then starts the background worker and `fake-anthropic.mjs`, a local stand-in for the Anthropic API that the worker is pointed at, so no AI key is needed and nothing goes to Anthropic. It answers every resume with fixed made-up fields, and copies the resume's first line in as the name to show the text was read. To try the real AI instead, set `CLEW_E2E_ANTHROPIC_API_KEY`; the tests that rely on the stand-in's answers then skip, and one test sends a made-up resume to the real AI.

The config also serves a second build without a Clerk key on port 4174, so the "sign-in isn't set up" page stays tested.

After a failure, `npm run report` opens the HTML report with traces and screenshots.

## Rules

- Made-up data only. Never real resumes or personal data.
- Never call real job sites. Use saved fixtures under `fixtures/`.
- Find elements by role and accessible name first, then `data-testid`. Never by CSS class.
- Each test sets up its own data so tests can run in parallel.
