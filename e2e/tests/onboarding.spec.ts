import AxeBuilder from "@axe-core/playwright";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { hasClerk, hasParsing, realParserKey } from "../env";
import { signInForApi } from "./api-as";
import { textPdf } from "./files";

// Onboarding (#14): consent, upload, review the draft, preferences, then the feed, through
// the real stack. The worker's AI calls go to the local stand-in (fake-anthropic.mjs). The
// resume is made up and built at test time.
test.skip(!hasClerk, "Clerk development keys are not set");
test.skip(!hasParsing, "Storage, the virus scanner or Redis is not set up");
test.skip(Boolean(realParserKey), "Checks the stand-in's fixed answers");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

const RESUME = ["Ariadne Testuser", "Thread engineer at Labyrinth Logistics, 2021 to now"];

test("upload a resume and confirm the profile (UP-09)", async ({ page, request }) => {
  await signInForApi(page, request, "onboarding");
  await page.goto("/");
  await page.getByRole("link", { name: "Add your resume" }).click();
  await expect(page).toHaveURL(/\/onboarding\/upload$/);

  const consent = page.getByRole("checkbox", { name: /Let Clew's AI read my resume/ });
  await expect(consent).not.toBeChecked();
  await expect(consent).toBeEnabled();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await consent.click();
  await expect(consent).toBeChecked();
  await expect(page.getByText(/You agreed on/)).toBeVisible();

  await page.getByLabel("Choose a file").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: textPdf(RESUME),
  });
  const review = page.getByRole("link", { name: "Review what we found" });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.click();

  await expect(page).toHaveURL(/\/onboarding\/review/);
  // The stand-in echoes the first line of the text it was sent.
  await expect(page.getByLabel("Full name")).toHaveValue("Ariadne Testuser");
  await expect(page.getByRole("heading", { name: /fields? needs? a look/ })).toBeVisible();
  await page.getByRole("button", { name: "Looks good, continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/preferences$/);
  await page.getByLabel("Job titles").fill("Thread Engineer");
  await page.getByLabel("Places").fill("Austin, TX");
  await page.getByRole("button", { name: "Show my jobs" }).click();
  await expect(page).toHaveURL(/\/jobs$/);

  await page.goto("/profile/basics");
  await expect(page.getByLabel("Full name")).toHaveValue("Ariadne Testuser");
});

test("decline AI reading and fill the profile by hand", async ({ page, request }) => {
  await signInForApi(page, request, "onboarding-byhand");
  await page.goto("/onboarding/upload");
  await expect(page.getByRole("checkbox", { name: /Let Clew's AI/ })).toBeEnabled();
  await page.getByLabel("Choose a file").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: textPdf(RESUME),
  });
  await expect(page.getByText("Your resume is saved.").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Read my resume" })).toBeDisabled();
  await page.getByRole("link", { name: "Enter my details by hand" }).click();

  await expect(page.getByText(/Add your details below/)).toBeVisible();
  await page.getByLabel("Full name").fill("Ariadne Testuser");
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/preferences$/);
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/jobs$/);
});
