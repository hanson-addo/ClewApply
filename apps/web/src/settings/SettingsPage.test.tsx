import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { clerkState, resetClerk } from "../test/clerkMock";

vi.mock("@clerk/react", async () => (await import("../test/clerkMock")).clerkModule);

const HINT = {
  clerk_error: {
    type: "forbidden",
    reason: "reverification-error",
    metadata: { reverification: { level: "first_factor", afterMinutes: 10 } },
  },
};

type Handler = (request: Request) => Response | Promise<Response>;
const fetchMock = vi.fn<(request: Request) => Promise<Response>>();
let handlers: Record<string, Handler> = {};
let calls: string[] = [];

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: "*", element: <App publishableKey="pk_test_placeholder" /> }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  resetClerk();
  clerkState.isSignedIn = true;
  calls = [];
  handlers = {
    "GET /me": () => Response.json({ id: "u1", email: "riley@example.test", plan: "free" }),
    "GET /extension/connections": () => Response.json({ connections: [] }),
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (request) => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    calls.push(key);
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:clew-data");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CODE = `clk_${"c".repeat(43)}`;
const LAPTOP = {
  id: "7d1f4c1e-6c0e-4a52-9a52-6f0f1c2d3e4f",
  label: "Chrome on macOS",
  created_at: "2026-11-18T14:04:00Z",
  last_used_at: "2026-11-18T15:00:00Z",
};

/** Stands in for Chrome's chrome.runtime as a page sees it when the extension is installed. */
function installExtension(answer: (id: string, message: unknown) => Promise<unknown>) {
  const sendMessage = vi.fn(answer);
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  return sendMessage;
}

describe("Settings: browser extension", () => {
  it("connects this browser: link code after confirming it's them, handed to the extension", async () => {
    let tries = 0;
    handlers["POST /extension/link"] = () =>
      ++tries === 1 ? Response.json(HINT, { status: 403 }) : Response.json({ code: CODE, expires_at: "x" }, { status: 201 });
    let connected = false;
    handlers["GET /extension/connections"] = () => Response.json({ connections: connected ? [LAPTOP] : [] });
    const sendMessage = installExtension(async () => {
      connected = true;
      return { ok: true };
    });
    renderAt("/settings");
    const card = await screen.findByRole("region", { name: "Browser extension" });
    expect(await within(card).findByText("No browsers are connected.")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Connect this browser" }));

    expect(await within(card).findByRole("status")).toHaveTextContent("This browser is connected.");
    expect(clerkState.reverified).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith("bknomgnbnlknofhndoodlaboaomlhben", { type: "clew/link", code: CODE });
    const list = await within(card).findByRole("list", { name: "Connected browsers" });
    expect(list).toHaveTextContent("Chrome on macOS");
    expect(list).toHaveTextContent(/Connected Nov 18, 2026, last used Nov 18, 2026/);
  });

  it("says to install the extension when Chrome has no way to reach it", async () => {
    handlers["POST /extension/link"] = () => Response.json({ code: CODE, expires_at: "x" }, { status: 201 });
    renderAt("/settings");
    const card = await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(within(card).getByRole("button", { name: "Connect this browser" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Install the Clew extension in Chrome");
  });

  it("says to install the extension when it isn't the one installed", async () => {
    handlers["POST /extension/link"] = () => Response.json({ code: CODE, expires_at: "x" }, { status: 201 });
    installExtension(async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    });
    renderAt("/settings");
    const card = await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(within(card).getByRole("button", { name: "Connect this browser" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Install the Clew extension in Chrome");
  });

  it("says so when the extension couldn't use the code", async () => {
    handlers["POST /extension/link"] = () => Response.json({ code: CODE, expires_at: "x" }, { status: 201 });
    installExtension(async () => ({ ok: false, error: "expired" }));
    renderAt("/settings");
    const card = await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(within(card).getByRole("button", { name: "Connect this browser" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("We couldn't connect the extension.");
  });

  it("says so when too many link codes were made this hour", async () => {
    handlers["POST /extension/link"] = () => Response.json({ detail: "x" }, { status: 429 });
    renderAt("/settings");
    const card = await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(within(card).getByRole("button", { name: "Connect this browser" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("several times this hour");
  });

  it("disconnects a browser", async () => {
    let listed = [LAPTOP];
    handlers["GET /extension/connections"] = () => Response.json({ connections: listed });
    handlers[`DELETE /extension/connections/${LAPTOP.id}`] = () => {
      listed = [];
      return new Response(null, { status: 204 });
    };
    renderAt("/settings");
    const card = await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(await within(card).findByRole("button", { name: "Disconnect Chrome on macOS" }));
    expect(await within(card).findByRole("status")).toHaveTextContent("Disconnected Chrome on macOS.");
    expect(await within(card).findByText("No browsers are connected.")).toBeInTheDocument();
  });

  it("signing out disconnects the extension first", async () => {
    handlers["POST /extension/connections/revoke-all"] = () => new Response(null, { status: 204 });
    renderAt("/settings");
    await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(clerkState.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" }));
    expect(calls).toContain("POST /extension/connections/revoke-all");
  });

  it("still signs out when Clew can't be reached", async () => {
    handlers["POST /extension/connections/revoke-all"] = () => {
      throw new TypeError("offline");
    };
    renderAt("/settings");
    await screen.findByRole("region", { name: "Browser extension" });
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(clerkState.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" }));
  });
});

describe("Settings", () => {
  it("shows the account and is reachable from the account menu", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument();
    const account = screen.getByRole("region", { name: "Account" });
    await waitFor(() => expect(account).toHaveTextContent("riley@example.test"));
    expect(account).toHaveTextContent("Free");
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("asks the user to confirm it's them, then offers the download", async () => {
    let tries = 0;
    handlers["POST /me/export"] = () =>
      ++tries === 1
        ? Response.json(HINT, { status: 403 })
        : new Response("zipdata", { headers: { "Content-Type": "application/zip" } });
    renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Prepare download" }));

    const link = await screen.findByRole("link", { name: /Download \(expires in 15 minutes\)/ });
    expect(link).toHaveAttribute("href", "blob:clew-data");
    expect(link).toHaveAttribute("download", "clew-data.zip");
    expect(clerkState.reverified).toBe(1);
    expect(calls.filter((call) => call === "POST /me/export")).toHaveLength(2);
  });

  it("says so when the download can't be prepared", async () => {
    handlers["POST /me/export"] = () => Response.json({ detail: "x" }, { status: 503 });
    renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Prepare download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't prepare your file.");
  });

  it("deletes the account only after typing DELETE, then signs out", async () => {
    handlers["DELETE /me"] = () => new Response(null, { status: 204 });
    renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account" }));

    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete my account" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type DELETE to confirm"), " delete ");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(clerkState.signOut).toHaveBeenCalledWith({ redirectUrl: "/account-deleted" }));
    expect(calls).toContain("DELETE /me");
  });

  it("goes to the deleted page even if signing out fails after the account is gone", async () => {
    handlers["DELETE /me"] = () => new Response(null, { status: 204 });
    clerkState.signOut.mockRejectedValueOnce(new Error("session already revoked"));
    renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    expect(await screen.findByRole("heading", { name: "Your account is deleted" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a clear message when deleting fails", async () => {
    handlers["DELETE /me"] = () => Response.json({ detail: "x" }, { status: 503 });
    renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your account wasn't deleted.");
    expect(clerkState.signOut).not.toHaveBeenCalled();
  });

  it("has a public page for after the account is deleted", async () => {
    clerkState.isSignedIn = false;
    renderAt("/account-deleted");
    expect(await screen.findByRole("heading", { name: "Your account is deleted" })).toBeInTheDocument();
  });
});
