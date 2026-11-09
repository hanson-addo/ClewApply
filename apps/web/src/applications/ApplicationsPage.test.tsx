import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { clerkState, resetClerk } from "../test/clerkMock";
import type { Application } from "./model";

vi.mock("@clerk/react", async () => (await import("../test/clerkMock")).clerkModule);

// Made-up companies and jobs only.
function app(n: number, extra: Partial<Application> = {}): Application {
  return {
    id: `bbbbbbbb-1111-4111-8111-${String(n).padStart(12, "0")}`,
    job_id: null,
    job_status: null,
    title: `Maze Mapper ${n}`,
    company: "Labyrinth Logistics",
    url: null,
    status: "applied",
    applied_at: "2026-11-02T12:00:00Z",
    closed_at: null,
    notes: "",
    resume_id: null,
    resume_name: null,
    resume_deleted: false,
    profile_version: null,
    created_at: "2026-11-01T12:00:00Z",
    updated_at: `2026-11-0${n}T12:00:00Z`,
    ...extra,
  };
}

type Handler = (request: Request) => Response | Promise<Response>;
const fetchMock = vi.fn<(request: Request) => Promise<Response>>();
let handlers: Record<string, Handler> = {};
let calls: { key: string; body: unknown }[] = [];

function serve(overrides: Record<string, Handler> = {}) {
  handlers = {
    "GET /applications": () =>
      Response.json({
        applications: [
          app(1, { status: "saved", applied_at: null }),
          app(2),
          app(3, { status: "rejected", closed_at: "2026-11-03T12:00:00Z" }),
          app(4, { status: "withdrawn", closed_at: "2026-11-04T12:00:00Z" }),
        ],
      }),
    ...overrides,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: "*", element: <App publishableKey="pk_test_placeholder" /> }], {
    initialEntries: [path],
  });
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  resetClerk();
  clerkState.isSignedIn = true;
  calls = [];
  serve();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (request) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const text = request.method === "GET" ? "" : await request.clone().text();
    calls.push({ key, body: text ? JSON.parse(text) : null });
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
const column = (name: RegExp) => screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;

describe("board", () => {
  it("shows five columns with counts, and both kinds of closed with their labels", async () => {
    renderAt("/applications");
    expect(await screen.findByRole("heading", { level: 2, name: /^Closed/ })).toBeInTheDocument();
    for (const [name, count] of [
      ["Saved", 1],
      ["Applied", 1],
      ["Interview", 0],
      ["Offer", 0],
      ["Closed", 2],
    ] as const) {
      expect(screen.getByRole("heading", { level: 2, name: `${name} (${count})` })).toBeInTheDocument();
    }
    const closed = column(/^Closed/);
    expect(within(closed).getByText("Rejected")).toBeInTheDocument();
    expect(within(closed).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(column(/^Interview/)).getByText("Move a card here when you get an interview.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Maze Mapper 2" })).toHaveAttribute(
      "href",
      `/applications/${app(2).id}`,
    );
    expect(document.title).toBe("Applications · Clew");
    expect(screen.getByRole("link", { name: "Applications" })).toHaveAttribute("aria-current", "page");
  });

  it("moves a card with its Status select and keeps focus on it", async () => {
    serve({
      ...handlers,
      [`PATCH /applications/${app(2).id}/status`]: () => Response.json(app(2, { status: "interview" })),
    });
    renderAt("/applications");
    const select = await screen.findByRole("combobox", { name: "Status of Maze Mapper 2" });
    await user().selectOptions(select, "interview");

    await waitFor(() =>
      expect(within(column(/^Interview/)).getByRole("link", { name: "Maze Mapper 2" })).toBeInTheDocument(),
    );
    expect(calls).toContainEqual({ key: `PATCH /applications/${app(2).id}/status`, body: { status: "interview" } });
    expect(screen.getByText("Maze Mapper 2 moved to Interview.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Status of Maze Mapper 2" })).toHaveFocus(),
    );
    expect(screen.getByRole("tab", { name: "Interview 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("has status tabs that move with the arrow keys", async () => {
    renderAt("/applications");
    const saved = await screen.findByRole("tab", { name: "Saved 1" });
    saved.focus();
    await user().keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Applied 1" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Applied 1" })).toHaveAttribute("aria-selected", "true");
    await user().keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Closed 2" })).toHaveFocus();
  });

  it("welcomes a brand-new account with one message", async () => {
    serve({ "GET /applications": () => Response.json({ applications: [] }) });
    renderAt("/applications");
    expect(await screen.findByRole("heading", { name: "No applications yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your jobs" })).toHaveAttribute("href", "/jobs");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    let fail = true;
    serve({
      "GET /applications": () =>
        fail ? new Response(null, { status: 500 }) : Response.json({ applications: [app(2)] }),
    });
    renderAt("/applications");
    expect(await screen.findByText("We couldn't load your applications")).toBeInTheDocument();
    fail = false;
    await user().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Maze Mapper 2" })).toBeInTheDocument();
  });
});

describe("adding by hand", () => {
  it("checks the fields, then adds the card to its column", async () => {
    serve({
      ...handlers,
      "POST /applications": () =>
        Response.json(app(9, { title: "Thread Winder", company: "Minotaur Freight", url: "https://jobs.example.test/9" }), {
          status: 201,
        }),
    });
    renderAt("/applications");
    await user().click(await screen.findByRole("button", { name: "Add an application" }));
    const dialog = screen.getByRole("dialog", { name: "Add an application" });

    await user().type(within(dialog).getByLabelText("Link to the posting (optional)"), "javascript:alert(1)");
    await user().click(within(dialog).getByRole("button", { name: "Add application" }));
    expect(within(dialog).getByText("Enter the job title.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a link that starts with https:// or http://.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Job title")).toHaveFocus();
    expect(calls.some((c) => c.key === "POST /applications")).toBe(false);

    await user().type(within(dialog).getByLabelText("Job title"), "Thread Winder");
    await user().type(within(dialog).getByLabelText("Company"), "Minotaur Freight");
    const link = within(dialog).getByLabelText("Link to the posting (optional)");
    await user().clear(link);
    await user().type(link, "https://jobs.example.test/9");
    await user().type(within(dialog).getByLabelText("Date applied (optional)"), "2026-10-20");
    await user().click(within(dialog).getByRole("button", { name: "Add application" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.find((c) => c.key === "POST /applications")?.body).toEqual({
      title: "Thread Winder",
      company: "Minotaur Freight",
      url: "https://jobs.example.test/9",
      status: "applied",
      applied_at: "2026-10-20T12:00:00Z",
      notes: "",
    });
    expect(within(column(/^Applied/)).getByRole("link", { name: "Thread Winder" })).toBeInTheDocument();
    expect(screen.getByText("Added Thread Winder to Applied.")).toBeInTheDocument();
  });
});

describe("one application", () => {
  const sent = app(2, {
    url: "https://jobs.example.test/2",
    notes: "Panel on Friday",
    resume_id: "cccccccc-1111-4111-8111-111111111111",
    resume_name: "backend.pdf",
    profile_version: 7,
  });
  const detailUrl = `GET /applications/${sent.id}`;

  it("shows the posting, what was sent and the notes, and saves notes", async () => {
    serve({
      ...handlers,
      [detailUrl]: () => Response.json(sent),
      [`PATCH /applications/${sent.id}`]: () => Response.json({ ...sent, notes: "Panel moved to Monday" }),
    });
    renderAt(`/applications/${sent.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Maze Mapper 2" })).toBeInTheDocument();
    const posting = screen.getByRole("link", { name: /jobs\.example\.test/ });
    expect(posting).toHaveAttribute("href", "https://jobs.example.test/2");
    expect(posting).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("backend.pdf, version 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download this version" })).toBeInTheDocument();

    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(notes).toHaveValue("Panel on Friday");
    await user().clear(notes);
    await user().type(notes, "Panel moved to Monday");
    await user().click(screen.getByRole("button", { name: "Save notes" }));
    expect(await screen.findByText("Notes saved.")).toBeInTheDocument();
    expect(calls.find((c) => c.key === `PATCH /applications/${sent.id}`)?.body).toEqual({
      notes: "Panel moved to Monday",
    });
  });

  it("never links an unsafe posting or a deleted resume", async () => {
    serve({
      ...handlers,
      [detailUrl]: () => Response.json({ ...sent, url: "javascript:alert(1)", resume_deleted: true }),
    });
    renderAt(`/applications/${sent.id}`);
    expect(await screen.findByText("No link saved")).toBeInTheDocument();
    expect(screen.getByText("backend.pdf (deleted), version 7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download this version" })).not.toBeInTheDocument();
  });

  it("asks before deleting, then goes back to the board", async () => {
    serve({
      ...handlers,
      [detailUrl]: () => Response.json(sent),
      [`DELETE /applications/${sent.id}`]: () => new Response(null, { status: 204 }),
    });
    const { router } = renderAt(`/applications/${sent.id}`);
    await user().click(await screen.findByRole("button", { name: "Delete application" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this application? This can't be undone." });
    await user().click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);

    await user().click(screen.getByRole("button", { name: "Delete application" }));
    await user().click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete application" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/applications"));
    expect(screen.queryByRole("link", { name: "Maze Mapper 2" })).not.toBeInTheDocument();
    expect(screen.getByText("Deleted Maze Mapper 2.")).toBeInTheDocument();
  });

  it("says when an application is gone", async () => {
    serve({ ...handlers, [detailUrl]: () => new Response(null, { status: 404 }) });
    renderAt(`/applications/${sent.id}`);
    expect(await screen.findByText("That application isn't here anymore.")).toBeInTheDocument();
  });
});
