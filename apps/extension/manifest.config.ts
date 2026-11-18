/**
 * The extension's manifest, built per target. Production names only Clew's real hosts; the
 * development build swaps in localhost. `vite.config.ts` refuses a production build that
 * mentions localhost anywhere (Security #2).
 */

export type Target = "production" | "development";

export type Hosts = {
  /** Where the API lives. The service worker is the only part that calls it. */
  apiUrl: string;
  /** The web app: the only page allowed to message the extension. */
  webOrigin: string;
};

export const HOSTS: Record<Target, Hosts> = {
  production: { apiUrl: "https://api.clewapply.com", webOrigin: "https://app.clewapply.com" },
  development: { apiUrl: "http://localhost:8000", webOrigin: "http://localhost:5173" },
};

export const VERSION = "0.1.0";

/**
 * Public key that pins the extension id to EXTENSION_ID (Security #6), so the API's CORS and
 * the web app can name this one extension. It is a public key, not a secret, and nothing here
 * signs with it. Once the Chrome Web Store listing exists, replace it with the store's key and
 * update EXTENSION_ID, CLEW_EXTENSION_ID and VITE_CLEW_EXTENSION_ID to match.
 */
// A public key, so the secret scanner is told to skip this line.
export const MANIFEST_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnTJwHU21XrzbB9n4umG/mXFWMP23kQXyX62MAeCNjjxoDrepCYYwm+jhQik7mHKg1hK37isbAtTwRbGPChsbjtiOpyZ0ZCNFUJzSq+vuImNct+4n7/Tr8EiUTxXyQCxnI/FqzCN8gPmkyMH16oWP+Da3gNktLy3VmsZMqAdnmsoV0B7XFfA+heL/v2AlEjfr/LOwSPFAkcrdaec/um5vWERufxgyidmoo6Ye+068hYcCZbge9vliaRoTHLyuXwatI7WiOCEbhEdSM8/YFNBrcxZjkbHUnfgYUS1DJwbgzNGY57v+xr4KN7ylsFCLt+VNEI8rzAh2ydgYjpDIpwSmqQIDAQAB"; // gitleaks:allow

export const EXTENSION_ID = "bknomgnbnlknofhndoodlaboaomlhben";

export function buildManifest(target: Target) {
  const hosts = HOSTS[target];
  return {
    manifest_version: 3,
    name: target === "production" ? "Clew" : "Clew (dev)",
    description: "Fill your job-site profiles from your Clew profile. You check and save.",
    version: VERSION,
    key: MANIFEST_KEY,
    minimum_chrome_version: "116",
    action: { default_popup: "popup.html", default_title: "Clew" },
    background: { service_worker: "background.js", type: "module" },
    // Step 1 needs storage and the API, nothing else: no cookies, tabs, history or all-sites
    // access. Job-site hosts arrive in step 3 as optional permissions, asked for one at a time.
    permissions: ["storage"],
    host_permissions: [`${hosts.apiUrl}/*`],
    externally_connectable: { matches: [`${hosts.webOrigin}/*`] },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
}
