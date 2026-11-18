/**
 * The toolbar popup: who the extension is signed in as, which profile version is current, a
 * way to sign out, and the LinkedIn switch and Fill button. It asks the service worker for
 * anything that needs the token; it never sees the token. Text is set with textContent only.
 *
 * Site permissions are asked for here because Chrome only shows its prompt after a click on
 * one of the extension's own pages.
 */

import { config } from "./config";
import type { FillTabResult, Status } from "./messages";
import { SITES, siteForUrl, type Site } from "./sites";

type Elements = {
  status: HTMLElement;
  facts: HTMLElement;
  email: HTMLElement;
  profile: HTMLElement;
  hint: HTMLElement;
  signOut: HTMLButtonElement;
  site: HTMLElement;
  siteText: HTMLElement;
  siteFill: HTMLButtonElement;
  siteOn: HTMLButtonElement;
  siteOff: HTMLButtonElement;
  siteResult: HTMLElement;
};

export type Ask = (message: unknown) => Promise<unknown>;

/** The Chrome calls the popup makes itself, so tests can fake them. */
export type PopupBrowser = {
  activeTab(): Promise<{ id?: number; url?: string } | undefined>;
  hasPermission(origin: string): Promise<boolean>;
  request(origin: string): Promise<boolean>;
  remove(origin: string): Promise<boolean>;
};

const SITE: Site = SITES.linkedin;

function find(doc: Document): Elements {
  const get = (id: string) => {
    const element = doc.getElementById(id);
    if (!element) throw new Error(`popup.html is missing #${id}`);
    return element;
  };
  return {
    status: get("status"),
    facts: get("facts"),
    email: get("email"),
    profile: get("profile"),
    hint: get("hint"),
    signOut: get("sign-out") as HTMLButtonElement,
    site: get("site"),
    siteText: get("site-text"),
    siteFill: get("site-fill") as HTMLButtonElement,
    siteOn: get("site-on") as HTMLButtonElement,
    siteOff: get("site-off") as HTMLButtonElement,
    siteResult: get("site-result"),
  };
}

export function profileLine(version: number | null, savedAt: string | null, locale?: string): string {
  if (version === null || savedAt === null) return "Not saved yet";
  const when = new Date(savedAt).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Version ${version}, saved ${when}`;
}

export function render(elements: Elements, status: Status): void {
  const signedIn = status.state === "signed-in";
  elements.facts.hidden = !signedIn;
  elements.signOut.hidden = !signedIn;
  elements.site.hidden = !signedIn;
  elements.hint.hidden = signedIn;
  if (status.state === "signed-in") {
    elements.status.textContent = "Connected to Clew.";
    elements.email.textContent = status.email;
    elements.profile.textContent = profileLine(status.profileVersion, status.profileSavedAt);
  } else if (status.state === "signed-out") {
    elements.status.textContent = "Not connected.";
    elements.hint.textContent = `To connect, open Clew (${new URL(config.webOrigin).host}), then Settings, then Browser extension, and press Connect.`;
  } else {
    elements.status.textContent = "Clew can't be reached right now.";
    elements.hint.textContent = "Check your connection, then open this again.";
  }
}

export type SiteState = { on: boolean; tabId: number | null };

export function renderSite(elements: Elements, state: SiteState): void {
  elements.siteOn.hidden = state.on;
  elements.siteOff.hidden = !state.on;
  elements.siteFill.hidden = !state.on || state.tabId === null;
  if (!state.on) {
    elements.siteText.textContent = `Turn this on to fill your ${SITE.name} profile from Clew. Chrome asks you first, and Clew can only use ${SITE.name}.`;
  } else if (state.tabId === null) {
    elements.siteText.textContent = `On. Open your ${SITE.name} profile, press a pencil (or Add) to edit a section, then open Clew here and press Fill.`;
  } else {
    elements.siteText.textContent = `On. Open the section you want to edit, then press Fill. You check the fields and press Save on ${SITE.name}.`;
  }
}

const FILL_ERRORS: Record<Exclude<FillTabResult, { ok: true }>["error"], string> = {
  "signed-out": "Connect the extension to Clew first.",
  "wrong-page": `Open your ${SITE.name} profile in this tab first.`,
  "not-turned-on": `Turn on ${SITE.name} first.`,
  "no-profile": "Save your profile in Clew first.",
  unavailable: "Clew can't be reached right now.",
};

export function fillMessage(result: FillTabResult): string {
  return result.ok ? "The Clew panel is open on the page." : FILL_ERRORS[result.error];
}

async function siteState(browser: PopupBrowser): Promise<SiteState> {
  const on = await browser.hasPermission(SITE.origin);
  if (!on) return { on, tabId: null };
  // Chrome tells the extension a tab's address only for sites the user turned on.
  const tab = await browser.activeTab();
  const onProfile = siteForUrl(tab?.url)?.id === SITE.id && typeof tab?.id === "number";
  return { on, tabId: onProfile ? (tab?.id ?? null) : null };
}

export async function start(
  doc: Document,
  ask: Ask,
  browser: PopupBrowser,
  // Overridable in tests, where clicks can't be trusted.
  trusted: (event: Event) => boolean = (event) => event.isTrusted,
): Promise<void> {
  const elements = find(doc);
  let tabId: number | null = null;

  const refreshSite = async () => {
    const state = await siteState(browser);
    tabId = state.tabId;
    renderSite(elements, state);
  };
  const refresh = async () => {
    const status = (await ask({ type: "clew/status" })) as Status;
    render(elements, status);
    if (status.state === "signed-in") await refreshSite();
  };

  // Every action needs a real click: a click a script makes up does nothing.
  const onClick = (button: HTMLButtonElement, act: () => Promise<unknown>) =>
    button.addEventListener("click", (event) => {
      if (!trusted(event)) return;
      button.disabled = true;
      void act().finally(() => {
        button.disabled = false;
      });
    });

  onClick(elements.signOut, () => ask({ type: "clew/sign-out" }).then(refresh));
  onClick(elements.siteOn, async () => {
    elements.siteResult.textContent = "";
    // Chrome shows its own prompt; nothing changes unless the user allows it.
    await browser.request(SITE.origin);
    await refreshSite();
  });
  onClick(elements.siteOff, async () => {
    elements.siteResult.textContent = "";
    await browser.remove(SITE.origin);
    await refreshSite();
  });
  onClick(elements.siteFill, async () => {
    if (tabId === null) return;
    elements.siteResult.textContent = "Opening the Clew panel…";
    const result = (await ask({ type: "clew/fill-tab", tabId })) as FillTabResult;
    elements.siteResult.textContent = fillMessage(result);
  });
  await refresh();
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  void start(document, (message) => chrome.runtime.sendMessage(message), {
    activeTab: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0],
    hasPermission: (origin) => chrome.permissions.contains({ origins: [origin] }),
    request: (origin) => chrome.permissions.request({ origins: [origin] }),
    remove: (origin) => chrome.permissions.remove({ origins: [origin] }),
  });
}
