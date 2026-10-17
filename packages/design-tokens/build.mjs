// Generates tokens.css and tokens.ts from tokens.json.
// Usage: node build.mjs          (write files)
//        node build.mjs --check  (fail if the files are out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadTokens() {
  const raw = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));
  delete raw.$description;
  return raw;
}

// Flattens nested groups into [path, value] pairs, e.g. ['color.ink.900', '#101935'].
export function flatten(obj, prefix = []) {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' ? flatten(value, [...prefix, key]) : [[[...prefix, key].join('.'), value]],
  );
}

// Replaces {group.name} references with their final value.
export function resolveAll(tokens) {
  const flat = new Map(flatten(tokens));
  const resolve = (value, seen = []) => {
    const match = /^\{(.+)\}$/.exec(value);
    if (!match) return value;
    const target = match[1];
    if (seen.includes(target)) throw new Error(`Circular token reference: ${[...seen, target].join(' -> ')}`);
    if (!flat.has(target)) throw new Error(`Unknown token reference: {${target}}`);
    return resolve(flat.get(target), [...seen, target]);
  };
  return new Map([...flat].map(([path, value]) => [path, resolve(value)]));
}

const cssName = (path) => `--clew-${path.replace(/^semantic\./, '').replaceAll('.', '-')}`;

function cssVar(path, raw) {
  const match = /^\{(.+)\}$/.exec(raw);
  return match ? `var(${cssName(match[1])})` : raw;
}

export function buildCss(tokens) {
  const lines = flatten(tokens).map(([path, raw]) => `  ${cssName(path)}: ${cssVar(path, raw)};`);
  return [
    '/* Generated from tokens.json by build.mjs. Do not edit by hand. */',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}

export function buildTs(tokens) {
  const resolved = resolveAll(tokens);
  const nest = {};
  for (const [path, value] of resolved) {
    const parts = path.split('.');
    let node = nest;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = value;
  }
  return [
    '// Generated from tokens.json by build.mjs. Do not edit by hand.',
    `export const tokens = ${JSON.stringify(nest, null, 2)} as const;`,
    '',
    'export type Tokens = typeof tokens;',
    'export type SemanticColor = keyof Tokens["semantic"];',
    '',
    '/** CSS custom property for a semantic color, e.g. cssVar("text-primary"). */',
    'export const cssVar = (name: SemanticColor): string => `var(--clew-${name})`;',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = loadTokens();
  const outputs = { 'tokens.css': buildCss(tokens), 'tokens.ts': buildTs(tokens) };
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [file, content] of Object.entries(outputs)) {
    const path = join(here, file);
    if (check) {
      let current = '';
      try { current = readFileSync(path, 'utf8'); } catch { /* missing counts as stale */ }
      if (current !== content) { console.error(`${file} is out of date. Run npm run build.`); stale = true; }
    } else {
      writeFileSync(path, content);
      console.log(`wrote ${file}`);
    }
  }
  if (stale) process.exit(1);
}
