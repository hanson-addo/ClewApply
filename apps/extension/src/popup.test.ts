// @vitest-environment jsdom
import { fillMessage, profileLine, start, type PopupBrowser } from "./popup";
import { SITES } from "./sites";

const HTML = `
  <p id="status"></p>
  <dl id="facts" hidden><dd id="email"></dd><dd id="profile"></dd></dl>
  <div id="sites" hidden></div>
  <p id="hint" hidden></p>
  <button id="sign-out" hidden>Sign out of the extension</button>`;

const SIGNED_IN = { state: "signed-in", email: "a@example.test", profileVersion: 2, profileSavedAt: "2026-11-18T14:04:00Z" };

function fakeBrowser(granted = false, url = "https://www.linkedin.com/in/riley-testperson/") {
  const browser = {
    granted,
    url,
    // Only LinkedIn is turned on in these tests; Chrome names the tab only for a site that is.
    activeTab: vi.fn(async () => ({ id: 7, url: browser.granted ? browser.url : undefined })),
    hasPermission: vi.fn(async (origin: string) => browser.granted && origin === SITES.linkedin.origin),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  };
  return browser satisfies PopupBrowser & { granted: boolean; url: string };
}

/** jsdom can't make trusted events, so a click marked "real" stands in for the user's. */
const REAL = "clew-test-real";
const trusted = (event: Event) => event instanceof CustomEvent && event.detail === REAL;

function realClick(element: HTMLElement): void {
  element.dispatchEvent(new CustomEvent("click", { bubbles: true, detail: REAL }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  document.body.append(document.createRange().createContextualFragment(HTML));
});

/** A button or line in one site's section, by its text or class. */
function inSite(site: string, find: { button?: RegExp; className?: string }): HTMLElement {
  const section = document.querySelector(`[data-site="${site}"]`);
  if (!section) throw new Error(`no section for ${site}`);
  const element = find.button
    ? [...section.querySelectorAll("button")].find((b) => find.button?.test(b.textContent ?? ""))
    : section.querySelector(`.${find.className}`);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${String(find.button ?? find.className)} in ${site}`);
  return element;
}

const linkedIn = {
  on: () => inSite("linkedin", { button: /^Turn on/ }),
  off: () => inSite("linkedin", { button: /^Turn off/ }),
  fill: () => inSite("linkedin", { button: /^Fill/ }),
  text: () => inSite("linkedin", { className: "popup-hint" }),
  result: () => inSite("linkedin", { className: "popup-result" }),
};

function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

it("shows the signed-in email and profile version as text", async () => {
  const ask = vi.fn(async () => ({
    state: "signed-in",
    email: "<b>riley</b>@example.test",
    profileVersion: 3,
    profileSavedAt: "2026-11-18T14:04:00Z",
  }));
  await start(document, ask, fakeBrowser());
  expect($("status").textContent).toBe("Connected to Clew.");
  expect($("email").textContent).toBe("<b>riley</b>@example.test");
  expect($("email").children).toHaveLength(0);
  expect($("profile").textContent).toMatch(/^Version 3, saved /);
  expect($("sign-out").hidden).toBe(false);
  expect($("hint").hidden).toBe(true);
});

it("explains how to connect when signed out", async () => {
  await start(document, async () => ({ state: "signed-out" }), fakeBrowser());
  expect($("status").textContent).toBe("Not connected.");
  expect($("hint").textContent).toContain("Settings, then Browser extension");
  expect($("hint").textContent).toContain("app.clewapply.com");
  expect($("sign-out").hidden).toBe(true);
  expect($("facts").hidden).toBe(true);
});

it("says when Clew can't be reached", async () => {
  await start(document, async () => ({ state: "unavailable" }), fakeBrowser());
  expect($("status").textContent).toBe("Clew can't be reached right now.");
});

it("ignores a sign-out click a script made up", async () => {
  const ask = vi.fn(async () => ({ state: "signed-in", email: "a@example.test", profileVersion: null, profileSavedAt: null }));
  await start(document, ask, fakeBrowser());
  $("sign-out").dispatchEvent(new MouseEvent("click"));
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask).not.toHaveBeenCalledWith({ type: "clew/sign-out" });
});

it("says when the profile hasn't been saved", () => {
  expect(profileLine(null, null)).toBe("Not saved yet");
  expect(profileLine(2, "2026-11-18T14:04:00Z", "en-US")).toMatch(/^Version 2, saved Nov 18, \d/);
});

describe("LinkedIn", () => {
  it("is hidden until signed in", async () => {
    await start(document, async () => ({ state: "signed-out" }), fakeBrowser(), trusted);
    expect($("sites").hidden).toBe(true);
  });

  it("offers to turn LinkedIn on, and asks Chrome only on a real click", async () => {
    const browser = fakeBrowser(false);
    await start(document, async () => SIGNED_IN, browser, trusted);
    expect($("sites").hidden).toBe(false);
    expect(linkedIn.on().hidden).toBe(false);
    expect(linkedIn.fill().hidden).toBe(true);
    expect(linkedIn.text().textContent).toContain("Chrome asks you first");

    linkedIn.on().dispatchEvent(new MouseEvent("click"));
    expect(browser.request).not.toHaveBeenCalled();

    browser.request.mockImplementation(async () => {
      browser.granted = true;
      return true;
    });
    realClick(linkedIn.on());
    await settle();
    expect(browser.request).toHaveBeenCalledWith("https://www.linkedin.com/*");
    expect(linkedIn.on().hidden).toBe(true);
    expect(linkedIn.fill().hidden).toBe(false);
  });

  it("offers Fill only on a LinkedIn profile tab", async () => {
    await start(document, async () => SIGNED_IN, fakeBrowser(true, "https://www.linkedin.com/feed/"), trusted);
    expect(linkedIn.fill().hidden).toBe(true);
    expect(linkedIn.off().hidden).toBe(false);
    expect(linkedIn.text().textContent).toContain("press a pencil");
  });

  it("asks the service worker to open the panel on this tab", async () => {
    const ask = vi.fn(async (message: unknown) =>
      (message as { type: string }).type === "clew/fill-tab" ? { ok: true } : SIGNED_IN,
    );
    await start(document, ask, fakeBrowser(true), trusted);
    linkedIn.fill().dispatchEvent(new MouseEvent("click"));
    expect(ask).not.toHaveBeenCalledWith({ type: "clew/fill-tab", tabId: 7 });
    realClick(linkedIn.fill());
    await settle();
    expect(ask).toHaveBeenCalledWith({ type: "clew/fill-tab", tabId: 7 });
    expect(linkedIn.result().textContent).toBe("The Clew panel is open on the page.");
  });

  it("turns LinkedIn off", async () => {
    const browser = fakeBrowser(true);
    browser.remove.mockImplementation(async () => {
      browser.granted = false;
      return true;
    });
    await start(document, async () => SIGNED_IN, browser, trusted);
    realClick(linkedIn.off());
    await settle();
    expect(browser.remove).toHaveBeenCalledWith("https://www.linkedin.com/*");
    expect(linkedIn.on().hidden).toBe(false);
  });

  it("explains each fill problem", () => {
    expect(fillMessage({ ok: false, error: "no-profile" }, SITES.linkedin)).toBe("Save your profile in Clew first.");
    expect(fillMessage({ ok: false, error: "not-turned-on" }, SITES.linkedin)).toBe("Turn on LinkedIn first.");
    expect(fillMessage({ ok: false, error: "wrong-page" }, SITES.indeed)).toContain("Indeed profile");
  });
});

describe("Indeed", () => {
  it("has its own switch, off until the user turns it on", async () => {
    const browser = fakeBrowser(true);
    await start(document, async () => SIGNED_IN, browser, trusted);
    const on = inSite("indeed", { button: /^Turn on Indeed$/ });
    expect(on.hidden).toBe(false);
    expect(inSite("indeed", { button: /^Fill/ }).hidden).toBe(true);

    browser.request.mockImplementation(async () => true);
    realClick(on);
    await settle();
    expect(browser.request).toHaveBeenCalledWith("https://profile.indeed.com/*");
    expect(browser.request).not.toHaveBeenCalledWith("https://www.linkedin.com/*");
  });
});
