/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";

import { buildManifest, HOSTS, type Target } from "./manifest.config.ts";

export function targetOf(mode: string): Target {
  return mode === "development" ? "development" : "production";
}

/** Writes manifest.json for the target. */
function manifest(target: Target): Plugin {
  return {
    name: "clew-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(buildManifest(target), null, 2)}\n`,
      });
    },
  };
}

const DEV_HOSTS = /localhost|127\.0\.0\.1|\[::1\]/;

/** Fails a production build if any file in it mentions a dev host (Security #2). */
export function noDevHosts(): Plugin {
  return {
    name: "clew-no-dev-hosts",
    writeBundle(_, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        const text =
          item.type === "chunk"
            ? item.code
            : typeof item.source === "string"
              ? item.source
              : new TextDecoder().decode(item.source);
        if (DEV_HOSTS.test(text)) {
          this.error(`The production build mentions a dev host in ${fileName}.`);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = targetOf(mode);
  const hosts = HOSTS[target];
  return {
    // Hosts are baked in per target, so a production build carries only production hosts.
    define: {
      __CLEW_API_URL__: JSON.stringify(hosts.apiUrl),
      __CLEW_WEB_ORIGIN__: JSON.stringify(hosts.webOrigin),
    },
    plugins: [manifest(target), ...(target === "production" ? [noDevHosts()] : [])],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "chrome116",
      modulePreload: false,
      sourcemap: false,
      rollupOptions: {
        input: { popup: "popup.html", background: "src/background.ts" },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
    test: {
      environment: "node",
      globals: true,
    },
  };
});
