import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { clerkState, resetClerk } from "./test/clerkMock";

vi.mock("@clerk/react", async () => (await import("./test/clerkMock")).clerkModule);

function renderAt(path: string, publishableKey = "pk_test_placeholder") {
  return render(
    <RouterProvider
      router={createMemoryRouter([{ path: "*", element: <App publishableKey={publishableKey} /> }], {
        initialEntries: [path],
      })}
    />,
  );
}

const fetchMock = vi.fn<(request: Request) => Promise<Response>>();

/** Answers each endpoint by its path. A new user: an account, but no profile or jobs yet. */
function mockApi(overrides: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    "/me": () => Response.json({ id: "0b0e7c9e-1111-4222-8333-444455556666", email: "riley@example.test", plan: "free" }),
    "/profile": () => Response.json({ detail: "No profile yet." }, { status: 404 }),
    "/preferences": () => Response.json({ detail: "none" }, { status: 404 }),
    "/feed": () => Response.json({ jobs: [], total: 0, page: 1, per_page: 4, has_more: false }),
    "/applications": () => Response.json({ applications: [] }),
    ...overrides,
  };
  fetchMock.mockImplementation((request) => {
    const handler = routes[new URL(request.url).pathname];
    return Promise.resolve(handler ? handler() : Response.json({ detail: "not found" }, { status: 404 }));
  });
}

beforeEach(() => {
  resetClerk();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("without a Clerk key", () => {
  it("explains that sign-in isn't set up", () => {
    renderAt("/", "");
    expect(screen.getByRole("heading", { name: /sign-in isn't set up yet/i })).toBeInTheDocument();
  });
});

describe("when Clerk can't load", () => {
  it("says sign-in couldn't load instead of loading forever", () => {
    clerkState.isLoaded = false;
    clerkState.failed = true;
    renderAt("/");
    expect(screen.getByRole("heading", { name: /sign-in couldn't load/i })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("shows Loading while Clerk is still loading", () => {
    clerkState.isLoaded = false;
    renderAt("/");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

describe("sign-in page", () => {
  it("shows Clerk's sign-in widget, the brand and the password promise", () => {
    renderAt("/sign-in");
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/every job site/i);
    expect(screen.getByRole("img", { name: /threads from linkedin/i })).toBeInTheDocument();
    expect(
      screen.getByText("Clew never asks for your passwords on other sites."),
    ).toBeInTheDocument();
  });

  it("has no password field of its own", () => {
    const { container } = renderAt("/sign-in");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows Clerk's sign-up widget at /sign-up", () => {
    renderAt("/sign-up");
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });
});

describe("signed-in pages", () => {
  it("send signed-out visitors to sign-in", () => {
    renderAt("/");
    expect(screen.getByText("Redirecting to sign in")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wait for Clerk to load before deciding", () => {
    clerkState.isLoaded = false;
    renderAt("/");
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("load the account with the session token and show the email", async () => {
    clerkState.isSignedIn = true;
    mockApi();
    renderAt("/");

    expect(await screen.findByText("riley@example.test")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /set up your profile/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /add your resume/i })[0]).toHaveAttribute("href", "/onboarding/upload");
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.url).toMatch(/\/me$/);
    expect(request?.headers.get("Authorization")).toBe("Bearer test-session-token");
  });

  it("say so when the account can't be loaded", async () => {
    clerkState.isSignedIn = true;
    fetchMock.mockResolvedValue(Response.json({ detail: "Sign in to continue." }, { status: 401 }));
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your account/i);
  });

  it("ask for an email address when the account has none", async () => {
    clerkState.isSignedIn = true;
    fetchMock.mockResolvedValue(Response.json({ detail: "email_required" }, { status: 403 }));
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent(/needs an email address/i);
  });

  it("show the generic error for a 403 that isn't about email", async () => {
    clerkState.isSignedIn = true;
    fetchMock.mockResolvedValue(Response.json({ detail: "account_suspended" }, { status: 403 }));
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your account/i);
  });

  it("say sign-in is unavailable when the API can't check sign-ins", async () => {
    clerkState.isSignedIn = true;
    fetchMock.mockResolvedValue(
      Response.json({ detail: "Sign-in is temporarily unavailable." }, { status: 503 }),
    );
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
  });

  it("sign out from the header", async () => {
    clerkState.isSignedIn = true;
    mockApi();
    renderAt("/");
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(clerkState.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" }));
  });

  it("redirect unknown paths home", () => {
    renderAt("/no-such-page");
    expect(screen.getByText("Redirecting to sign in")).toBeInTheDocument();
  });
});
