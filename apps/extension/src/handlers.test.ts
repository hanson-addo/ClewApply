import { browserLabel, handleExternal, handlePopup, type Deps } from "./handlers";
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

function deps(store = memoryStore()): Deps & { store: ReturnType<typeof memoryStore> } {
  return { apiUrl: API, webOrigin: WEB, extensionId: ID, store, label: () => "Chrome on macOS" };
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

it("labels the browser by platform", () => {
  expect(browserLabel({ userAgentData: { platform: "macOS" } })).toBe("Chrome on macOS");
  expect(browserLabel({})).toBe("Chrome");
});
