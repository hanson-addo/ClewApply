// Runs `npm audit` and fails on any high or critical advisory, except those listed with a
// reason and an unexpired date in .github/npm-audit-exceptions.json. Run from a package
// folder: node ../../.github/scripts/npm-audit.mjs (or the right relative path).
// No dependencies: Node built-ins only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["high", "critical"]);

/** The advisories in `npm audit --json` output: one entry per advisory, not per package. */
export function advisories(report) {
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // A string `via` is a package that is only affected through another one; the
      // advisory itself is listed under that package.
      if (typeof via !== "object" || !via.url) continue;
      const id = via.url.split("/").pop();
      found.set(id, { id, package: via.name ?? name, severity: via.severity, title: via.title ?? "" });
    }
  }
  return [...found.values()];
}

/** What fails the check: blocking advisories with no live exception, and expired exceptions. */
export function verdict(found, exceptions, today) {
  const live = new Set(exceptions.filter((e) => e.expires >= today).map((e) => e.advisory));
  const blocking = found.filter((a) => BLOCKING.has(a.severity) && !live.has(a.id));
  const expired = exceptions.filter((e) => e.expires < today);
  const excused = found.filter((a) => BLOCKING.has(a.severity) && live.has(a.id));
  return { blocking, expired, excused };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const { exceptions } = JSON.parse(readFileSync(join(here, "..", "npm-audit-exceptions.json"), "utf8"));
  let output;
  try {
    output = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    output = error.stdout;
  }
  const report = JSON.parse(output);
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? "unknown error"}`);
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { blocking, expired, excused } = verdict(advisories(report), exceptions, today);
  for (const a of excused) console.log(`Allowed by exception: ${a.id} (${a.package}, ${a.severity})`);
  for (const e of expired) console.error(`Exception expired on ${e.expires}: ${e.advisory} (${e.package}). Review it.`);
  for (const a of blocking) console.error(`Blocking: ${a.id} (${a.package}, ${a.severity}) ${a.title}`);
  if (blocking.length || expired.length) process.exit(1);
  console.log("No blocking advisories.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
