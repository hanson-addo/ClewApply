// Run with: node --test apps/landing/landing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const headers = readFileSync(new URL("./_headers", import.meta.url), "utf8");

test("page is static: no scripts, forms or inputs", () => {
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<form|<input|<iframe/i);
});

test("page has a title, description and viewport", () => {
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /name="viewport"/);
});

test("page doesn't name third-party job sites", () => {
  for (const name of ["LinkedIn", "Indeed", "ZipRecruiter", "Greenhouse"]) {
    assert.ok(!html.includes(name), `${name} found`);
  }
});

test("security headers are set", () => {
  for (const h of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy"]) {
    assert.ok(headers.includes(h), `${h} missing`);
  }
  assert.match(headers, /default-src 'none'/);
});
