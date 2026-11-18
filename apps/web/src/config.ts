/** Build-time settings. Everything here ships to the browser, so never put a secret here. */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  /** Clerk publishable key (pk_test_… / pk_live_…). Missing means sign-in isn't set up yet. */
  clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "",
  /** The Clew Chrome extension's id, pinned by the "key" in apps/extension/manifest.config.ts. */
  extensionId: import.meta.env.VITE_CLEW_EXTENSION_ID || "bknomgnbnlknofhndoodlaboaomlhben",
};
