import { browserLabel, handleContent, handleExternal, handlePopup, type BrowserApi, type Deps } from "./handlers";
import type { TokenStore } from "./tokenStore";

const ID = "bknomgnbnlknofhndoodlaboaomlhben";
const WEB = "https://app.clewapply.com";
const API = "https://api.clewapply.com";
const CODE = `clk_${"a".repeat(43)}`;
const TOKEN = `clx_${"b".repeat(43)}`;
const POPUP = { id: ID, url: `chrome-extension://${ID}/popup.html` };

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async set(token) {
      this.value = token;
    },
    async clear() {
      this.value = null;
    },
  };
}

const PROFILE_TAB = "https://www.linkedin.com/in/riley-testperson/";

type FakeBrowser = BrowserApi & { url: string | undefined; granted: boolean; injected: string[]; sent: unknown[] };

function fakeBrowser(): FakeBrowser {
  return {
    url: PROFILE_TAB,
    granted: true,
    injected: [],
    sent: [],
    async tabUrl() {
      return this.url;
    },
    async hasPermission(origin) {
      return this.granted && origin === "https://www.linkedin.com/*";
    },
    async inject(_, file) {
      this.injected.push(file);
    },
    async sendToTab(_, message) {
      this.sent.push(message);
    },
  };
}

function deps(
  store = memoryStore(),
  browser = fakeBrowser(),
): Deps & { store: ReturnType<typeof memoryStore>; browser: FakeBrowser } {
  return { apiUrl: API, webOrigin: WEB, extensionId: ID, store, label: () => "Chrome on macOS", browser };
}

const fetchMock = vi.fn<(request: Request) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function sentRequest(): Request {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("nothing was sent");
  return call[0];
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("link code from the web app", () => {
  it("trades the code for a token and keeps it", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { token: TOKEN, expires_at: "2026-12-18T00:00:00Z" }));
    const d = deps();

    expect(await handleExternal(d, { type: "clew/link", code: CODE }, { origin: WEB })).toEqual({ ok: true });

    const request = sentRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${API}/extension/token`);
    // The code travels in the body only.
    expect(request.url).not.toContain(CODE);
    expect(await request.json()).toEqual({ code: CODE, label: "Chrome on macOS" });
    expect(request.headers.get("Authorization")).toBeNull();
    expect(d.store.value).toBe(TOKEN);
  });

  it.each([
    ["another site", { origin: "https://evil.example" }],
    ["a look-alike", { origin: "https://app.clewapply.com.evil.example" }],
    ["no origin", {}],
  ])("ignores %s (Security #1)", async (_, sender) => {
    const d = deps();
    expect(await handleExternal(d, { type: "clew/link", code: CODE }, sender)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, "clk_x", { type: "clew/link" }, { type: "clew/link", code: "not a code" }, { type: "other" }])(
    "ignores a malformed message: %j",
    async (message) => {
      expect(await handleExternal(deps(), message, { origin: WEB })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("reports an expired code", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { detail: "expired" }));
    const d = deps();
    expect(await handleExternal(d, { type: "clew/link", code: CODE }, { origin: WEB })).toEqual({
      ok: false,
      error: "expired",
    });
    expect(d.store.value).toBeNull();
  });

  it("reports Clew being unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await handleExternal(deps(), { type: "clew/link", code: CODE }, { origin: WEB })).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});

describe("popup", () => {
  it("answers only the extension's own pages", async () => {
    const d = deps(memoryStore(TOKEN));
    for (const sender of [
      { id: "someotherextensionidaaaaaaaaaaaa", url: `chrome-extension://someother/popup.html` },
      { id: ID, url: "https://www.linkedin.com/in/me/edit" },
      { id: ID },
      {},
    ]) {
      expect(await handlePopup(d, { type: "clew/status" }, sender)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is signed out without a token", async () => {
    expect(await handlePopup(deps(), { type: "clew/status" }, POPUP)).toEqual({ state: "signed-out" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows who is signed in and the profile version", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { email: "riley@example.test", profile_version: 3, profile_saved_at: "2026-11-18T14:04:00Z" }),
    );
    const status = await handlePopup(deps(memoryStore(TOKEN)), { type: "clew/status" }, POPUP);
    expect(status).toEqual({
      state: "signed-in",
      email: "riley@example.test",
      profileVersion: 3,
      profileSavedAt: "2026-11-18T14:04:00Z",
    });
    const request = sentRequest();
    expect(request.url).toBe(`${API}/extension/me`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("forgets a token Clew no longer accepts", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { detail: "gone" }));
    const d = deps(memoryStore(TOKEN));
    expect(await handlePopup(d, { type: "clew/status" }, POPUP)).toEqual({ state: "signed-out" });
    expect(d.store.value).toBeNull();
  });

  it("keeps the token when Clew is down", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { detail: "down" }));
    const d = deps(memoryStore(TOKEN));
    expect(await handlePopup(d, { type: "clew/status" }, POPUP)).toEqual({ state: "unavailable" });
    expect(d.store.value).toBe(TOKEN);
  });

  it("signs out: forgets the token and revokes it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const d = deps(memoryStore(TOKEN));
    expect(await handlePopup(d, { type: "clew/sign-out" }, POPUP)).toEqual({ ok: true });
    expect(d.store.value).toBeNull();
    const request = sentRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${API}/extension/sign-out`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("signs out even when offline", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const d = deps(memoryStore(TOKEN));
    expect(await handlePopup(d, { type: "clew/sign-out" }, POPUP)).toEqual({ ok: true });
    expect(d.store.value).toBeNull();
  });
});

describe("fill from the popup", () => {
  const FIELDS = [{ key: "headline", label: "Headline", value: "Thread Analyst", behind: true }];
  const fill = { type: "clew/fill-tab", tabId: 7 };

  it("fetches the values, injects the site's panel and hands them over", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { site: "linkedin", profile_version: 4, fields: FIELDS }));
    const d = deps(memoryStore(TOKEN));

    expect(await handlePopup(d, fill, POPUP)).toEqual({ ok: true });

    const request = sentRequest();
    expect(request.url).toBe(`${API}/sync/fields/linkedin`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(d.browser.injected).toEqual(["content/linkedin.js"]);
    // The panel gets values only, never the token.
    expect(d.browser.sent).toEqual([{ type: "clew/fields", site: "linkedin", profileVersion: 4, fields: FIELDS }]);
    expect(JSON.stringify(d.browser.sent)).not.toContain(TOKEN);
  });

  it.each([
    ["a LinkedIn page that isn't a profile", "https://www.linkedin.com/feed/"],
    ["another site", "https://www.example.test/in/riley/"],
    ["a look-alike host", "https://www.linkedin.com.evil.example/in/riley/"],
    ["plain http", "http://www.linkedin.com/in/riley/"],
    ["a tab Chrome won't name", undefined],
  ])("refuses %s", async (_, url) => {
    const d = deps(memoryStore(TOKEN));
    d.browser.url = url;
    expect(await handlePopup(d, fill, POPUP)).toEqual({ ok: false, error: "wrong-page" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d.browser.injected).toEqual([]);
  });

  it("needs LinkedIn turned on", async () => {
    const d = deps(memoryStore(TOKEN));
    d.browser.granted = false;
    expect(await handlePopup(d, fill, POPUP)).toEqual({ ok: false, error: "not-turned-on" });
    expect(d.browser.injected).toEqual([]);
  });

  it("needs a token, and forgets one Clew refuses", async () => {
    expect(await handlePopup(deps(), fill, POPUP)).toEqual({ ok: false, error: "signed-out" });
    fetchMock.mockResolvedValueOnce(json(401, { detail: "gone" }));
    const d = deps(memoryStore(TOKEN));
    expect(await handlePopup(d, fill, POPUP)).toEqual({ ok: false, error: "signed-out" });
    expect(d.store.value).toBeNull();
    expect(d.browser.injected).toEqual([]);
  });

  it("needs a saved profile", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { site: "linkedin", profile_version: null, fields: [] }));
    const d = deps(memoryStore(TOKEN));
    expect(await handlePopup(d, fill, POPUP)).toEqual({ ok: false, error: "no-profile" });
    expect(d.browser.injected).toEqual([]);
  });

  it("says when Clew is down", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { detail: "down" }));
    expect(await handlePopup(deps(memoryStore(TOKEN)), fill, POPUP)).toEqual({ ok: false, error: "unavailable" });
  });

  it("isn't something a content script can ask for", async () => {
    const sender = { id: ID, url: PROFILE_TAB, tab: { id: 7, url: PROFILE_TAB } };
    expect(await handlePopup(deps(memoryStore(TOKEN)), fill, sender)).toBeNull();
    expect(await handleContent(deps(memoryStore(TOKEN)), fill, sender)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fill report from the panel", () => {
  const PANEL = { id: ID, url: `${PROFILE_TAB}edit/intro/`, tab: { id: 7, url: `${PROFILE_TAB}edit/intro/` } };
  const filled = { type: "clew/filled", site: "linkedin", profileVersion: 4, keys: ["headline", "work.ab12cd34.title"] };

  it("records which keys were filled, never values", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await handleContent(deps(memoryStore(TOKEN)), filled, PANEL)).toEqual({ ok: true });
    const request = sentRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${API}/sync/fills`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(await request.json()).toEqual({
      site: "linkedin",
      profile_version: 4,
      field_keys: ["headline", "work.ab12cd34.title"],
    });
  });

  it.each([
    ["another extension", { ...PANEL, id: "someotherextensionidaaaaaaaaaaaa" }],
    ["a page that isn't a LinkedIn profile", { id: ID, url: "https://www.linkedin.com/feed/", tab: { url: "https://www.linkedin.com/feed/" } }],
    ["another site", { id: ID, url: "https://www.example.test/in/x/", tab: { url: "https://www.example.test/in/x/" } }],
    ["no tab", { id: ID, url: PANEL.url }],
  ])("ignores %s", async (_, sender) => {
    expect(await handleContent(deps(memoryStore(TOKEN)), filled, sender)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...filled, keys: [] },
    { ...filled, keys: ["has space"] },
    { ...filled, keys: ["x".repeat(65)] },
    { ...filled, site: "indeed" },
    { ...filled, profileVersion: "4" },
    { ...filled, type: "clew/status" },
  ])("ignores a malformed report: %j", async (message) => {
    expect(await handleContent(deps(memoryStore(TOKEN)), message, PANEL)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("labels the browser by platform", () => {
  expect(browserLabel({ userAgentData: { platform: "macOS" } })).toBe("Chrome on macOS");
  expect(browserLabel({})).toBe("Chrome");
});
