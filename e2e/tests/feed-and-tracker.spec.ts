import AxeBuilder from "@axe-core/playwright";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

import { hasClerk } from "../env";
import { SIGN_IN_TIMEOUT, signInWithFreshAccount } from "./clerk-helpers";
import { hasSeededJobs, MAZE, ROUTE, THREAD } from "./seed";

// The job feed (#106-#108) and the Applications board (#109, #110), end to end on desktop and
// on a 390px phone. The feed reads made-up jobs that global setup adds (seed-jobs.py). Each
// test signs in a fresh user, so saves and dismissals never leak between tests.
test.skip(!hasClerk, "Clerk development keys are not set");
test.skip(!hasSeededJobs, "Seeding jobs needs the database owner's URL");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  // A description that ran as HTML would open a dialog; fail loudly if anything does.
  page.on("dialog", (dialog) => {
    throw new Error(`Unexpected dialog: ${dialog.message()}`);
  });
});

const isPhone = () => test.info().project.name === "phone";
const card = (page: Page, title: string) =>
  page.getByRole("link", { name: new RegExp(`^${title}, `) });
// By id: on desktop a column is a region named by its heading, "Saved (2)"; on phones it's a
// tab panel named by its tab, "Saved 2".
const column = (page: Page, label: string) => page.locator(`#apps-col-${label.toLowerCase()}`);
const statusOf = (page: Page, title: string) => page.getByLabel(`Status of ${title}`);

async function openFeed(page: Page, label: string) {
  await signInWithFreshAccount(page, label);
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Your jobs" })).toBeVisible({
    timeout: SIGN_IN_TIMEOUT,
  });
  await expect(card(page, THREAD.title)).toBeVisible();
}

async function openBoard(page: Page, label: string) {
  await signInWithFreshAccount(page, label);
  await page.goto("/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible({
    timeout: SIGN_IN_TIMEOUT,
  });
}

async function addApplication(page: Page, title: string, company: string) {
  await page.getByRole("button", { name: "Add an application" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an application" });
  await dialog.getByLabel("Job title").fill(title);
  await dialog.getByLabel("Company").fill(company);
  await dialog.getByRole("button", { name: "Add application" }).click();
  await expect(dialog).toBeHidden();
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectNoSeriousAxeIssues(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
  expect(blocking).toEqual([]);
}

test.describe("job feed", () => {
  test("lists jobs once each, with the sites they were seen on", async ({ page }) => {
    await openFeed(page, "feed-list");
    await expect(page.getByRole("status").filter({ hasText: /^\d+ jobs?$/ })).toBeVisible();
    // The Greenhouse listing and the alert email are one job.
    await expect(card(page, THREAD.title)).toHaveCount(1);
    await expect(card(page, THREAD.title)).toHaveAccessibleName(
      new RegExp(`^${THREAD.title}, ${THREAD.company}, .*fit \\d+ of 100$`),
    );
    const thread = page.getByRole("article").filter({ has: card(page, THREAD.title) });
    await expect(thread).toContainText("Greenhouse");
    await expect(thread).toContainText("Job alert email");
    await expect(card(page, ROUTE.title)).toBeVisible();
    await expect(card(page, MAZE.title)).toBeVisible();
    await expect(page.getByText("Pick a job to see why it fits and where to apply.")).toBeVisible();
  });

  test("a job's detail shows fit, a safe Apply link and the description as plain text", async ({
    page,
  }) => {
    await openFeed(page, "feed-detail");
    await card(page, THREAD.title).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}/);
    const detail = page.getByRole("article", { name: THREAD.title });
    await expect(detail.getByText(/^FIT \d+ OF 100$/)).toBeVisible();

    const apply = detail.getByRole("link", {
      name: `Apply on ${THREAD.company}'s site (opens in a new tab)`,
    });
    await expect(apply).toHaveAttribute("href", /^https:\/\/boards\.greenhouse\.io\//);
    await expect(apply).toHaveAttribute("target", "_blank");
    await expect(apply).toHaveAttribute("rel", "noopener noreferrer");
    await expect(detail.getByText(THREAD.domain, { exact: true })).toBeVisible();

    const where = detail.getByRole("region", { name: "Where it's posted" });
    await expect(where.getByRole("link", { name: /Greenhouse/ })).toBeVisible();
    await expect(where.getByRole("link", { name: /Job alert email/ })).toBeVisible();
    await expect(where).toContainText("Apply here");

    // The description holds markup, and it must show as text, never run.
    const description = detail.locator("#job-description");
    await expect(description).toContainText("<script>alert(1)</script>");
    await expect(description.locator("script, img")).toHaveCount(0);
    await expect(description).not.toContainText("The last line of the description.");
    const more = detail.getByRole("button", { name: "Read the full description" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(description).toContainText("The last line of the description.");
    await detail.getByRole("button", { name: "Show less" }).click();
    await expect(description).not.toContainText("The last line of the description.");

    // A USAJobs listing says so on its button.
    await card(page, ROUTE.title).click();
    await expect(
      page.getByRole("link", { name: "Apply on USAJobs (opens in a new tab)" }),
    ).toBeVisible();
  });

  test("saving a job puts it in Applications under Saved, and unsaving takes it out", async ({
    page,
  }) => {
    await openFeed(page, "feed-save");
    await card(page, THREAD.title).click();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    const saved = page.getByRole("button", { name: "Saved", exact: true });
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.reload();
    await expect(saved).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await expect(column(page, "Saved").getByRole("link", { name: THREAD.title })).toBeVisible();
    await expect(statusOf(page, THREAD.title)).toHaveValue("saved");

    await page.goBack();
    await page.getByRole("button", { name: "Saved", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Removed from saved jobs." }),
    ).toBeVisible();
    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();
  });

  test("Not for me hides a job, Undo brings it back, and a hidden job stays hidden", async ({
    page,
  }) => {
    await openFeed(page, "feed-dismiss");
    await card(page, MAZE.title).click();
    await page.getByRole("button", { name: "Not for me" }).click();
    await expect(page.getByText(`Hidden ${MAZE.title}.`)).toBeVisible();
    await expect(card(page, MAZE.title)).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(`${MAZE.title} is back in your jobs.`)).toBeVisible();
    await expect(card(page, MAZE.title)).toBeVisible();

    await card(page, MAZE.title).click();
    await page.getByRole("button", { name: "Not for me" }).click();
    await expect(card(page, MAZE.title)).toHaveCount(0);
    await page.goto("/jobs");
    await expect(card(page, THREAD.title)).toBeVisible();
    await expect(card(page, MAZE.title)).toHaveCount(0);
  });

  test("filters narrow the list, live in the address and survive a reload", async ({ page }) => {
    await openFeed(page, "feed-filters");
    const filters = page.getByRole("complementary", { name: "Filters" });

    await filters.getByLabel("Work type").selectOption("remote");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/[?&]work=remote/);
    await expect(card(page, THREAD.title)).toBeVisible();
    await expect(card(page, ROUTE.title)).toHaveCount(0);
    await expect(card(page, MAZE.title)).toHaveCount(0);

    await page.reload();
    await expect(card(page, THREAD.title)).toBeVisible();
    await expect(card(page, ROUTE.title)).toHaveCount(0);
    await expect(filters.getByLabel("Work type")).toHaveValue("remote");

    await filters.getByLabel("Work type").selectOption("");
    await filters.getByLabel("State").fill("Texas");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(card(page, ROUTE.title)).toBeVisible();
    await expect(card(page, THREAD.title)).toHaveCount(0);

    await filters.getByLabel("State").fill("");
    await filters.getByLabel("Source").selectOption("usajobs");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/[?&]source=usajobs/);
    await expect(card(page, ROUTE.title)).toBeVisible();
    await expect(card(page, MAZE.title)).toHaveCount(0);

    await filters.getByLabel("Minimum yearly pay").fill("2000000");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("heading", { name: "No matches right now" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).not.toHaveURL(/\?/);
    await expect(card(page, MAZE.title)).toBeVisible();
    await expect(card(page, THREAD.title)).toBeVisible();
  });
});

test.describe("Applications board", () => {
  test("a new account sees an empty board that points to the feed", async ({ page }) => {
    await openBoard(page, "board-empty");
    await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();
    await page.getByRole("link", { name: "Go to your jobs" }).click();
    await expect(page).toHaveURL(/\/jobs$/);
  });

  test("adding checks required fields and links, then lands the card under Applied", async ({
    page,
  }) => {
    await openBoard(page, "board-add");
    await page.getByRole("button", { name: "Add an application" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an application" });
    await expect(dialog.getByLabel("Status", { exact: true })).toHaveValue("applied");
    await dialog.getByRole("button", { name: "Add application" }).click();
    await expect(dialog.getByText("Enter the job title.")).toBeVisible();
    await expect(dialog.getByText("Enter the company.")).toBeVisible();

    await dialog.getByLabel("Job title").fill("E2E Clue Keeper");
    await dialog.getByLabel("Company").fill("Ariadne Archives");
    await dialog.getByLabel("Link to the posting (optional)").fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Add application" }).click();
    await expect(
      dialog.getByText("Enter a link that starts with https:// or http://."),
    ).toBeVisible();

    await dialog.getByLabel("Link to the posting (optional)").fill("https://example.com/jobs/clue");
    await dialog.getByRole("button", { name: "Add application" }).click();
    await expect(dialog).toBeHidden();
    await expect(column(page, "Applied").getByRole("link", { name: "E2E Clue Keeper" })).toBeVisible();
    // Focus lands on the new card's Status select.
    await expect(statusOf(page, "E2E Clue Keeper")).toBeFocused();

    // Escape closes the dialog and gives focus back.
    await page.getByRole("button", { name: "Add an application" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Add an application" })).toBeFocused();
  });

  test("the Status select moves a card between columns, and it stays moved", async ({ page }) => {
    await openBoard(page, "board-move");
    await addApplication(page, "E2E Clue Keeper", "Ariadne Archives");

    await statusOf(page, "E2E Clue Keeper").selectOption("interview");
    await expect(column(page, "Interview").getByRole("link", { name: "E2E Clue Keeper" })).toBeVisible();
    await expect(page.getByText("E2E Clue Keeper moved to Interview.")).toBeAttached();
    await expect(statusOf(page, "E2E Clue Keeper")).toBeFocused();

    await statusOf(page, "E2E Clue Keeper").selectOption("rejected");
    const closed = column(page, "Closed");
    await expect(closed.getByRole("link", { name: "E2E Clue Keeper" })).toBeVisible();
    await expect(closed.getByText("Rejected", { exact: true })).toBeVisible();

    await page.reload();
    await expect(closed.getByRole("link", { name: "E2E Clue Keeper" })).toBeVisible();
    await expect(statusOf(page, "E2E Clue Keeper")).toHaveValue("rejected");
    await expect(column(page, "Applied")).toHaveAccessibleName("Applied (0)");
  });

  test("an application's page saves notes and deletes after asking", async ({ page }) => {
    await openBoard(page, "board-detail");
    await addApplication(page, "E2E Clue Keeper", "Ariadne Archives");
    await page.getByRole("link", { name: "E2E Clue Keeper" }).click();
    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1, name: "E2E Clue Keeper" })).toBeVisible();

    const notes = page.getByRole("textbox", { name: "Notes", exact: true });
    const saveNotes = page.getByRole("button", { name: "Save notes" });
    await expect(saveNotes).toBeDisabled();
    await notes.fill("Called back on a made-up Tuesday.");
    await saveNotes.click();
    await expect(page.getByText("Notes saved.")).toBeAttached();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue(
      "Called back on a made-up Tuesday.",
    );

    // Keep it changes nothing; Delete application removes it.
    await page.getByRole("button", { name: "Delete application" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("Delete this application? This can't be undone.");
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E2E Clue Keeper" })).toBeVisible();

    await page.getByRole("button", { name: "Delete application" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test("feed: filters fold away, and a job opens as its own page @phone", async ({ page }) => {
    test.skip(!isPhone(), "Phone layout only");
    await openFeed(page, "phone-feed");
    await expectNoSidewaysScroll(page);

    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Work type")).toBeHidden();
    await toggle.click();
    await page.getByLabel("Work type").selectOption("remote");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "Filters, 1 on" })).toBeVisible();
    await expect(card(page, ROUTE.title)).toHaveCount(0);

    await card(page, THREAD.title).click();
    await expect(page.getByRole("heading", { name: THREAD.title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Your jobs" })).toBeHidden();
    await expectNoSidewaysScroll(page);

    await page.getByRole("link", { name: "Back to jobs" }).click();
    await expect(page).toHaveURL(/\/jobs\?work=remote$/);
    await expect(card(page, THREAD.title)).toBeVisible();
  });

  test("board: status tabs show one column, work with arrow keys, and follow a move @phone", async ({
    page,
  }) => {
    test.skip(!isPhone(), "Phone layout only");
    await openBoard(page, "phone-board");
    await addApplication(page, "E2E Clue Keeper", "Ariadne Archives");

    const tabs = page.getByRole("tablist", { name: "Status" });
    const applied = tabs.getByRole("tab", { name: "Applied 1" });
    await expect(applied).toHaveAttribute("aria-selected", "true");
    await expect(column(page, "Applied")).toBeVisible();
    await expect(column(page, "Saved")).toBeHidden();
    await expectNoSidewaysScroll(page);

    await applied.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: /^Interview/ })).toBeFocused();
    await expect(column(page, "Interview")).toBeVisible();
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: /^Closed/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: /^Saved/ })).toHaveAttribute("aria-selected", "true");

    await tabs.getByRole("tab", { name: /^Applied/ }).click();
    await statusOf(page, "E2E Clue Keeper").selectOption("offer");
    await expect(tabs.getByRole("tab", { name: "Offer 1" })).toHaveAttribute("aria-selected", "true");
    await expect(column(page, "Offer").getByRole("link", { name: "E2E Clue Keeper" })).toBeVisible();
  });
});

test("feed, job detail and board have no serious accessibility issues @phone", async ({
  page,
}) => {
  await openFeed(page, "axe");
  await expectNoSeriousAxeIssues(page);
  await expectNoSideScrollAndAxe(page, () => card(page, THREAD.title).click());

  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();
  await addApplication(page, "E2E Clue Keeper", "Ariadne Archives");
  await expectNoSeriousAxeIssues(page);
  await expectNoSidewaysScroll(page);
});

async function expectNoSideScrollAndAxe(page: Page, open: () => Promise<void>) {
  await open();
  await expect(page.getByText(/^FIT \d+ OF 100$/)).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  await expectNoSidewaysScroll(page);
}
