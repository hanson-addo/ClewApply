import { expect, test } from "@playwright/test";

import { API_URL } from "../playwright.config";

test.describe("API in test mode", () => {
  test("health check is ok and reports a version", async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: expect.any(String) });
  });

  test("readiness check reaches the database", async ({ request }) => {
    const res = await request.get(`${API_URL}/ready`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  test("interactive docs and the schema are hidden outside local", async ({ request }) => {
    for (const path of ["/docs", "/openapi.json", "/redoc"]) {
      const res = await request.get(`${API_URL}${path}`);
      expect(res.status(), path).toBe(404);
    }
  });

  test("CORS allows the web app and nobody else", async ({ request }) => {
    const allowed = await request.get(`${API_URL}/health`, {
      headers: { Origin: "http://localhost:4173" },
    });
    expect(allowed.headers()["access-control-allow-origin"]).toBe("http://localhost:4173");

    const other = await request.get(`${API_URL}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
  });
});
