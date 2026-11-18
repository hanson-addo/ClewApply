/**
 * What the service worker does with each message. Kept apart from `background.ts` (which only
 * wires these to Chrome's events) so tests can call them with a fake store and fetch.
 */

import { createApiClient } from "./api/client";
import { isLinkMessage, isPopupMessage, type LinkResult, type Status } from "./messages";
import type { TokenStore } from "./tokenStore";

export type Deps = {
  apiUrl: string;
  /** The web app's origin: the only sender allowed to hand over a link code. */
  webOrigin: string;
  /** This extension's own id, to tell its popup from anything else. */
  extensionId: string;
  store: TokenStore;
  /** Which browser this is, shown in the web app's Settings, e.g. "Chrome on macOS". */
  label: () => string;
};

/**
 * A message from a web page. Chrome only delivers those from pages the manifest's
 * `externally_connectable` lists; the origin is checked here too (Security #1).
 */
export async function handleExternal(
  deps: Deps,
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<LinkResult | null> {
  if (sender.origin !== deps.webOrigin) return null;
  if (!isLinkMessage(message)) return null;
  try {
    // The code goes in the request body only, never in a URL.
    const { data, response } = await createApiClient(deps.apiUrl).POST("/extension/token", {
      body: { code: message.code, label: deps.label() },
    });
    if (data) {
      await deps.store.set(data.token);
      return { ok: true };
    }
    return { ok: false, error: response.status === 400 ? "expired" : "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** True when the sender is one of this extension's own pages (the popup), not a content script. */
export function isOwnPage(deps: Deps, sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === deps.extensionId &&
    typeof sender.url === "string" &&
    sender.url.startsWith(`chrome-extension://${deps.extensionId}/`)
  );
}

export async function handlePopup(
  deps: Deps,
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<Status | { ok: true } | null> {
  if (!isOwnPage(deps, sender) || !isPopupMessage(message)) return null;
  if (message.type === "clew/sign-out") return signOut(deps);
  return status(deps);
}

async function status(deps: Deps): Promise<Status> {
  const token = await deps.store.get();
  if (!token) return { state: "signed-out" };
  try {
    const { data, response } = await createApiClient(deps.apiUrl, token).GET("/extension/me");
    if (data) {
      return {
        state: "signed-in",
        email: data.email,
        profileVersion: data.profile_version,
        profileSavedAt: data.profile_saved_at,
      };
    }
    if (response.status === 401) {
      // Disconnected in Settings, signed out of Clew, or expired.
      await deps.store.clear();
      return { state: "signed-out" };
    }
    return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

async function signOut(deps: Deps): Promise<{ ok: true }> {
  const token = await deps.store.get();
  // Forget the token first, so the extension is signed out even if Clew can't be reached.
  await deps.store.clear();
  if (token) {
    try {
      await createApiClient(deps.apiUrl, token).POST("/extension/sign-out");
    } catch {
      // Offline: the token stays valid on the server until it expires or is disconnected in
      // Settings, but this browser no longer has it.
    }
  }
  return { ok: true };
}

type UserAgentData = { platform?: string };

/** "Chrome on macOS", from the browser's own platform hint. */
export function browserLabel(
  nav: { userAgentData?: UserAgentData } = navigator as { userAgentData?: UserAgentData },
): string {
  const platform = nav.userAgentData?.platform?.trim();
  return platform ? `Chrome on ${platform}`.slice(0, 80) : "Chrome";
}
