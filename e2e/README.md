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

After a failure, `npm run report` opens the HTML report with traces and screenshots.

## Rules

- Made-up data only. Never real resumes or personal data.
- Never call real job sites. Use saved fixtures under `fixtures/`.
- Find elements by role and accessible name first, then `data-testid`. Never by CSS class.
- Each test sets up its own data so tests can run in parallel.
