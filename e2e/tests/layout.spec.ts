import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { SETUP_URL } from "../env";

// X-01 and X-02 from the test plan for screens anyone can open. Signed-in screens are checked
// in signed-in.spec.ts. Add each new public screen to SCREENS as it lands.
const SCREENS = [{ name: "setup-needed", url: `${SETUP_URL}/` }];

for (const screen of SCREENS) {
  test(`${screen.name}: no serious or critical accessibility issues (X-01) @phone`, async ({
    page,
  }) => {
    await page.goto(screen.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
    expect(blocking).toEqual([]);
  });

  test(`${screen.name}: no sideways scrolling (X-02) @phone`, async ({ page }) => {
    await page.goto(screen.url);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
