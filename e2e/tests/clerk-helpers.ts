import { execFileSync } from "node:child_process";

import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, type Page, test } from "@playwright/test";

import { poolEmail, TEST_EMAIL_CODE } from "../env";

/** Made-up name for test users. The Clerk instance may require first and last name. */
export const TEST_FIRST_NAME = "Ariadne";
export const TEST_LAST_NAME = "Testuser";

const backend = () => createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/** This worker's pool user (env.ts), created the first time a test asks for it. */
let pooled: { slot: number; id: string; email: string } | undefined;

async function poolUser(): Promise<{ id: string; email: string }> {
  const slot = test.info().parallelIndex;
  if (pooled?.slot === slot) return pooled;
  const email = poolEmail(slot);
  const clerkApi = backend();
  const { data } = await clerkApi.users.getUserList({ emailAddress: [email] });
  const user =
    data[0] ??
    (await clerkApi.users.createUser({
      emailAddress: [email],
      firstName: TEST_FIRST_NAME,
      lastName: TEST_LAST_NAME,
      skipPasswordRequirement: true,
    }));
  pooled = { slot, id: user.id, email };
  return pooled;
}

/**
 * Wipes the Clew account behind a Clerk user, so the next sign-in starts empty, as a brand-new
 * user would. Deleting the users row removes every per-user row through ON DELETE CASCADE.
 * Needs the database owner's URL (CI sets it); without it the account carries over.
 */
function resetClewAccount(clerkUserId: string): void {
  const owner = process.env.CLEW_MIGRATIONS_DATABASE_URL;
  if (!owner) return;
  execFileSync("psql", [owner.replace("+asyncpg", ""), "-q", "-v", "ON_ERROR_STOP=1", "-v", `id=${clerkUserId}`], {
    input: "DELETE FROM users WHERE auth_provider_id = :'id';\n",
    stdio: ["pipe", "ignore", "inherit"],
  });
}

/**
 * A Clerk test user with an empty Clew account, for specs that aren't about sign-up: this
 * worker's pool user, wiped first. `label` names the test in failures only.
 */
export async function createTestUser(label: string): Promise<string> {
  const user = await poolUser();
  test.info().annotations.push({ type: "test user", description: `${label}: pool ${user.email}` });
  resetClewAccount(user.id);
  return user.email;
}

/**
 * Signs a test user with an empty Clew account in without the UI (a one-time sign-in ticket).
 * The page stays on sign-in; callers open the page they test next.
 */
export async function signInWithFreshAccount(page: Page, label: string): Promise<string> {
  const email = await createTestUser(label);
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  return email;
}

/**
 * Types Clerk's test code into the verification step. Focuses the first code box explicitly
 * once it is enabled, because typing before Clerk moves focus there drops digits.
 */
export async function enterEmailCode(page: Page): Promise<void> {
  await expect(page.getByText(/check your email|verify your email/i).first()).toBeVisible();
  const firstBox = page
    .locator('input[autocomplete="one-time-code"]')
    .or(page.getByLabel(/verification code/i))
    .first();
  await expect(firstBox).toBeEnabled();
  await firstBox.click();
  await page.keyboard.type(TEST_EMAIL_CODE, { delay: 50 });
}

/** Clerk's sign-in round trip plus the first /me call can take longer than the default 5s. */
export const SIGN_IN_TIMEOUT = 15_000;

/** Fills first and last name on the sign-up form when the Clerk instance asks for them. */
export async function fillNameIfAsked(page: Page): Promise<void> {
  const first = page.getByLabel(/first name/i);
  const last = page.getByLabel(/last name/i);
  if ((await first.count()) > 0) await first.fill(TEST_FIRST_NAME);
  if ((await last.count()) > 0) await last.fill(TEST_LAST_NAME);
}
