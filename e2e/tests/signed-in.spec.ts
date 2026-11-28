import AxeBuilder from "@axe-core/playwright";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { API_URL, hasClerk, testEmail } from "../env";
import {
  createTestUser,
  enterEmailCode,
  fillNameIfAsked,
  SIGN_IN_TIMEOUT,
  signInWithFreshAccount,
} from "./clerk-helpers";

// Sign-in journeys against the Clerk development instance (test plan §3.1). They need the
// CLERK_* and CLEW_CLERK_ISSUER secrets; without them every test here is skipped.
test.skip(!hasClerk, "Clerk development keys are not set");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

const emailField = (page: Page) => page.getByLabel(/email address/i);
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const welcome = (page: Page) => page.getByRole("heading", { level: 1, name: /set up your profile|welcome back/i });

async function expectSignInPage(page: Page) {
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Pick up the thread" })).toBeVisible();
  await expect(emailField(page)).toBeVisible();
}

test.describe("signed out", () => {
  test("opening the app goes to sign-in (AUTH-10)", async ({ page }) => {
    await page.goto("/");
    await expectSignInPage(page);
  });

  test("an unknown page also goes to sign-in (AUTH-10)", async ({ page }) => {
    await page.goto("/applications");
    await expectSignInPage(page);
  });

  test("sign-in page promises never to ask for job-site passwords (AUTH-14)", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByText("Clew never asks for your passwords on other sites.")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("sign-in page: no serious accessibility issues, no sideways scroll (X-01, X-02) @phone", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(emailField(page)).toBeVisible();
    await expectNoBlockingA11yIssues(page);
    await expectNoSidewaysScroll(page);
  });
});

test.describe("sign up and sign in", () => {
  test("a new user signs up with an email code and gets a free account (AUTH-01)", async ({
    page,
  }) => {
    const email = testEmail("signup");
    await page.goto("/sign-up");
    await expect(emailField(page)).toBeVisible();
    await fillNameIfAsked(page);
    await emailField(page).fill(email);
    await continueButton(page).click();
    const me = page.waitForResponse((r) => r.url() === `${API_URL}/me` && r.ok());
    await enterEmailCode(page);

    await expect(welcome(page)).toBeVisible({ timeout: SIGN_IN_TIMEOUT });
    expect(await (await me).json()).toMatchObject({ email, plan: "free" });
    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("a returning user signs in with an email code (AUTH-02)", async ({ page }) => {
    const email = await createTestUser("returning");
    await page.goto("/sign-in");
    await emailField(page).fill(email);
    await continueButton(page).click();
    await enterEmailCode(page);

    await expect(welcome(page)).toBeVisible({ timeout: SIGN_IN_TIMEOUT });
    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("signing in again finds the same account", async ({ page }) => {
    await signInWithFreshAccount(page, "same-account");
    const first = await openHomeAndReadMe(page);
    const second = await openHomeAndReadMe(page);
    expect(second.id).toBe(first.id);
  });
});

test.describe("signed in", () => {
  test("sign out returns to sign-in and the app stays closed (AUTH-08)", async ({ page }) => {
    await signInWithFreshAccount(page, "signout");
    await page.goto("/");
    await expect(welcome(page)).toBeVisible({ timeout: SIGN_IN_TIMEOUT });

    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expectSignInPage(page);

    await page.goto("/");
    await expectSignInPage(page);
    await page.goBack();
    await expectSignInPage(page);
    await expect(welcome(page)).toHaveCount(0);
  });

  test("no session token is kept in browser storage (AUTH-06)", async ({ page }) => {
    await signInWithFreshAccount(page, "storage");
    await page.goto("/");
    await expect(welcome(page)).toBeVisible({ timeout: SIGN_IN_TIMEOUT });

    // Clerk may cache non-secret settings; what must never be there is a JWT.
    const values = await page.evaluate(() =>
      [window.localStorage, window.sessionStorage].flatMap((store) =>
        Object.keys(store).map((key) => store.getItem(key) ?? ""),
      ),
    );
    const jwtLike = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
    expect(values.filter((v) => jwtLike.test(v))).toEqual([]);
  });

  test("home page: no serious accessibility issues, no sideways scroll (X-01, X-02) @phone", async ({
    page,
  }) => {
    await signInWithFreshAccount(page, "a11y");
    await page.goto("/");
    await expect(welcome(page)).toBeVisible({ timeout: SIGN_IN_TIMEOUT });
    await expectNoBlockingA11yIssues(page);
    await expectNoSidewaysScroll(page);
  });

  // X-06: the home page explains API failures instead of breaking.
  const failures = [
    { name: "server error", status: 500, body: {}, message: /couldn.t load your account/i },
    { name: "service down", status: 503, body: {}, message: /temporarily unavailable/i },
    {
      name: "no email on the account",
      status: 403,
      body: { detail: "email_required" },
      message: /needs an email address/i,
    },
  ];
  for (const failure of failures) {
    test(`home page explains a ${failure.name} (X-06)`, async ({ page }) => {
      await page.route(`${API_URL}/me`, (route) =>
        route.fulfill({
          status: failure.status,
          contentType: "application/json",
          body: JSON.stringify(failure.body),
        }),
      );
      await signInWithFreshAccount(page, "x06");
      await page.goto("/");
      await expect(page.getByRole("alert")).toHaveText(failure.message);
    });
  }
});

async function openHomeAndReadMe(page: Page): Promise<{ id: string }> {
  const response = page.waitForResponse((r) => r.url() === `${API_URL}/me` && r.ok());
  await page.goto("/");
  await expect(welcome(page)).toBeVisible({ timeout: SIGN_IN_TIMEOUT });
  return (await response).json();
}

async function expectNoBlockingA11yIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
  expect(blocking).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
