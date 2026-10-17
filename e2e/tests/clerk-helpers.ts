import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, type Page } from "@playwright/test";

import { TEST_EMAIL_CODE, testEmail } from "../env";

/** A Clerk test user made through Clerk's backend API, for specs that aren't about sign-up. */
export async function createTestUser(label: string): Promise<string> {
  const email = testEmail(label);
  const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  await backend.users.createUser({ emailAddress: [email], skipPasswordRequirement: true });
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
