import { expect, test } from "@playwright/test";

// The scaffold has one screen: the landing page with a live API status line.
// Sign-in (AUTH-*) and later journeys get their own spec files as they land.

test.describe("landing page", () => {
  test("shows the Clew brand and says the service is up", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Clew/);
    await expect(page.getByRole("img", { name: "Clew" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "One profile and one job feed for every site you job hunt on.",
    );
    await expect(page.getByRole("status")).toHaveText("Clew service is up");
  });

  test("says the service is unreachable when the API is down (X-06)", async ({ page }) => {
    await page.route("**/health", (route) => route.abort("connectionrefused"));
    await page.goto("/");

    await expect(page.getByRole("status")).toHaveText("Clew service is unreachable");
  });

  test("says the service is unreachable when the API errors (X-06)", async ({ page }) => {
    await page.route("**/health", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/");

    await expect(page.getByRole("status")).toHaveText("Clew service is unreachable");
  });

  test("keeps nothing in browser storage (AUTH-06)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Clew service is up");

    const stored = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    expect(stored).toEqual({ local: [], session: [] });
  });
});
