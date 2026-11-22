import { defineConfig, type Plugin } from "vite";

import { HOSTS } from "./manifest.config.ts";
import { noDevHosts, targetOf } from "./vite.config.ts";

/**
 * Fails the build if a fill-panel script could reach the token or the API (Security #8): it
 * may not mention chrome.storage, fetch or the API's address. Only the service worker does
 * those things.
 */
export function contentGuard(apiUrls: string[]): Plugin {
  const forbidden = [/chrome\.storage/, /["'`]storage["'`]/, /\bstorage\.(local|session|sync)\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/];
  return {
    name: "clew-content-guard",
    writeBundle(_, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== "chunk") continue;
        const hit = forbidden.find((pattern) => pattern.test(item.code));
        if (hit) this.error(`The content script ${fileName} uses ${hit.source}.`);
        if (apiUrls.some((url) => item.code.includes(url))) this.error(`The content script ${fileName} names the API.`);
      }
    },
  };
}

/**
 * Builds one site's content script as a self-contained classic script (Chrome can't inject
 * modules), next to the main build in dist/content/. scripts/build-content.mjs runs it once per
 * site and supplies the entry.
 */
export default defineConfig(({ mode }) => {
  const target = targetOf(mode);
  return {
    plugins: [
      contentGuard(Object.values(HOSTS).map((hosts) => hosts.apiUrl)),
      ...(target === "production" ? [noDevHosts()] : []),
    ],
    build: {
      outDir: "dist/content",
      emptyOutDir: false,
      target: "chrome116",
      sourcemap: false,
      copyPublicDir: false,
      rollupOptions: {
        output: { format: "iife", entryFileNames: "[name].js" },
      },
    },
  };
});
