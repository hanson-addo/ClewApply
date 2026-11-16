import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { clerkState, resetClerk } from "../test/clerkMock";
import { emptyProfile, type ProfileData, type ProfileVersion } from "./model";

vi.mock("@clerk/react", async () => (await import("../test/clerkMock")).clerkModule);

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing test value");
  return value;
}

function firstSave() {
  return must(saved[0]).body;
}

// Made-up people and companies only.
const OLD_DATA: ProfileData = {
  ...emptyProfile(),
  basics: { name: "Riley Example", profiles: [] },
};

const DATA: ProfileData = {
  ...emptyProfile(),
  basics: {
    name: "Riley Example",
    label: "Data Analyst",
    email: "riley@example.test",
    location: { city: "Springfield", region: "IL" },
    profiles: [],
  },
  work: [
    {
      name: "Cobalt Freight",
      position: "Analyst",
      startDate: "2021-03",
      highlights: ["Built weekly reports"],
    },
  ],
  // Sections the editor doesn't show yet must survive a save untouched.
  awards: [{ title: "Example Award", awarder: "Example Society" }],
  languages: [{ language: "Spanish", fluency: "Conversational" }],
};

const V1: ProfileVersion = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 1,
  created_at: "2026-10-18T15:00:00Z",
  change_summary: null,
  is_current: false,
  data: OLD_DATA,
};
const V2: ProfileVersion = {
  id: "22222222-2222-4222-8222-222222222222",
  number: 2,
  created_at: "2026-10-19T15:00:00Z",
  change_summary: "Edited Basics",
  is_current: true,
  data: DATA,
};

function summary(version: ProfileVersion) {
  const { id, number, created_at, change_summary, is_current } = version;
  return { id, number, created_at, change_summary, is_current };
}

type Handler = (request: Request) => Response | Promise<Response>;
const fetchMock = vi.fn<(request: Request) => Promise<Response>>();
let handlers: Record<string, Handler> = {};
let saved: { body: { data: ProfileData; base_version_id: string | null; change_summary: string | null } }[] = [];

function serve(overrides: Record<string, Handler> = {}) {
  handlers = {
    "GET /me": () =>
      Response.json({ id: "0b0e7c9e-1111-4222-8333-444455556666", email: "riley@example.test", plan: "free" }),
    "GET /profile": () => Response.json(V2),
    "GET /profile/versions": () => Response.json([summary(V2), summary(V1)]),
    [`GET /profile/versions/${V1.id}`]: () => Response.json(V1),
    "PUT /profile": async (request) => {
      const body = (await request.json()) as (typeof saved)[number]["body"];
      saved.push({ body });
      return Response.json({
        id: "33333333-3333-4333-8333-333333333333",
        number: 3,
        created_at: "2026-10-20T15:00:00Z",
        change_summary: body.change_summary,
        is_current: true,
        data: body.data,
      });
    },
    ...overrides,
  };
}

function renderAt(path: string | string[]) {
  const router = createMemoryRouter(
    [{ path: "*", element: <App publishableKey="pk_test_placeholder" /> }],
    { initialEntries: Array.isArray(path) ? path : [path] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}

async function renderLoaded(path: string | string[] = "/profile/basics") {
  const view = renderAt(path);
  await screen.findByRole("navigation", { name: "Profile sections" });
  return view;
}

beforeEach(() => {
  resetClerk();
  clerkState.isSignedIn = true;
  saved = [];
  serve();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (request) => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const user = () => userEvent.setup();

describe("profile page", () => {
  it("opens at Basics with the saved profile, a focused heading and a page title", async () => {
    renderAt("/profile");
    expect(await screen.findByLabelText("Full name")).toHaveValue("Riley Example");
    const heading = screen.getByRole("heading", { level: 1, name: "Basics" });
    expect(heading).toHaveFocus();
    expect(document.title).toBe("Basics · Profile · Clew");
    expect(screen.getByLabelText("City")).toHaveValue("Springfield");
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Profile sections" })).getByRole("link", { name: "Basics" })).toHaveAttribute("aria-current", "page");
  });

  it("lists saved versions newest first", async () => {
    await renderLoaded();
    const history = screen.getByRole("region", { name: "History" });
    const items = within(history).getAllByRole("button");
    expect(items[0]).toHaveTextContent("Version 2 (current)");
    expect(items[0]).toHaveTextContent("Edited Basics");
    expect(items[1]).toHaveTextContent("Version 1");
  });

  it("saves the whole profile as a new version from the version it started from", async () => {
    const u = user();
    await renderLoaded();
    const name = screen.getByLabelText("Full name");
    await u.clear(name);
    await u.type(name, "Riley Q. Example");
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^Saved\./);
    expect(saved).toHaveLength(1);
    const body = firstSave();
    expect(body.base_version_id).toBe(V2.id);
    expect(body.change_summary).toBe("Edited Basics");
    expect(body.data.basics?.name).toBe("Riley Q. Example");
    expect(body.data.awards).toEqual(DATA.awards);
    expect(body.data.languages).toEqual(DATA.languages);
    expect(body.data.work).toEqual(DATA.work);
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getAllByRole("button")[0]).toHaveTextContent("Version 3 (current)");
  });

  it("saves a first profile with no base version", async () => {
    serve({
      "GET /profile": () => Response.json({ detail: "You haven't saved a profile yet." }, { status: 404 }),
      "GET /profile/versions": () => Response.json([]),
    });
    const u = user();
    await renderLoaded();
    expect(screen.getByText(/each time you save/i)).toBeInTheDocument();
    await u.type(screen.getByLabelText("Full name"), "Riley Example");
    await u.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(firstSave().base_version_id).toBeNull();
  });

  it("strips hidden characters as they're typed or pasted", async () => {
    await renderLoaded();
    const headline = screen.getByLabelText("Headline");
    fireEvent.change(headline, { target: { value: "Data\u0000 Analyst\u0007" } });
    expect(headline).toHaveValue("Data Analyst");
  });

  it("shows an error summary instead of saving a bad field, and links to the field", async () => {
    const u = user();
    await renderLoaded();
    const email = screen.getByLabelText("Email");
    await u.clear(email);
    await u.type(email, "riley");
    await u.click(screen.getByRole("button", { name: "Save" }));

    const summaryBox = must(screen.getByRole("heading", { name: "Fix 1 thing to continue" }).parentElement);
    expect(summaryBox).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter an email like name@example.com.");
    expect(saved).toHaveLength(0);

    await u.click(within(summaryBox).getByRole("link", { name: /Email/ }));
    expect(email).toHaveFocus();

    await u.type(email, "@example.test");
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("opens the right entry from an error in another section", async () => {
    const u = user();
    await renderLoaded("/profile/experience");
    await u.click(screen.getByRole("button", { name: "Edit Analyst at Cobalt Freight" }));
    fireEvent.change(screen.getByLabelText("Company website"), { target: { value: "cobalt" } });
    await u.click(screen.getByRole("button", { name: "Done with Analyst at Cobalt Freight" }));
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Needs a fix")).toBeInTheDocument();
    await u.click(screen.getByRole("link", { name: "Basics" }));

    await u.click(screen.getByRole("link", { name: /Role 1: Company website/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Experience" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company website")).toHaveFocus();
  });

  it("edits one entry at a time, and adds and removes entries", async () => {
    const u = user();
    await renderLoaded("/profile/experience");
    expect(screen.getByRole("heading", { level: 1, name: "Experience" })).toHaveFocus();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Edit Analyst at Cobalt Freight" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Analyst");
    expect(screen.getByLabelText("What you did")).toHaveValue("Built weekly reports");
    expect(screen.getByLabelText("I still work here")).toBeChecked();
    expect(screen.queryByLabelText("End")).not.toBeInTheDocument();

    await u.click(screen.getByLabelText("I still work here"));
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2020-01" } });
    expect(screen.getByLabelText("End")).toHaveValue("2020-01");

    await u.click(screen.getByRole("button", { name: "Add a role" }));
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Added role 2.");
    await u.type(screen.getByLabelText("Title"), "Lead Analyst");
    await u.type(screen.getByLabelText("Company"), "Example Corp");
    expect(screen.getByRole("heading", { level: 2, name: "Lead Analyst at Example Corp" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Remove Lead Analyst at Example Corp" }));
    expect(screen.getByRole("button", { name: "Add a role" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Removed Lead Analyst at Example Corp.");

    await u.click(screen.getByRole("button", { name: "Save" }));
    // The end date is before the start date, so the save stops there.
    expect(screen.getByRole("link", { name: /Role 1: End: End date must be after the start date/ })).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it("switches sections with the phone select and keeps unsaved edits", async () => {
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.selectOptions(screen.getByLabelText("Section"), "skills");
    expect(screen.getByRole("heading", { level: 1, name: "Skills" })).toHaveFocus();
    expect(document.title).toBe("Skills · Profile · Clew");
    await u.selectOptions(screen.getByLabelText("Section"), "basics");
    expect(screen.getByLabelText("Full name")).toHaveValue("Riley Example Jr.");
  });

  it("warns when the profile changed somewhere else, and reloads the latest", async () => {
    serve({ "PUT /profile": () => Response.json({ detail: "stale" }, { status: 409 }) });
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your profile changed somewhere else.");
    expect(screen.getByLabelText("Full name")).toHaveValue("Riley Example Jr.");

    const latest = { ...V2, id: "44444444-4444-4444-8444-444444444444", data: { ...DATA, basics: { name: "Riley From Phone", profiles: [] } } };
    serve({ "GET /profile": () => Response.json(latest) });
    await u.click(within(alert).getByRole("button", { name: "Reload latest" }));
    expect(await screen.findByDisplayValue("Riley From Phone")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a profile that's too big", async () => {
    serve({ "PUT /profile": () => Response.json({ detail: "too big" }, { status: 413 }) });
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your profile is too long to save.");
  });

  it("asks to slow down when saves are capped", async () => {
    serve({ "PUT /profile": () => Response.json({ detail: "slow down" }, { status: 429 }) });
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You're saving very quickly.");
  });

  it("shows the server's field errors", async () => {
    serve({
      "PUT /profile": () =>
        Response.json({ detail: [{ loc: ["body", "data", "basics", "label"], msg: "bad" }] }, { status: 422 }),
    });
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Headline"), "!");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Fix 1 thing to continue" })).toBeInTheDocument();
    expect(screen.getByLabelText("Headline")).toHaveAttribute("aria-invalid", "true");
  });

  it("asks before discarding, then goes back to the saved version", async () => {
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = screen.getByRole("dialog", { name: "Discard your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("Riley Example");
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("asks before leaving with unsaved changes", async () => {
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    const home = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Home" });

    await u.click(home);
    let dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("Riley Example Jr.");

    await u.click(home);
    dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it("asks before the browser's Back button leaves with unsaved changes", async () => {
    const u = user();
    const { router } = await renderLoaded(["/", "/profile/basics"]);
    await u.type(screen.getByLabelText("Full name"), " Jr.");

    await act(() => router.navigate(-1));
    let dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/profile/basics");
    expect(screen.getByLabelText("Full name")).toHaveValue("Riley Example Jr.");

    await act(() => router.navigate(-1));
    dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(saved).toHaveLength(1);
  });

  it("moves between sections with Back without asking", async () => {
    const u = user();
    const { router } = await renderLoaded(["/profile/basics", "/profile/experience"]);
    await u.click(screen.getByRole("button", { name: "Add a role" }));
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("heading", { level: 1, name: "Basics" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still asks before leaving if signing out fails", async () => {
    clerkState.signOut.mockRejectedValueOnce(new Error("offline"));
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.click(screen.getByRole("button", { name: "Sign out" }));
    let dialog = screen.getByRole("dialog", { name: "Save your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(clerkState.signOut).toHaveBeenCalled());

    const home = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Home" });
    await u.click(home);
    dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    expect(dialog).toBeInTheDocument();
  });

  it("saves before signing out when asked to", async () => {
    const u = user();
    await renderLoaded();
    await u.type(screen.getByLabelText("Full name"), " Jr.");
    await u.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = screen.getByRole("dialog", { name: "Save your changes?" });
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(clerkState.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" }));
    expect(saved).toHaveLength(1);
  });

  it("returns focus to the History entry when a version closes", async () => {
    const u = user();
    await renderLoaded();
    const entry = screen.getByRole("button", { name: /^Version 1/ });
    await u.click(entry);
    const view = await screen.findByRole("dialog", { name: "Version 1" });
    await u.click(within(view).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Version 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Version 1/ })).toHaveFocus();
  });

  it("shows an old version and restores it as a new version", async () => {
    const u = user();
    await renderLoaded();
    await u.click(screen.getByRole("button", { name: /^Version 1/ }));
    const view = await screen.findByRole("dialog", { name: "Version 1" });
    expect(within(view).getByText("Riley Example")).toBeInTheDocument();
    await u.click(within(view).getByRole("button", { name: "Restore this version" }));

    const confirm = screen.getByRole("dialog", { name: "Restore version 1?" });
    expect(confirm).toHaveTextContent("Your current profile stays in history.");
    await u.click(within(confirm).getByRole("button", { name: "Restore version 1" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(firstSave()).toEqual({
      data: OLD_DATA,
      base_version_id: V2.id,
      change_summary: "Restored version 1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Restored version 1.");
    expect(screen.getByLabelText("Headline")).toHaveValue("");
  });

  it("shows the version numbers the server gives, even past one page of history", async () => {
    const latest = { ...V2, number: 150 };
    const older = { ...V1, number: 149 };
    serve({
      "GET /profile": () => Response.json(latest),
      "GET /profile/versions": () => Response.json([summary(latest), summary(older)]),
      [`GET /profile/versions/${V1.id}`]: () => Response.json(older),
    });
    const u = user();
    await renderLoaded();
    expect(screen.getByRole("button", { name: /^Version 150/ })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /^Version 149/ }));
    const view = await screen.findByRole("dialog", { name: "Version 149" });
    await u.click(within(view).getByRole("button", { name: "Restore this version" }));
    expect(screen.getByRole("dialog", { name: "Restore version 149?" })).toBeInTheDocument();
  });

  it("says so when the profile can't load", async () => {
    serve({ "GET /profile": () => Response.json({ detail: "boom" }, { status: 500 }) });
    renderAt("/profile/basics");
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your profile/i);
  });

  it("sends unknown sections to Basics", async () => {
    renderAt("/profile/sensitive");
    expect(await screen.findByRole("heading", { level: 1, name: "Basics" })).toBeInTheDocument();
  });
});
