import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL } from "../env";
import { signInAsNewUser } from "./clerk-helpers";

/** A header with a fresh Clerk session token from the user signed in on `page`. */
export async function bearer(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(async () => {
    const clerk = (window as unknown as {
      Clerk?: { session?: { getToken(): Promise<string | null> } };
    }).Clerk;
    return (await clerk?.session?.getToken()) ?? null;
  });
  expect(token, "the page should have a Clerk session").toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

/**
 * Signs a new test user in and leaves `page` on the app with a live session, so API calls can
 * be made as that user the way the web app makes them. The first call creates the account.
 */
export async function signInForApi(
  page: Page,
  request: APIRequestContext,
  label: string,
): Promise<void> {
  await signInAsNewUser(page, label);
  await page.goto("/");
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
  );
  expect((await request.get(`${API_URL}/me`, { headers: await bearer(page) })).status()).toBe(200);
}
