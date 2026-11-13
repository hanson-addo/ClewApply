import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { clerkSetup } from "@clerk/testing/playwright";

import { hasClerk } from "./env";

export default async function globalSetup(): Promise<void> {
  if (!hasClerk) return;
  await clerkSetup();
  seedJobs();
}

/**
 * Adds the made-up jobs the feed and Applications specs use (seed-jobs.py). Needs the database
 * owner's URL, as CI sets it; without it those specs skip.
 */
function seedJobs(): void {
  const owner = process.env.CLEW_MIGRATIONS_DATABASE_URL;
  if (!owner) return;
  execFileSync("uv", ["run", "python", "../e2e/seed-jobs.py"], {
    cwd: fileURLToPath(new URL("../backend", import.meta.url)),
    env: { ...process.env, CLEW_DATABASE_URL: owner },
    stdio: "inherit",
  });
}
