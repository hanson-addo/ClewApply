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

`tests/signed-in.spec.ts` signs in through the Clerk development instance. It runs only when these are set, and is skipped otherwise:

| Variable | Value |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Development publishable key (`pk_test_…`) |
| `CLERK_SECRET_KEY` | Development secret key (`sk_test_…`). Never a production key |
| `CLEW_CLERK_ISSUER` | The instance's Frontend API URL |

In CI they come from GitHub Actions secrets, and only for this repository's own branches. Locally, export them in your shell; never commit them. The tests create Clerk users named `e2e-…+clerk_test@example.com` (Clerk's test addresses, which use the fixed code 424242 and get no real email), and the teardown deletes them.

The config also serves a second build without a Clerk key on port 4174, so the "sign-in isn't set up" page stays tested.

After a failure, `npm run report` opens the HTML report with traces and screenshots.

## Rules

- Made-up data only. Never real resumes or personal data.
- Never call real job sites. Use saved fixtures under `fixtures/`.
- Find elements by role and accessible name first, then `data-testid`. Never by CSS class.
- Each test sets up its own data so tests can run in parallel.
