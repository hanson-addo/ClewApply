// Builds each site's fill script on its own: Chrome injects classic scripts, and a classic
// (IIFE) build takes one entry at a time. Run by `npm run build` and `npm run build:dev`.
// The sites come from src/sites.ts (each site's `script: "content/<name>.js"`).
import { readFileSync } from "node:fs";
import { build } from "vite";

const sites = readFileSync(new URL("../src/sites.ts", import.meta.url), "utf8");
const entries = [...sites.matchAll(/script: "content\/([a-z]+)\.js"/g)].map((m) => m[1]);
if (entries.length === 0) throw new Error("No content scripts found in src/sites.ts.");

const modeAt = process.argv.indexOf("--mode");
const mode = modeAt === -1 ? "production" : process.argv[modeAt + 1];

for (const entry of entries) {
  await build({
    configFile: "vite.content.config.ts",
    mode,
    logLevel: "warn",
    build: { rollupOptions: { input: { [entry]: `src/content/${entry}.ts` } } },
  });
}
