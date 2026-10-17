import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// X-09: the owner's easter egg lives only in server-side code.
const LINE = "A clew is the ball of thread that led Theseus out of the labyrinth";
const repo = join(import.meta.dirname, "..", "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test("easter egg is in the backend package and not in the web bundle (X-09)", () => {
  const backendInit = readFileSync(join(repo, "backend/src/clew/__init__.py"), "utf8");
  expect(backendInit).toContain(LINE);

  // The web server step builds apps/web/dist before any test runs.
  const shipped = filesUnder(join(repo, "apps/web/dist")).filter((f) => !/\.(woff2?|png|ico)$/.test(f));
  expect(shipped.length).toBeGreaterThan(0);
  const leaks = shipped.filter((f) => readFileSync(f, "utf8").includes("Theseus"));
  expect(leaks).toEqual([]);
});
