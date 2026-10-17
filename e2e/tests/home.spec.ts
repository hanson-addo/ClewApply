import { expect, test } from "@playwright/test";

// CI builds the web app without a Clerk key, so every route shows the
// "sign-in isn't set up" page. Signed-in journeys (AUTH-*, X-06 on the home
// page) need a Clerk dev instance and get their own spec once QA has keys.

test.describe("app without a Clerk key", () => {
  test("shows the Clew brand and says sign-in isn't set up", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Clew/);
    // The mark is decorative; the wordmark carries the name.
    await expect(page.getByText("clew", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sign-in isn't set up yet",
    );
  });

  test("shows the same page on the sign-in route", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sign-in isn't set up yet",
    );
  });

  test("keeps nothing in browser storage (AUTH-06)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const stored = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    expect(stored).toEqual({ local: [], session: [] });
  });
});
