import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the brand and headline", () => {
    mockFetch(() => new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole("img", { name: "Clew" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/one job feed/i);
    expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  });

  it("says the service is up when the health check passes", async () => {
    mockFetch(async () =>
      Response.json({ status: "ok", version: "0.1.0" }, { status: 200 }),
    );
    render(<App />);
    expect(await screen.findByText("Clew service is up")).toBeInTheDocument();
  });

  it("says the service is unreachable when the request fails", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<App />);
    expect(await screen.findByText("Clew service is unreachable")).toBeInTheDocument();
  });
});
