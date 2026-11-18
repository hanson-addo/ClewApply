import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "../App";
import { clerkState, resetClerk } from "../test/clerkMock";

vi.mock("@clerk/react", async () => (await import("../test/clerkMock")).clerkModule);

const fetchMock = vi.fn<(request: Request) => Promise<Response>>();
let status: () => Response;

const SITES = [
  {
    site: "linkedin",
    name: "LinkedIn",
    profile_url: "https://www.linkedin.com/in/me/",
    state: "behind",
    behind: [
      { key: "headline", label: "Headline" },
      { key: "skills", label: "Skills" },
      { key: "work.0.title", label: "Job 1: title" },
    ],
    last_filled_at: "2026-11-18T14:04:00Z",
  },
  {
    site: "indeed",
    name: "Indeed",
    profile_url: "https://profile.indeed.com/",
    state: "up_to_date",
    behind: [],
    last_filled_at: "2026-11-17T09:00:00Z",
  },
  {
    site: "usajobs",
    name: "USAJobs",
    profile_url: "https://www.usajobs.gov/applicant/profile/",
    state: "not_set_up",
    behind: [],
    last_filled_at: null,
  },
];

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: "*", element: <App publishableKey="pk_test_placeholder" /> }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  resetClerk();
  clerkState.isSignedIn = true;
  status = () => Response.json({ sites: SITES });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/sync/status") return status();
    throw new Error(`Unexpected request ${request.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it("shows each site's state, what changed, and a link to the site", async () => {
  renderAt("/sync");
  expect(await screen.findByRole("heading", { name: "Sync Center", level: 1 })).toBeInTheDocument();

  const linkedin = await screen.findByRole("region", { name: "LinkedIn" });
  expect(linkedin).toHaveTextContent("3 changes behind");
  expect(linkedin).toHaveTextContent("Last filled from Clew Nov 18, 2026");
  const changed = within(linkedin).getByRole("list", { name: "Changed fields for LinkedIn" });
  expect(within(changed).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Headline",
    "Skills",
    "Job 1: title",
  ]);
  const open = within(linkedin).getByRole("link", { name: /Open your LinkedIn profile/ });
  expect(open).toHaveAttribute("href", "https://www.linkedin.com/in/me/");
  expect(open).toHaveAttribute("target", "_blank");
  expect(open).toHaveAttribute("rel", "noopener noreferrer");

  expect(screen.getByRole("region", { name: "Indeed" })).toHaveTextContent("Up to date");
  const usajobs = screen.getByRole("region", { name: "USAJobs" });
  expect(usajobs).toHaveTextContent("Not set up yet");
  expect(usajobs).toHaveTextContent("Clew hasn't filled anything on USAJobs yet.");
  expect(screen.getByText(/Clew only knows what it filled/)).toBeInTheDocument();
});

it("says one change, not one changes", async () => {
  status = () => Response.json({ sites: [{ ...SITES[0], behind: [{ key: "about", label: "About" }] }] });
  renderAt("/sync");
  expect(await screen.findByRole("region", { name: "LinkedIn" })).toHaveTextContent("1 change behind");
});

it("is in the main navigation", async () => {
  renderAt("/sync");
  const link = await screen.findByRole("link", { name: "Sync" });
  expect(link).toHaveAttribute("href", "/sync");
  expect(link).toHaveAttribute("aria-current", "page");
});

it("says so when the Sync Center isn't set up on the server", async () => {
  status = () => Response.json({ detail: "x" }, { status: 503 });
  renderAt("/sync");
  expect(await screen.findByRole("alert")).toHaveTextContent("The Sync Center isn't available yet.");
});

it("says so when it can't load", async () => {
  status = () => {
    throw new TypeError("offline");
  };
  renderAt("/sync");
  expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load your sites.");
});
