import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

import { API_URL, FAKE_ANTHROPIC_URL, hasParsing, realParserKey, SETUP_URL, WEB_URL } from "./env";

// Starts the real API and two production builds of the web app (with and without a Clerk key),
// then drives them in Chromium. Test plan: ../docs/qa/e2e-test-plan.md

const isCI = !!process.env.CI;

// Lets a machine with a preinstalled Chromium skip `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const port = (url: string) => new URL(url).port;

const databaseUrl =
  process.env.CLEW_DATABASE_URL ?? "postgresql+asyncpg://clew_app:clew_app@localhost:5432/clew";

// Resume reading: the background worker, and the stand-in AI unless a real key was given.
type WebServer = Exclude<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]>;
const parsingServers: WebServer[] = !hasParsing
  ? []
  : [
      ...(realParserKey
        ? []
        : [
            {
              name: "fake-anthropic",
              command: "node fake-anthropic.mjs",
              url: `${FAKE_ANTHROPIC_URL}/health`,
              reuseExistingServer: !isCI,
              timeout: 30_000,
              env: { FAKE_ANTHROPIC_URL },
            },
          ]),
      {
        name: "worker",
        command: "uv run arq clew.worker.WorkerSettings",
        cwd: "../backend",
        wait: { stderr: /Starting worker/ },
        timeout: 120_000,
        env: {
          CLEW_ENV: "test",
          CLEW_DATABASE_URL: databaseUrl,
          ...(realParserKey
            ? { CLEW_ANTHROPIC_API_KEY: realParserKey }
            : { CLEW_ANTHROPIC_API_KEY: "e2e-fake-key", ANTHROPIC_BASE_URL: FAKE_ANTHROPIC_URL }),
        },
      },
    ];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        launchOptions: { executablePath },
      },
      grep: /@phone/,
    },
  ],
  webServer: [
    {
      name: "api",
      command: `uv run uvicorn clew.main:app --port ${port(API_URL)}`,
      cwd: "../backend",
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        CLEW_ENV: "test",
        CLEW_DATABASE_URL: databaseUrl,
        CLEW_CORS_ORIGINS: JSON.stringify([WEB_URL]),
        CLEW_CLERK_ISSUER: process.env.CLEW_CLERK_ISSUER ?? "",
      },
    },
    {
      name: "web",
      command: `npm run build && npx vite preview --port ${port(WEB_URL)} --strictPort`,
      cwd: "../apps/web",
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        VITE_API_URL: API_URL,
        VITE_CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? "",
      },
    },
    {
      // Built straight with Vite (the "web" step already type-checks) into its own folder.
      name: "web-without-clerk",
      command: `npx vite build --outDir ../../e2e/.build/web-without-clerk --emptyOutDir && npx vite preview --outDir ../../e2e/.build/web-without-clerk --port ${port(SETUP_URL)} --strictPort`,
      cwd: "../apps/web",
      url: SETUP_URL,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: { VITE_API_URL: API_URL, VITE_CLERK_PUBLISHABLE_KEY: "" },
    },
    ...parsingServers,
  ],
});
