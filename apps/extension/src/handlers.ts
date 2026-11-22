/**
 * What the service worker does with each message. Kept apart from `background.ts` (which only
 * wires these to Chrome's events) so tests can call them with a fake store and fetch.
 */

import { createApiClient } from "./api/client";
import {
  isFilledMessage,
  isLinkMessage,
  isPopupMessage,
  type FieldsMessage,
  type FillTabResult,
  type LinkResult,
  type Status,
} from "./messages";
import { siteForUrl } from "./sites";
import type { TokenStore } from "./tokenStore";

/** The tab and scripting calls the fill flow makes, so tests can fake them. */
export type BrowserApi = {
  /** The tab's address; Chrome gives it only for sites the user turned on. */
  tabUrl(tabId: number): Promise<string | undefined>;
  hasPermission(origin: string): Promise<boolean>;
  /** Injects the file; returns the id of the document it ran in, if Chrome says. */
  inject(tabId: number, file: string): Promise<string | undefined>;
  /** Sends only to that document, so a page the tab moved on to never gets the values. */
  sendToTab(tabId: number, message: FieldsMessage, documentId: string | undefined): Promise<void>;
};

export type Deps = {
  apiUrl: string;
  /** The web app's origin: the only sender allowed to hand over a link code. */
  webOrigin: string;
  /** This extension's own id, to tell its popup from anything else. */
  extensionId: string;
  store: TokenStore;
  /** Which browser this is, shown in the web app's Settings, e.g. "Chrome on macOS". */
  label: () => string;
  browser: BrowserApi;
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
): Promise<Status | FillTabResult | null> {
  if (!isOwnPage(deps, sender) || !isPopupMessage(message)) return null;
  if (message.type === "clew/sign-out") return signOut(deps);
  if (message.type === "clew/fill-tab") return fillTab(deps, message.tabId);
  return status(deps);
}

/**
 * The user pressed Fill in the popup: check the tab is a supported site's profile page that the
 * user turned on, fetch the values, then inject that site's fill panel and hand it the values.
 * The panel never sees the token and never calls the API.
 */
async function fillTab(deps: Deps, tabId: number): Promise<FillTabResult> {
  const token = await deps.store.get();
  if (!token) return { ok: false, error: "signed-out" };
  try {
    const site = siteForUrl(await deps.browser.tabUrl(tabId));
    if (!site) return { ok: false, error: "wrong-page" };
    if (!(await deps.browser.hasPermission(site.origin))) return { ok: false, error: "not-turned-on" };
    const { data, response } = await createApiClient(deps.apiUrl, token).GET("/sync/fields/{site}", {
      params: { path: { site: site.id } },
    });
    if (response.status === 401) {
      await deps.store.clear();
      return { ok: false, error: "signed-out" };
    }
    if (!data) return { ok: false, error: "unavailable" };
    if (data.profile_version === null) return { ok: false, error: "no-profile" };
    const documentId = await deps.browser.inject(tabId, site.script);
    await deps.browser.sendToTab(
      tabId,
      { type: "clew/fields", site: site.id, profileVersion: data.profile_version, fields: data.fields },
      documentId,
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * A message from a fill panel: which fields the user filled. Accepted only from this
 * extension's own content script, running on that site's profile page.
 */
export async function handleContent(
  deps: Deps,
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean } | null> {
  if (sender.id !== deps.extensionId || !isFilledMessage(message)) return null;
  const fromSite = (url: string | undefined) => siteForUrl(url)?.id === message.site;
  if (!fromSite(sender.url) || !fromSite(sender.tab?.url)) return null;
  const token = await deps.store.get();
  if (!token) return { ok: false };
  try {
    const { response } = await createApiClient(deps.apiUrl, token).POST("/sync/fills", {
      body: { site: message.site, profile_version: message.profileVersion, field_keys: message.keys },
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
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
