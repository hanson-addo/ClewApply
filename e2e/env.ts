// Shared settings for the config and the specs. Kept separate from playwright.config.ts so
// specs can import it without loading the whole config.

export const WEB_URL = "http://localhost:4173";
/** The same web app built without a Clerk key, so the "sign-in isn't set up" page stays tested. */
export const SETUP_URL = "http://localhost:4174";
export const API_URL = "http://localhost:8000";

/**
 * Signed-in specs run only when Clerk's development keys are present (GitHub Actions secrets on
 * this repository's own branches). Pull requests from forks and Dependabot get no secrets and
 * skip them.
 */
export const hasClerk = Boolean(
  process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY && process.env.CLEW_CLERK_ISSUER,
);

// These tests create and delete Clerk users, so they must never run against a live instance.
if (
  hasClerk &&
  !(
    process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") &&
    process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
  )
) {
  throw new Error(
    "End-to-end tests need Clerk development keys (pk_test_ and sk_test_), never live keys.",
  );
}

/**
 * Upload specs need S3-compatible storage and ClamAV. CI starts MinIO and ClamAV and sets these;
 * the API server inherits them. Locally, `docker compose up` and export the same CLEW_S3_* and
 * CLEW_CLAMAV_* values as backend/.env.example.
 */
export const hasUploadServices = Boolean(process.env.CLEW_S3_BUCKET && process.env.CLEW_CLAMAV_HOST);

/**
 * One id per test run, shared by setup, teardown and every worker. On GitHub Actions it is the
 * run id and attempt; locally a random one. The config loads this file first, so workers
 * inherit the value through the environment.
 */
process.env.CLEW_E2E_RUN_ID ??= process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : `local${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Every Clerk user this run creates starts with this, so teardown deletes only this run's users
 * and never those of another run sharing the development instance.
 */
export const TEST_USER_BASE_PREFIX = "e2e-";
export const TEST_USER_PREFIX = `${TEST_USER_BASE_PREFIX}${process.env.CLEW_E2E_RUN_ID}-`;

/**
 * A fresh Clerk test address. "+clerk_test" addresses never get real email; a development
 * instance accepts the fixed code 424242 for them.
 */
export function testEmail(label: string): string {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${TEST_USER_PREFIX}${label}-${unique}+clerk_test@example.com`;
}

export const TEST_EMAIL_CODE = "424242";

/**
 * Signed-in specs share a small pool of Clerk test users, one per Playwright worker, instead of
 * creating a user per test (a run used to create dozens, and the development instance holds at
 * most 100). Each test still starts on an empty Clew account: its data is wiped first.
 */
export const TEST_USER_POOL_SIZE = 3;

/** The pool user for one worker slot, the same address all run long. */
export function poolEmail(slot: number): string {
  return `${TEST_USER_PREFIX}pool-${slot}+clerk_test@example.com`;
}

/**
 * Resume reading also needs Redis and the background worker. With these set, the config starts
 * the worker and a stand-in for the Anthropic API (fake-anthropic.mjs), so reading runs end to
 * end without a real key or real AI calls.
 */
export const hasParsing = hasUploadServices && Boolean(process.env.CLEW_REDIS_URL);
export const FAKE_ANTHROPIC_URL = "http://127.0.0.1:8787";
/**
 * Set this to a real Anthropic key to send the made-up test resumes to the real AI instead of
 * the stand-in. Tests that depend on the stand-in's answers skip then.
 */
export const realParserKey = process.env.CLEW_E2E_ANTHROPIC_API_KEY ?? "";
