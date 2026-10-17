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

/** Every Clerk user these tests create starts with this, so teardown deletes only its own. */
export const TEST_USER_PREFIX = "e2e-";

/**
 * A fresh Clerk test address. "+clerk_test" addresses never get real email; a development
 * instance accepts the fixed code 424242 for them.
 */
export function testEmail(label: string): string {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${TEST_USER_PREFIX}${label}-${unique}+clerk_test@example.com`;
}

export const TEST_EMAIL_CODE = "424242";
