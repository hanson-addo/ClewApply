import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// X-01 and X-02 from the test plan. Add each new screen to SCREENS as it lands.
const SCREENS = [{ name: "landing", path: "/" }];

for (const screen of SCREENS) {
  test(`${screen.name}: no serious or critical accessibility issues (X-01) @phone`, async ({
    page,
  }) => {
    await page.goto(screen.path);
    await expect(page.getByRole("status")).not.toHaveText(/Checking/);

    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    expect(blocking).toEqual([]);
  });

  test(`${screen.name}: no sideways scrolling (X-02) @phone`, async ({ page }) => {
    await page.goto(screen.path);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
