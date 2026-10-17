import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCss, buildTs, loadTokens, resolveAll } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = loadTokens();
const resolved = resolveAll(tokens);
const color = (name) => {
  const value = resolved.get(`semantic.${name}`);
  assert.ok(value, `missing semantic color ${name}`);
  return value;
};

// WCAG 2.2 relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every foreground/background pair the component specs use.
// 4.5 = body text (WCAG 1.4.3). 3 = large text, icons, control borders, focus rings (1.4.11).
const pairs = [
  ['text-primary', 'bg-page', 4.5],
  ['text-primary', 'bg-surface', 4.5],
  ['text-primary', 'bg-subtle', 4.5],
  ['text-secondary', 'bg-page', 4.5],
  ['text-secondary', 'bg-surface', 4.5],
  ['text-secondary', 'bg-subtle', 4.5],
  ['text-accent', 'bg-surface', 4.5],
  ['text-accent', 'bg-page', 4.5],
  ['text-link', 'bg-surface', 4.5],
  ['text-link', 'bg-page', 4.5],
  ['text-link-hover', 'bg-surface', 4.5],
  ['text-selected', 'bg-selected', 4.5],
  ['text-accent', 'bg-selected', 4.5],
  ['text-on-inverse', 'bg-inverse', 4.5],
  ['text-on-inverse-muted', 'bg-inverse', 4.5],
  ['text-on-inverse', 'bg-inverse-raised', 4.5],
  ['text-on-inverse-muted', 'bg-inverse-raised', 4.5],
  ['text-link-on-inverse', 'bg-inverse', 4.5],
  ['action-primary-fg', 'action-primary-bg', 4.5],
  ['action-primary-fg', 'action-primary-bg-hover', 4.5],
  ['action-secondary-fg', 'action-secondary-bg', 4.5],
  ['action-inverse-fg', 'action-inverse-bg', 4.5],
  ['status-success-fg', 'status-success-bg', 4.5],
  ['status-warning-fg', 'status-warning-bg', 4.5],
  ['status-danger-fg', 'status-danger-bg', 4.5],
  ['status-info-fg', 'status-info-bg', 4.5],
  ['status-danger-fg', 'bg-surface', 4.5],
  ['border-control', 'bg-surface', 3],
  ['border-control', 'bg-page', 3],
  ['action-secondary-border', 'action-secondary-bg', 3],
  ['focus-ring', 'bg-surface', 3],
  ['focus-ring', 'bg-page', 3],
  ['focus-ring-on-inverse', 'bg-inverse', 3],
  ['control-accent', 'bg-surface', 3],
  ['action-primary-bg', 'bg-inverse', 3],
  ['status-success-edge', 'bg-surface', 3],
  ['status-warning-edge', 'bg-surface', 3],
];

for (const [fg, bg, min] of pairs) {
  test(`${fg} on ${bg} meets ${min}:1`, () => {
    const ratio = contrast(color(fg), color(bg));
    assert.ok(ratio >= min, `${fg} ${color(fg)} on ${bg} ${color(bg)} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  });
}

test('coral 500 is never used as text on light backgrounds', () => {
  // Coral 500 on white is about 2.8:1. It is a fill color only.
  for (const name of ['text-primary', 'text-secondary', 'text-accent', 'text-link', 'text-link-hover', 'text-selected']) {
    assert.notEqual(color(name), tokens.color.coral['500'], `${name} must not be coral 500`);
  }
});

test('touch targets are at least 44px', () => {
  for (const key of ['touch-target', 'control-height', 'control-height-lg']) {
    assert.ok(parseInt(tokens.size[key], 10) >= 44, `${key} is below 44px`);
  }
});

test('body text is at least 16px', () => {
  assert.equal(tokens.font.size.md, '1rem');
});

test('every reference resolves to a hex color or plain value', () => {
  for (const [path, value] of resolved) {
    assert.ok(!value.startsWith('{'), `${path} did not resolve`);
    if (path.startsWith('color.') || path.startsWith('semantic.')) {
      assert.match(value, /^#[0-9A-F]{6}$/, `${path} should be an uppercase 6-digit hex color`);
    }
  }
});

test('generated tokens.css and tokens.ts are up to date', () => {
  assert.equal(readFileSync(join(here, 'tokens.css'), 'utf8'), buildCss(tokens), 'run npm run build');
  assert.equal(readFileSync(join(here, 'tokens.ts'), 'utf8'), buildTs(tokens), 'run npm run build');
});
