import assert from "node:assert/strict";
import { test } from "node:test";

import { advisories, invalidExceptions, verdict } from "./npm-audit.mjs";

const report = {
  vulnerabilities: {
    picomatch: { via: [{ url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf", name: "picomatch", severity: "high" }] },
    tinyglobby: { via: ["picomatch"] },
    minimatch: { via: [{ url: "https://github.com/advisories/GHSA-g3hv-75wg-m249", name: "minimatch", severity: "moderate" }] },
  },
};
const exception = { advisory: "GHSA-fc5q-39xc-vjpf", package: "picomatch", reason: "no fix", expires: "2026-12-31" };

test("lists each advisory once, from the package it is filed against", () => {
  assert.deepEqual(advisories(report).map((a) => a.id), ["GHSA-fc5q-39xc-vjpf", "GHSA-g3hv-75wg-m249"]);
});

test("a listed advisory passes until its exception expires", () => {
  const ok = verdict(advisories(report), [exception], "2026-11-17");
  assert.equal(ok.blocking.length, 0);
  assert.equal(ok.excused.length, 1);
  const late = verdict(advisories(report), [exception], "2027-01-01");
  assert.equal(late.blocking.length, 1);
  assert.equal(late.expired.length, 1);
});

test("any other high or critical advisory still fails; moderate ones never do", () => {
  const other = {
    vulnerabilities: {
      ...report.vulnerabilities,
      lodash: { via: [{ url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz", name: "lodash", severity: "critical" }] },
    },
  };
  const result = verdict(advisories(other), [exception], "2026-11-17");
  assert.deepEqual(result.blocking.map((a) => a.id), ["GHSA-xxxx-yyyy-zzzz"]);
});

test("each exception needs a GHSA id, a reason and an expiry within 90 days", () => {
  assert.deepEqual(invalidExceptions([exception], "2026-11-17"), []);
  const bad = [
    { ...exception, reason: " " },
    { ...exception, expires: "next year" },
    { ...exception, expires: "2027-06-01" },
    { ...exception, advisory: "CVE-2026-1" },
  ];
  assert.equal(invalidExceptions(bad, "2026-11-17").length, 4);
});
