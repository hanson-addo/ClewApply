import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { clerkState, resetClerk } from "../test/clerkMock";
import type { FeedJob, JobDetail } from "./model";

vi.mock("@clerk/react", async () => (await import("../test/clerkMock")).clerkModule);

// Made-up companies and jobs only.
function job(n: number, extra: Partial<FeedJob> = {}): FeedJob {
  return {
    id: `aaaaaaaa-1111-4111-8111-${String(n).padStart(12, "0")}`,
    title: `Maze Mapper ${n}`,
    company: "Labyrinth Logistics",
    unverified_board: false,
    location: "Austin, TX",
    remote_type: "onsite",
    salary_min: null,
    salary_max: 150000,
    posted_at: "2026-11-05T12:00:00Z",
    apply_url: `https://boards.greenhouse.io/labyrinth/jobs/${n}`,
    apply_source: "greenhouse",
    seen_on: ["greenhouse", "usajobs"],
    saved: false,
    fit_score: 90 - n,
    reasons: ["Remote, as you prefer"],
    ...extra,
  };
}

function detail(base: FeedJob, extra: Partial<JobDetail> = {}): JobDetail {
  return {
    ...base,
    description: "Wind thread through the maze.",
    fit_parts: [
      { label: "Title", value: 100 },
      { label: "Skills", value: 50 },
      { label: "Location", value: 0 },
      { label: "Pay", value: null, note: "Not listed" },
    ],
    status: "open",
    dismissed: false,
    listings: [
      {
        source: "greenhouse",
        url: base.apply_url,
        is_primary: true,
        first_seen_at: "2026-11-05T12:00:00Z",
        last_seen_at: "2026-11-06T12:00:00Z",
      },
      {
        source: "email",
        url: "javascript:alert(1)",
        is_primary: false,
        first_seen_at: "2026-11-05T12:00:00Z",
        last_seen_at: "2026-11-06T12:00:00Z",
      },
    ],
    ...extra,
  };
}

type Handler = (request: Request) => Response | Promise<Response>;
const fetchMock = vi.fn<(request: Request) => Promise<Response>>();
let handlers: Record<string, Handler> = {};
let feedQueries: URLSearchParams[] = [];
let calls: string[] = [];

function page(jobs: FeedJob[], total = jobs.length, hasMore = false) {
  return { jobs, page: 1, per_page: 25, total, has_more: hasMore };
}

function serve(overrides: Record<string, Handler> = {}) {
  handlers = {
    "GET /feed": () => Response.json(page([job(1), job(2), job(3)])),
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
  feedQueries = [];
  calls = [];
  serve();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (request) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    calls.push(key);
    if (key === "GET /feed") feedQueries.push(url.searchParams);
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const user = () => userEvent.setup();

describe("job list", () => {
  it("shows ranked cards with fit, reason, sources and the count", async () => {
    renderAt("/jobs");
    const first = await screen.findByRole("link", {
      name: "Maze Mapper 1, Labyrinth Logistics, Austin, TX, $150k, fit 89 of 100",
    });
    const card = first.closest("article") as HTMLElement;
    expect(within(card).getByText("Remote, as you prefer")).toBeInTheDocument();
    expect(within(card).getByText("Seen on Greenhouse, USAJobs")).toBeInTheDocument();
    expect(screen.getByText("3 jobs")).toBeInTheDocument();
    expect(document.title).toBe("Jobs · Clew");
  });

  it("labels jobs from unverified boards", async () => {
    serve({ "GET /feed": () => Response.json(page([job(1, { unverified_board: true })])) });
    renderAt("/jobs");
    const link = await screen.findByRole("link", { name: /unverified board$/ });
    expect(within(link.closest("article") as HTMLElement).getByText("Unverified board")).toBeInTheDocument();
  });

  it("reads filters from the address and sends them to the API", async () => {
    renderAt("/jobs?work=remote&state=TX&min_pay=90000&posted=7&source=lever");
    await screen.findByText("3 jobs");
    const query = feedQueries[0];
    expect(query?.get("remote")).toBe("true");
    expect(query?.get("region")).toBe("TX");
    expect(query?.get("min_salary")).toBe("90000");
    expect(query?.get("posted_within_days")).toBe("7");
    expect(query?.get("source")).toBe("lever");
    // State is the band's Where box, so More filters counts the other four.
    expect(screen.getByRole("button", { name: "More filters, 4 on" })).toBeInTheDocument();
    expect(screen.getByLabelText("Where")).toHaveValue("TX");
  });

  it("searches What and Where from the band, keeping the other filters", async () => {
    const { router } = renderAt("/jobs?work=remote");
    await screen.findByText("3 jobs");
    const search = screen.getByRole("search", { name: "Jobs" });
    await user().type(within(search).getByLabelText("What"), "  maze   mapper ");
    await user().type(within(search).getByLabelText("Where"), "Texas");
    await user().click(within(search).getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(router.state.location.search).toBe("?q=maze+mapper&work=remote&state=Texas"),
    );
    await waitFor(() => expect(feedQueries.at(-1)?.get("q")).toBe("maze mapper"));
    expect(feedQueries.at(-1)?.get("region")).toBe("Texas");
    expect(feedQueries.at(-1)?.get("remote")).toBe("true");
  });

  it("applies and clears filters through the address", async () => {
    const { router } = renderAt("/jobs");
    await screen.findByText("3 jobs");
    await user().selectOptions(screen.getByLabelText("Work type"), "remote");
    await user().type(screen.getByLabelText("Minimum yearly pay"), "100000");
    await user().click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(router.state.location.search).toBe("?work=remote&min_pay=100000"));
    await waitFor(() => expect(feedQueries.at(-1)?.get("min_salary")).toBe("100000"));

    await user().click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("keeps What and Where when More filters are cleared", async () => {
    const { router } = renderAt("/jobs?q=maze&state=TX&work=remote");
    await screen.findByText("3 jobs");
    const more = screen.getByRole("complementary", { name: "More filters" });
    await user().click(within(more).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).toBe("?q=maze&state=TX"));
  });

  it("guides a brand-new feed and a feed with no matches", async () => {
    serve({ "GET /feed": () => Response.json(page([])) });
    const view = renderAt("/jobs");
    expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeInTheDocument();
    view.unmount();

    const { router } = renderAt("/jobs?work=remote");
    expect(await screen.findByRole("heading", { name: "No matches right now" })).toBeInTheDocument();
    const clear = screen.getAllByRole("button", { name: "Clear filters" });
    await user().click(clear[clear.length - 1] as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("offers a retry when the feed fails", async () => {
    serve({ "GET /feed": () => new Response(null, { status: 500 }) });
    renderAt("/jobs");
    expect(await screen.findByRole("heading", { name: "We couldn't load your jobs" })).toBeInTheDocument();
    serve();
    await user().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("3 jobs")).toBeInTheDocument();
  });

  it("loads 25 more and moves focus to the first new card", async () => {
    serve({
      "GET /feed": (request) =>
        new URL(request.url).searchParams.get("page") === "2"
          ? Response.json({ ...page([job(4)], 4), page: 2 })
          : Response.json(page([job(1), job(2), job(3)], 4, true)),
    });
    renderAt("/jobs");
    await user().click(await screen.findByRole("button", { name: "Show 25 more" }));
    const fresh = await screen.findByRole("link", { name: /^Maze Mapper 4,/ });
    await waitFor(() => expect(fresh).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Show 25 more" })).not.toBeInTheDocument();
  });
});

describe("job detail", () => {
  const one = job(1);
  const detailUrl = `GET /jobs/${one.id}`;

  it("shows fit, reasons, safe links and a short description", async () => {
    serve({
      [detailUrl]: () => Response.json(detail(one, { description: "x".repeat(700) })),
    });
    renderAt(`/jobs/${one.id}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Maze Mapper 1" })).toBeInTheDocument();
    expect(screen.getByText("Fit score 89 of 100")).toBeInTheDocument();
    const apply = screen.getByRole("link", {
      name: "Apply on Labyrinth Logistics's site (opens in a new tab)",
    });
    expect(apply).toHaveAttribute("href", one.apply_url);
    expect(apply).toHaveAttribute("target", "_blank");
    expect(apply).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("boards.greenhouse.io")).toBeInTheDocument();

    // Why it fits you: a bar per part the score weighs, then the reasons in words.
    const why = screen.getByRole("region", { name: "Why it fits you" });
    const bars = within(why).getAllByRole("listitem").slice(0, 4);
    expect(bars.map((bar) => bar.textContent)).toEqual([
      "Title100 out of 100",
      "Skills50 out of 100",
      "Location0 out of 100",
      // A job with no pay listed says so: no half-full bar, no "50".
      "PayNot listed",
    ]);
    expect(bars[3]?.querySelector(".fit-why-fill")).toBeNull();
    expect(within(why).getByText("Remote, as you prefer")).toBeInTheDocument();

    const where = screen.getByRole("heading", { name: "Where it's posted" }).parentElement as HTMLElement;
    expect(within(where).getAllByRole("link")).toHaveLength(1);
    // The javascript: listing is plain text, never a link.
    expect(within(where).getByText("Job alert email")).toBeInTheDocument();

    const text = document.getElementById("job-description") as HTMLElement;
    expect(text.textContent).toHaveLength(601);
    await user().click(screen.getByRole("button", { name: "Read the full description" }));
    expect(text.textContent).toHaveLength(700);
  });

  it("has no Apply button for an unsafe link, and warns about unverified boards", async () => {
    const risky = job(1, { apply_url: "javascript:alert(1)", unverified_board: true });
    serve({ [detailUrl]: () => Response.json(detail(risky)) });
    renderAt(`/jobs/${one.id}`);
    await screen.findByRole("heading", { level: 2, name: "Maze Mapper 1" });
    expect(screen.queryByRole("link", { name: /^Apply/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Clew hasn't checked it/)).toBeInTheDocument();
  });

  it("saves and unsaves", async () => {
    serve({
      [detailUrl]: () => Response.json(detail(one)),
      [`POST /jobs/${one.id}/save`]: () => new Response(null, { status: 204 }),
      [`DELETE /jobs/${one.id}/feedback`]: () => new Response(null, { status: 204 }),
    });
    renderAt(`/jobs/${one.id}`);
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toHaveAttribute("aria-pressed", "false");
    await user().click(save);
    const saved = await screen.findByRole("button", { name: "Saved" });
    expect(saved).toHaveAttribute("aria-pressed", "true");
    await user().click(saved);
    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(calls).toContain(`POST /jobs/${one.id}/save`);
    expect(calls).toContain(`DELETE /jobs/${one.id}/feedback`);
  });

  it("hides a job, moves on to the next, and can undo", async () => {
    serve({
      "GET /feed": () => Response.json(page([job(1), job(2), job(3)])),
      [detailUrl]: () => Response.json(detail(one)),
      [`GET /jobs/${job(2).id}`]: () => Response.json(detail(job(2))),
      [`POST /jobs/${one.id}/dismiss`]: () => new Response(null, { status: 204 }),
      [`DELETE /jobs/${one.id}/feedback`]: () => new Response(null, { status: 204 }),
    });
    const { router } = renderAt(`/jobs/${one.id}`);
    await user().click(await screen.findByRole("button", { name: "Not for me" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/jobs/${job(2).id}`));
    expect(screen.queryByRole("link", { name: /^Maze Mapper 1,/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: /^Maze Mapper 2,/ })).toHaveFocus());
    expect(screen.getByText("2 jobs")).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("link", { name: /^Maze Mapper 1,/ })).toBeInTheDocument();
    expect(screen.getByText("Maze Mapper 1 is back in your jobs.")).toBeInTheDocument();
  });

  it("undoing a hidden saved job saves it again", async () => {
    const savedOne = job(1, { saved: true });
    serve({
      "GET /feed": () => Response.json(page([savedOne, job(2)])),
      [detailUrl]: () => Response.json(detail(savedOne)),
      [`GET /jobs/${job(2).id}`]: () => Response.json(detail(job(2))),
      [`POST /jobs/${one.id}/dismiss`]: () => new Response(null, { status: 204 }),
      [`POST /jobs/${one.id}/save`]: () => new Response(null, { status: 204 }),
    });
    renderAt(`/jobs/${one.id}`);
    await user().click(await screen.findByRole("button", { name: "Not for me" }));
    await user().click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Maze Mapper 1 is back in your jobs.")).toBeInTheDocument();
    expect(calls).toContain(`POST /jobs/${one.id}/save`);
    expect(calls).not.toContain(`DELETE /jobs/${one.id}/feedback`);
  });

  it("clears the Undo note after 10 seconds", async () => {
    serve({
      [detailUrl]: () => Response.json(detail(one)),
      [`GET /jobs/${job(2).id}`]: () => Response.json(detail(job(2))),
      [`POST /jobs/${one.id}/dismiss`]: () => new Response(null, { status: 204 }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt(`/jobs/${one.id}`);
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(await screen.findByRole("button", { name: "Not for me" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("keeps the Undo note while the pointer is over it", async () => {
    serve({
      [detailUrl]: () => Response.json(detail(one)),
      [`GET /jobs/${job(2).id}`]: () => Response.json(detail(job(2))),
      [`POST /jobs/${one.id}/dismiss`]: () => new Response(null, { status: 204 }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt(`/jobs/${one.id}`);
    const typing = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await typing.click(await screen.findByRole("button", { name: "Not for me" }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    await typing.hover(undo);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await typing.unhover(undo);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("says when a job is gone", async () => {
    serve({ [detailUrl]: () => new Response(null, { status: 404 }) });
    renderAt(`/jobs/${one.id}`);
    expect(await screen.findByText("That job isn't in your feed anymore.")).toBeInTheDocument();
  });
});
