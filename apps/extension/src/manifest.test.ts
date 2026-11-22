import { buildManifest, EXTENSION_ID, MANIFEST_KEY } from "../manifest.config";
import { noDevHosts } from "../vite.config";
import { contentGuard } from "../vite.content.config";

describe("production manifest", () => {
  const manifest = buildManifest("production");

  it("asks for storage, scripting and the Clew API only", () => {
    expect(manifest.permissions).toEqual(["storage", "scripting"]);
    expect(manifest.host_permissions).toEqual(["https://api.clewapply.com/*"]);
    expect(manifest).not.toHaveProperty("optional_permissions");
    // Nothing runs on a job site until the user presses Fill.
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("asks for job sites only when the user turns one on, never all sites (Security #10)", () => {
    expect(manifest.optional_host_permissions).toEqual(["https://www.linkedin.com/*", "https://profile.indeed.com/*"]);
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|\*:\/\/\*\//);
  });

  it("lets only the Clew web app message the extension", () => {
    expect(manifest.externally_connectable).toEqual({ matches: ["https://app.clewapply.com/*"] });
  });

  it("has no dev host anywhere (Security #2)", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("allows only the extension's own scripts", () => {
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });
});

it("the development manifest points at localhost", () => {
  const manifest = buildManifest("development");
  expect(manifest.host_permissions).toEqual(["http://localhost:8000/*"]);
  expect(manifest.externally_connectable.matches).toEqual(["http://localhost:5173/*"]);
});

it("the key pins the extension id (Security #6)", async () => {
  const der = Uint8Array.from(atob(MANIFEST_KEY), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = Array.from(hex, (c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
  expect(id).toBe(EXTENSION_ID);
});

describe("the production build check", () => {
  type Bundle = Record<string, { type: "chunk"; code: string } | { type: "asset"; source: string | Uint8Array }>;

  function check(bundle: Bundle) {
    const plugin = noDevHosts();
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });
    const hook = plugin.writeBundle as unknown as (this: unknown, options: unknown, bundle: Bundle) => void;
    hook.call({ error }, {}, bundle);
  }

  it("fails when a file mentions localhost", () => {
    expect(() => check({ "background.js": { type: "chunk", code: 'fetch("http://localhost:8000/x")' } })).toThrow(
      /dev host in background\.js/,
    );
    expect(() =>
      check({ "manifest.json": { type: "asset", source: new TextEncoder().encode("http://127.0.0.1:5173") } }),
    ).toThrow(/manifest\.json/);
  });

  it("passes production hosts", () => {
    expect(() => check({ "background.js": { type: "chunk", code: 'fetch("https://api.clewapply.com/x")' } })).not.toThrow();
  });
});

describe("the content-script build check (Security #8)", () => {
  type Bundle = Record<string, { type: "chunk"; code: string }>;

  function check(code: string) {
    const plugin = contentGuard(["https://api.clewapply.com"]);
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });
    const hook = plugin.writeBundle as unknown as (this: unknown, options: unknown, bundle: Bundle) => void;
    hook.call({ error }, {}, { "linkedin.js": { type: "chunk", code } });
  }

  it.each([
    "chrome.storage.local.get('x')",
    "const s = chrome['storage']; s.local.get()",
    "fetch('/x')",
    "new XMLHttpRequest()",
    "new WebSocket('wss://x')",
    "const u = 'https://api.clewapply.com/sync'",
  ])("fails when a content script could reach the token or the API: %s", (code) => {
    expect(() => check(code)).toThrow(/linkedin\.js/);
  });

  it("passes a panel that only touches the page and messages the worker", () => {
    expect(() => check("chrome.runtime.sendMessage({type:'clew/filled'}); input.value = 'x';")).not.toThrow();
  });
});
