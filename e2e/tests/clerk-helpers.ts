import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, type Page } from "@playwright/test";

import { TEST_EMAIL_CODE, testEmail } from "../env";

/** Made-up name for test users. The Clerk instance may require first and last name. */
export const TEST_FIRST_NAME = "Ariadne";
export const TEST_LAST_NAME = "Testuser";

/** A Clerk test user made through Clerk's backend API, for specs that aren't about sign-up. */
export async function createTestUser(label: string): Promise<string> {
  const email = testEmail(label);
  const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  await backend.users.createUser({
    emailAddress: [email],
    firstName: TEST_FIRST_NAME,
    lastName: TEST_LAST_NAME,
    skipPasswordRequirement: true,
  });
  return email;
}

/**
 * Signs a new test user in without the UI (a one-time sign-in ticket). The page stays on
 * sign-in; callers open the page they test next.
 */
export async function signInAsNewUser(page: Page, label: string): Promise<string> {
  const email = await createTestUser(label);
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  return email;
}

/** Types Clerk's test code into the verification step. The first box has focus. */
export async function enterEmailCode(page: Page): Promise<void> {
  await expect(page.getByText(/check your email|verify your email/i).first()).toBeVisible();
  await page.keyboard.type(TEST_EMAIL_CODE);
}

/** Fills first and last name on the sign-up form when the Clerk instance asks for them. */
export async function fillNameIfAsked(page: Page): Promise<void> {
  const first = page.getByLabel(/first name/i);
  const last = page.getByLabel(/last name/i);
  if ((await first.count()) > 0) await first.fill(TEST_FIRST_NAME);
  if ((await last.count()) > 0) await last.fill(TEST_LAST_NAME);
}
