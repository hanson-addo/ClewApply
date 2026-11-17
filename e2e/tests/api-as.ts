import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL } from "../env";
import { signInWithFreshAccount } from "./clerk-helpers";

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
 * Signs a test user with an empty account in and leaves `page` on the app with a live session, so API calls can
 * be made as that user the way the web app makes them. The first call creates the account.
 */
export async function signInForApi(
  page: Page,
  request: APIRequestContext,
  label: string,
): Promise<void> {
  await signInWithFreshAccount(page, label);
  await page.goto("/");
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
  );
  expect((await request.get(`${API_URL}/me`, { headers: await bearer(page) })).status()).toBe(200);
}

/** Uploads a resume as the user signed in on `page`. */
export async function uploadResume(
  page: Page,
  request: APIRequestContext,
  name: string,
  buffer: Buffer,
  mimeType = "application/octet-stream",
) {
  return request.post(`${API_URL}/resumes`, {
    headers: await bearer(page),
    multipart: { file: { name, mimeType, buffer } },
    timeout: 60_000,
  });
}

/** Lets Clew's AI read resumes for the user signed in on `page` (#75), as ticking the box
 *  on the upload screen does. */
export async function agreeToAiReading(page: Page, request: APIRequestContext): Promise<void> {
  const headers = await bearer(page);
  const current = await request.get(`${API_URL}/me/ai-consent`, { headers });
  expect(current.status()).toBe(200);
  const { policy_version } = (await current.json()) as { policy_version: string };
  const response = await request.put(`${API_URL}/me/ai-consent`, {
    headers,
    data: { agreed: true, policy_version },
  });
  expect(response.status(), await response.text()).toBe(200);
}
