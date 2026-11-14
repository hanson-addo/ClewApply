import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";

import { hasClerk, TEST_USER_BASE_PREFIX } from "./env";

export default async function globalSetup(): Promise<void> {
  if (!hasClerk) return;
  await sweepStaleTestUsers();
  await clerkSetup();
  seedJobs();
}

/** Test users older than this belong to a run that has finished; a run takes minutes. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Deletes test users that earlier runs left behind (a cancelled job never reaches teardown).
 * The development instance holds at most 100 users, so leftovers make later runs fail with
 * user_quota_exceeded. Only "+clerk_test" addresses with the test prefix are touched, and only
 * once they're an hour old, so a run that is still going keeps its users.
 */
async function sweepStaleTestUsers(): Promise<void> {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const cutoff = Date.now() - STALE_AFTER_MS;
  const stale: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data } = await clerk.users.getUserList({ query: TEST_USER_BASE_PREFIX, limit: 100, offset });
    for (const user of data) {
      const isTestUser = user.emailAddresses.some(
        (e) => e.emailAddress.startsWith(TEST_USER_BASE_PREFIX) && e.emailAddress.includes("+clerk_test@"),
      );
      if (isTestUser && user.createdAt < cutoff) stale.push(user.id);
    }
    if (data.length < 100) break;
  }
  for (const id of stale) await clerk.users.deleteUser(id);
  if (stale.length) console.log(`Deleted ${stale.length} test users left by earlier runs.`);
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
