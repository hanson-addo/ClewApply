import assert from "node:assert/strict";
import { test } from "node:test";

import { isTestUser } from "./delete-test-users.mjs";

const now = Date.UTC(2026, 10, 17, 12);
const hoursAgo = (h) => now - h * 60 * 60 * 1000;
const user = (email, createdAt) => ({ email_addresses: [{ email_address: email }], created_at: createdAt });

test("an old e2e test user is deleted", () => {
  assert.equal(isTestUser(user("e2e-123-1-pool-0+clerk_test@example.com", hoursAgo(2)), now), true);
});

test("a test user from a run in progress is kept", () => {
  assert.equal(isTestUser(user("e2e-123-1-pool-0+clerk_test@example.com", hoursAgo(0.5)), now), false);
});

test("a real account is never touched", () => {
  assert.equal(isTestUser(user("someone@example.com", hoursAgo(48)), now), false);
  assert.equal(isTestUser(user("e2e-fan@example.com", hoursAgo(48)), now), false);
});
