#!/usr/bin/env node
// Deletes leftover end-to-end test users from Clew's Clerk DEVELOPMENT instance, which holds at
// most 100 users. Run it from the repository folder:
//
//   node e2e/scripts/delete-test-users.mjs
//
// It needs no packages. The secret key comes from CLERK_SECRET_KEY or CLEW_CLERK_SECRET_KEY in
// the environment, or else from .env or backend/.env. It never prints the key.
//
// Safety:
// - It refuses any key that is not a development key (sk_test_). A live key stops it at once.
// - It only touches users whose email starts with "e2e-" and contains "+clerk_test@", the
//   addresses the tests make. Real accounts are never listed or deleted.
// - It keeps test users made in the last hour, so a test run in progress keeps its pool of
//   up to three users.
// - It shows the count and asks before deleting anything.

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const API = "https://api.clerk.com/v1";
const PREFIX = "e2e-";
const KEEP_NEWER_THAN_MS = 60 * 60 * 1000;
const KEY_NAMES = ["CLERK_SECRET_KEY", "CLEW_CLERK_SECRET_KEY"];

function keyFromFile(path) {
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)$/);
    if (match && KEY_NAMES.includes(match[1])) {
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  return undefined;
}

function findKey() {
  for (const name of KEY_NAMES) if (process.env[name]) return process.env[name];
  return keyFromFile(".env") ?? keyFromFile("backend/.env");
}

export function isTestUser(user, now = Date.now()) {
  const emails = (user.email_addresses ?? []).map((e) => e.email_address ?? "");
  const looksLikeTest = emails.some((e) => e.startsWith(PREFIX) && e.includes("+clerk_test@"));
  return looksLikeTest && now - user.created_at > KEEP_NEWER_THAN_MS;
}

async function clerk(key, method, path) {
  const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Clerk answered ${response.status} for ${method} ${path.split("?")[0]}`);
  }
  return response.status === 404 ? null : response.json();
}

async function main() {
  const key = findKey();
  if (!key) {
    console.error("No Clerk secret key found. Put CLERK_SECRET_KEY=sk_test_... in .env or backend/.env.");
    process.exit(1);
  }
  if (!key.startsWith("sk_test_")) {
    console.error("Refusing to run: that is not a Clerk development key (sk_test_). Live users are never touched.");
    process.exit(1);
  }

  const doomed = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerk(key, "GET", `/users?query=${PREFIX}&limit=100&offset=${offset}`);
    if (!page?.length) break;
    for (const user of page) if (isTestUser(user)) doomed.push(user.id);
    if (page.length < 100) break;
  }

  if (doomed.length === 0) {
    console.log("No old test users to delete.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Delete ${doomed.length} test user(s) from the Clerk development instance? [y/N] `);
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Nothing deleted.");
    return;
  }
  let deleted = 0;
  for (const id of doomed) {
    await clerk(key, "DELETE", `/users/${encodeURIComponent(id)}`);
    deleted += 1;
  }
  console.log(`Deleted ${deleted} test user(s).`);
}

// Run only when started directly, so the test file can import isTestUser.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
