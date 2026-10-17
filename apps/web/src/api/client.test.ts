import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "./client";

const fetchMock = vi.fn<(request: Request) => Promise<Response>>();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("createApiClient", () => {
  it("sends no Authorization header without a token source", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(Response.json({ status: "ok", version: "0.1.0" }));
    await createApiClient().GET("/health");
    expect(fetchMock.mock.calls[0]?.[0].headers.has("Authorization")).toBe(false);
  });

  it("asks for a fresh token on every request", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => Response.json({ status: "ok", version: "0.1.0" }));
    const tokens = ["first", "second"];
    const client = createApiClient(async () => tokens.shift() ?? null);
    await client.GET("/health");
    await client.GET("/health");
    expect(fetchMock.mock.calls.map(([r]) => r.headers.get("Authorization"))).toEqual([
      "Bearer first",
      "Bearer second",
    ]);
  });

  it("skips the header when signed out", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(Response.json({ status: "ok", version: "0.1.0" }));
    await createApiClient(async () => null).GET("/health");
    expect(fetchMock.mock.calls[0]?.[0].headers.has("Authorization")).toBe(false);
  });
});
