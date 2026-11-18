/**
 * The toolbar popup: who the extension is signed in as, which profile version is current, and
 * a way to sign out. It asks the service worker; it never sees the token. Text is set with
 * textContent only.
 */

import { config } from "./config";
import type { Status } from "./messages";

type Elements = {
  status: HTMLElement;
  facts: HTMLElement;
  email: HTMLElement;
  profile: HTMLElement;
  hint: HTMLElement;
  signOut: HTMLButtonElement;
};

export type Ask = (message: unknown) => Promise<unknown>;

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

export async function start(doc: Document, ask: Ask): Promise<void> {
  const elements = find(doc);
  const refresh = async () => render(elements, (await ask({ type: "clew/status" })) as Status);
  elements.signOut.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    elements.signOut.disabled = true;
    void ask({ type: "clew/sign-out" })
      .then(refresh)
      .finally(() => {
        elements.signOut.disabled = false;
      });
  });
  await refresh();
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  void start(document, (message) => chrome.runtime.sendMessage(message));
}
