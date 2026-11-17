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
  handlers = { "GET /me": () => Response.json({ id: "u1", email: "riley@example.test", plan: "free" }) };
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

  it("keeps the dialog open with a clear message when deleting fails", async () => {
    handlers["DELETE /me"] = () => Response.json({ detail: "x" }, { status: 503 });
    renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("so it's still here");
    expect(clerkState.signOut).not.toHaveBeenCalled();
  });

  it("has a public page for after the account is deleted", async () => {
    clerkState.isSignedIn = false;
    renderAt("/account-deleted");
    expect(await screen.findByRole("heading", { name: "Your account is deleted." })).toBeInTheDocument();
  });
});
