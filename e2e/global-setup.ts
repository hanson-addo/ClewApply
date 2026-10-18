import { clerkSetup } from "@clerk/testing/playwright";

import { hasClerk } from "./env";

/** Gets a Clerk testing token so sign-in isn't blocked by bot protection. */
export default async function globalSetup(): Promise<void> {
  if (!hasClerk) return;
  await clerkSetup();
}
