/**
 * The toolbar popup: who the extension is signed in as, which profile version is current, a
 * way to sign out, and each job site's switch and Fill button. It asks the service worker for
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
  sites: HTMLElement;
};

/** One site's switch and Fill button. */
type SiteElements = {
  text: HTMLElement;
  fill: HTMLButtonElement;
  on: HTMLButtonElement;
  off: HTMLButtonElement;
  result: HTMLElement;
};

export type Ask = (message: unknown) => Promise<unknown>;

/** The Chrome calls the popup makes itself, so tests can fake them. */
export type PopupBrowser = {
  activeTab(): Promise<{ id?: number; url?: string } | undefined>;
  hasPermission(origin: string): Promise<boolean>;
  request(origin: string): Promise<boolean>;
  remove(origin: string): Promise<boolean>;
};

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
    sites: get("sites"),
  };
}

/** Builds a site's section (text set with textContent only) and adds it to the list. */
function siteSection(doc: Document, parent: HTMLElement, site: Site): SiteElements {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
    const element = doc.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  const button = (className: string, text: string) => {
    const element = make("button", className, text);
    element.type = "button";
    element.hidden = true;
    return element;
  };
  const section = make("section", "popup-site");
  section.dataset.site = site.id;
  const heading = make("h2", "popup-site-name", site.name);
  heading.id = `site-name-${site.id}`;
  section.setAttribute("aria-labelledby", heading.id);
  const elements: SiteElements = {
    text: make("p", "popup-hint"),
    fill: button("popup-button popup-button-primary", `Fill this ${site.name} form`),
    on: button("popup-button", `Turn on ${site.name}`),
    result: make("p", "popup-result"),
    off: button("popup-link", `Turn off ${site.name}`),
  };
  elements.result.setAttribute("role", "status");
  section.append(heading, elements.text, elements.fill, elements.on, elements.result, elements.off);
  parent.append(section);
  return elements;
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
  elements.sites.hidden = !signedIn;
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

export function renderSite(elements: SiteElements, site: Site, state: SiteState): void {
  elements.on.hidden = state.on;
  elements.off.hidden = !state.on;
  elements.fill.hidden = !state.on || state.tabId === null;
  if (!state.on) {
    elements.text.textContent = `Turn this on to fill your ${site.name} profile from Clew. Chrome asks you first, and Clew can only use ${site.name}.`;
  } else if (state.tabId === null) {
    elements.text.textContent = `On. Open your ${site.name} profile, press a pencil (or Add) to edit a section, then open Clew here and press Fill.`;
  } else {
    elements.text.textContent = `On. Open the section you want to edit, then press Fill. You check the fields and press Save on ${site.name}.`;
  }
}

export function fillMessage(result: FillTabResult, site: Site): string {
  if (result.ok) return "The Clew panel is open on the page.";
  const errors: Record<typeof result.error, string> = {
    "signed-out": "Connect the extension to Clew first.",
    "wrong-page": `Open your ${site.name} profile in this tab first.`,
    "not-turned-on": `Turn on ${site.name} first.`,
    "no-profile": "Save your profile in Clew first.",
    unavailable: "Clew can't be reached right now.",
  };
  return errors[result.error];
}

async function siteState(browser: PopupBrowser, site: Site): Promise<SiteState> {
  const on = await browser.hasPermission(site.origin);
  if (!on) return { on, tabId: null };
  // Chrome tells the extension a tab's address only for sites the user turned on.
  const tab = await browser.activeTab();
  const onProfile = siteForUrl(tab?.url)?.id === site.id && typeof tab?.id === "number";
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

  // Every action needs a real click: a click a script makes up does nothing.
  const onClick = (button: HTMLButtonElement, act: () => Promise<unknown>) =>
    button.addEventListener("click", (event) => {
      if (!trusted(event)) return;
      button.disabled = true;
      void act().finally(() => {
        button.disabled = false;
      });
    });

  const refreshers = Object.values(SITES).map((site) => {
    const parts = siteSection(doc, elements.sites, site);
    let tabId: number | null = null;
    const refreshSite = async () => {
      const state = await siteState(browser, site);
      tabId = state.tabId;
      renderSite(parts, site, state);
    };
    onClick(parts.on, async () => {
      parts.result.textContent = "";
      // Chrome shows its own prompt; nothing changes unless the user allows it.
      await browser.request(site.origin);
      await refreshSite();
    });
    onClick(parts.off, async () => {
      parts.result.textContent = "";
      await browser.remove(site.origin);
      await refreshSite();
    });
    onClick(parts.fill, async () => {
      if (tabId === null) return;
      parts.result.textContent = "Opening the Clew panel…";
      const result = (await ask({ type: "clew/fill-tab", tabId })) as FillTabResult;
      parts.result.textContent = fillMessage(result, site);
    });
    return refreshSite;
  });

  const refresh = async () => {
    const status = (await ask({ type: "clew/status" })) as Status;
    render(elements, status);
    if (status.state === "signed-in") await Promise.all(refreshers.map((r) => r()));
  };

  onClick(elements.signOut, () => ask({ type: "clew/sign-out" }).then(refresh));
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
