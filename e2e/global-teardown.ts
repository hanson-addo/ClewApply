import { createClerkClient } from "@clerk/backend";

import { hasClerk, TEST_USER_PREFIX } from "./env";

/** Deletes the Clerk test users this run created, so the development instance stays tidy. */
export default async function globalTeardown(): Promise<void> {
  if (!hasClerk) return;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  for (;;) {
    const { data } = await clerk.users.getUserList({ query: TEST_USER_PREFIX, limit: 100 });
    const ours = data.filter((user) =>
      user.emailAddresses.some(
        (e) => e.emailAddress.startsWith(TEST_USER_PREFIX) && e.emailAddress.includes("+clerk_test@"),
      ),
    );
    if (ours.length === 0) return;
    await Promise.all(ours.map((user) => clerk.users.deleteUser(user.id)));
  }
}
