import { defineConfig, devices } from "@playwright/test";

// Starts the real API and a production build of the web app, then drives it
// in Chromium. Test plan: ../docs/qa/e2e-test-plan.md

const WEB_PORT = 4173;
const API_PORT = 8000;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

const isCI = !!process.env.CI;

// Lets a machine with a preinstalled Chromium skip `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
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
      command: `uv run uvicorn clew.main:app --port ${API_PORT}`,
      cwd: "../backend",
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        CLEW_ENV: "test",
        CLEW_DATABASE_URL:
          process.env.CLEW_DATABASE_URL ?? "postgresql+asyncpg://clew:clew@localhost:5432/clew",
        CLEW_CORS_ORIGINS: JSON.stringify([WEB_URL]),
      },
    },
    {
      name: "web",
      command: `npm run build && npm run preview -- --port ${WEB_PORT} --strictPort`,
      cwd: "../apps/web",
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
