import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { emptyProfile } from "../profile/model";
import { clerkState, resetClerk } from "../test/clerkMock";
import type { Consent, Parse } from "./model";

vi.mock("@clerk/react", async () => (await import("../test/clerkMock")).clerkModule);

// Made-up people and companies only.
const RESUME_ID = "cccccccc-1111-4111-8111-000000000001";
const NOT_AGREED: Consent = {
  agreed: false,
  agreed_at: null,
  agreed_policy_version: null,
  policy_version: "2026-11-draft",
};
const AGREED: Consent = {
  agreed: true,
  agreed_at: "2026-11-13T12:00:00Z",
  agreed_policy_version: "2026-11-draft",
  policy_version: "2026-11-draft",
};
const DRAFT: Parse = {
  status: "done",
  message: null,
  updated_at: "2026-11-13T12:00:00Z",
  result: {
    profile: {
      ...emptyProfile(),
      basics: { name: "Ariadne Testuser", label: "Thread Engineer", email: "ariadne@example.com", profiles: [] },
      work: [{ name: "Labyrinth Logistics", position: "Maze Mapper", startDate: "2021-03", highlights: [] }],
      skills: [{ name: "Knots", keywords: [] }],
    },
    confidence: { "basics.name": 0.97 },
    check: ["basics.label", "work[0].position"],
  },
};
const failed = (message: string): Parse => ({
  status: "failed",
  message,
  result: null,
  updated_at: "2026-11-13T12:00:00Z",
});

type Handler = (request: Request) => Response | Promise<Response>;
const fetchMock = vi.fn<(request: Request) => Promise<Response>>();
let handlers: Record<string, Handler> = {};
let calls: { key: string; body: unknown }[] = [];

function serve(overrides: Record<string, Handler> = {}) {
  handlers = {
    "GET /me/ai-consent": () => Response.json(NOT_AGREED),
    "GET /profile": () => Response.json({ detail: "No profile yet" }, { status: 404 }),
    "GET /preferences": () =>
      Response.json({
        titles: [],
        locations: [],
        remote_ok: true,
        salary_floor: null,
        seniority: [],
        excluded_companies: [],
        excluded_keywords: ["night shift"],
        updated_at: "2026-11-13T12:00:00Z",
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
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (request) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const json = request.headers.get("content-type")?.includes("application/json");
    calls.push({ key, body: json ? await request.clone().json() : null });
    const handler = handlers[key];
    if (!handler) return Response.json({ detail: "not stubbed" }, { status: 500 });
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const user = () => userEvent.setup();
const pdf = (size = 2048) => new File([new Uint8Array(size)], "resume.pdf", { type: "application/pdf" });

describe("upload step", () => {
  it("shows the consent box unticked, and records consent when ticked", async () => {
    serve({ "PUT /me/ai-consent": () => Response.json(AGREED) });
    renderAt("/onboarding/upload");
    const box = await screen.findByRole("checkbox", { name: /Let Clew's AI read my resume/ });
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/deletes it within 30 days, unless it's flagged/);
    expect(screen.getByRole("link", { name: "Privacy policy, opens in a new tab" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("list", { name: "Setup progress" })).toBeInTheDocument();
    expect(screen.getByText("Upload your resume").closest("li")).toHaveAttribute("aria-current", "step");

    await user().click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(calls).toContainEqual({
      key: "PUT /me/ai-consent",
      body: { agreed: true, policy_version: "2026-11-draft" },
    });
    expect(screen.getByText(/You agreed on Nov 13/)).toBeInTheDocument();
  });

  it("uploads, reads the resume and offers the review", async () => {
    serve({
      "GET /me/ai-consent": () => Response.json(AGREED),
      "POST /resumes": () =>
        Response.json(
          { id: RESUME_ID, filename: "resume.pdf", content_type: "application/pdf", size_bytes: 2048, created_at: "2026-11-13T12:00:00Z", reading: true },
          { status: 201 },
        ),
      [`GET /resumes/${RESUME_ID}/parse`]: () => Response.json(DRAFT),
    });
    renderAt("/onboarding/upload");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Let Clew's AI/ })).toBeChecked());
    await user().upload(screen.getByLabelText("Choose a file"), pdf());

    const review = await screen.findByRole("link", { name: "Review what we found" });
    expect(review).toHaveAttribute("href", `/onboarding/review?resume=${RESUME_ID}`);
    await waitFor(() => expect(review).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Done. We found 3 sections in your resume.");
    const steps = screen.getByRole("list", { name: "Upload progress" });
    expect(within(steps).getByText("Reading your resume")).toBeInTheDocument();
    expect(within(steps).getAllByText(", done")).toHaveLength(3);
  });

  it("keeps a file uploaded without consent and reads it once the box is ticked", async () => {
    serve({
      "PUT /me/ai-consent": () => Response.json(AGREED),
      "POST /resumes": () =>
        Response.json(
          { id: RESUME_ID, filename: "resume.pdf", content_type: "application/pdf", size_bytes: 2048, created_at: "2026-11-13T12:00:00Z", reading: false },
          { status: 201 },
        ),
      [`POST /resumes/${RESUME_ID}/parse`]: () =>
        Response.json({ status: "pending", message: null, result: null, updated_at: "2026-11-13T12:00:00Z" }, { status: 202 }),
      [`GET /resumes/${RESUME_ID}/parse`]: () => Response.json(DRAFT),
    });
    renderAt("/onboarding/upload");
    const box = await screen.findByRole("checkbox", { name: /Let Clew's AI/ });
    await waitFor(() => expect(box).toBeEnabled());
    await user().upload(screen.getByLabelText("Choose a file"), pdf());

    expect(await screen.findByText("Your resume is saved.", { selector: "p:not([role])" })).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "Upload progress" });
    expect(within(steps).queryByText("Reading your resume")).not.toBeInTheDocument();
    const read = screen.getByRole("button", { name: "Read my resume" });
    expect(read).toBeDisabled();
    expect(screen.getByRole("link", { name: "Enter my details by hand" })).toHaveAttribute(
      "href",
      `/onboarding/review?resume=${RESUME_ID}&manual=1`,
    );

    await user().click(box);
    await waitFor(() => expect(read).toBeEnabled());
    await user().click(read);
    expect(await screen.findByRole("link", { name: "Review what we found" })).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain(`POST /resumes/${RESUME_ID}/parse`);
  });

  it("offers to load the consent setting again when it fails", async () => {
    let tries = 0;
    serve({
      "GET /me/ai-consent": () =>
        ++tries === 1 ? Response.json({ detail: "x" }, { status: 500 }) : Response.json(NOT_AGREED),
    });
    renderAt("/onboarding/upload");
    const box = await screen.findByRole("checkbox", { name: /Let Clew's AI/ });
    expect(await screen.findByText(/We couldn't load this setting/)).toBeInTheDocument();
    expect(box).toBeDisabled();
    await user().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(box).toBeEnabled());
    expect(screen.queryByText(/We couldn't load this setting/)).not.toBeInTheDocument();
  });

  it("shows why a read couldn't start", async () => {
    serve({
      "GET /me/ai-consent": () => Response.json(AGREED),
      "POST /resumes": () =>
        Response.json(
          { id: RESUME_ID, filename: "resume.pdf", content_type: "application/pdf", size_bytes: 2048, created_at: "2026-11-13T12:00:00Z", reading: false },
          { status: 201 },
        ),
      [`POST /resumes/${RESUME_ID}/parse`]: () =>
        Response.json({ detail: "You've reached today's limit. Try again tomorrow." }, { status: 429 }),
    });
    renderAt("/onboarding/upload");
    const box = await screen.findByRole("checkbox", { name: /Let Clew's AI/ });
    await waitFor(() => expect(box).toBeEnabled());
    await user().upload(screen.getByLabelText("Choose a file"), pdf());
    await user().click(await screen.findByRole("button", { name: "Read my resume" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You've reached today's limit");
    expect(screen.getByRole("button", { name: "Read my resume" })).toBeInTheDocument();
  });

  it("refuses a file that's too big or the wrong type before sending it", async () => {
    renderAt("/onboarding/upload");
    const input = await screen.findByLabelText("Choose a file");
    fireEvent.change(input, { target: { files: [pdf(10 * 1024 * 1024 + 1)] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("This file is over 10 MB");
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose another file" })).toHaveFocus());

    fireEvent.change(screen.getByLabelText("Choose another file", { selector: "input" }), {
      target: { files: [new File(["x"], "resume.pages")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("We can only read PDF and Word files");
    expect(screen.getByRole("link", { name: "Enter it by hand" })).toBeInTheDocument();
    expect(calls.map((c) => c.key)).not.toContain("POST /resumes");
  });

  it("explains a file the virus check flagged", async () => {
    serve({ "POST /resumes": () => Response.json({ detail: "x" }, { status: 422 }) });
    renderAt("/onboarding/upload");
    await user().upload(await screen.findByLabelText("Choose a file"), pdf());
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't accept this file");
    expect(screen.getByRole("alert")).toHaveTextContent("Our virus check flagged it");
  });
});

describe("review step", () => {
  it("shows the draft as an editable profile with fields to check, and saves it", async () => {
    serve({
      [`GET /resumes/${RESUME_ID}/parse`]: () => Response.json(DRAFT),
      "PUT /profile": () =>
        Response.json({ id: "v1", data: DRAFT.result?.profile, created_at: "2026-11-13T12:00:00Z" }),
    });
    const { router } = renderAt(`/onboarding/review?resume=${RESUME_ID}`);
    expect(await screen.findByLabelText("Full name")).toHaveValue("Ariadne Testuser");
    expect(screen.getByRole("heading", { name: "2 fields need a look" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Done. 2 fields need a look.");

    await user().click(screen.getByRole("link", { name: "Check this: Headline" }));
    expect(screen.getByLabelText("Headline")).toHaveFocus();
    await user().click(screen.getByRole("link", { name: /Check this: .*Title/ }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());

    await user().click(screen.getByRole("button", { name: "Looks good, continue" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding/preferences"));
    const saved = calls.find((c) => c.key === "PUT /profile")?.body as Record<string, unknown>;
    expect(saved.change_summary).toBe("From your resume upload");
    expect(saved.base_version_id).toBeNull();
    expect((saved.data as { basics: { name: string } }).basics.name).toBe("Ariadne Testuser");
  });

  it("says it replaces an existing profile", async () => {
    serve({
      "GET /profile": () => Response.json({ id: "v7", data: {}, created_at: "2026-11-01T12:00:00Z" }),
      [`GET /resumes/${RESUME_ID}/parse`]: () => Response.json(DRAFT),
    });
    renderAt(`/onboarding/review?resume=${RESUME_ID}`);
    expect(await screen.findByRole("button", { name: "Replace my profile" })).toBeInTheDocument();
    expect(screen.getByText(/Your old one stays in History/)).toBeInTheDocument();
  });

  it("shows a failed read with the server's message and the right actions", async () => {
    const message = "You've reached today's limit for reading resumes. Try again tomorrow.";
    serve({ [`GET /resumes/${RESUME_ID}/parse`]: () => Response.json(failed(message)) });
    renderAt(`/onboarding/review?resume=${RESUME_ID}`);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Daily limit reached" })).toBeInTheDocument();
    expect(alert).toHaveTextContent(message);
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("");
  });

  it("can try a failed read again", async () => {
    let reads = 0;
    serve({
      [`GET /resumes/${RESUME_ID}/parse`]: () =>
        Response.json(
          reads++ === 0
            ? failed("Reading resumes is unavailable right now. Try again in a few minutes.")
            : DRAFT,
        ),
      [`POST /resumes/${RESUME_ID}/parse`]: () =>
        Response.json({ status: "pending", message: null, result: null, updated_at: "2026-11-13T12:00:00Z" }, { status: 202 }),
    });
    renderAt(`/onboarding/review?resume=${RESUME_ID}`);
    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(retry).toHaveFocus());
    await user().click(retry);
    expect(await screen.findByLabelText("Full name")).toHaveValue("Ariadne Testuser");
  });

  it("starts empty when nothing is being read", async () => {
    renderAt("/onboarding/review?manual=1");
    expect(await screen.findByText(/Add your details below/)).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(calls.map((c) => c.key)).not.toContain(`GET /resumes/${RESUME_ID}/parse`);
  });

  it("offers to fill blanks when the read finishes after typing by hand", async () => {
    let reads = 0;
    serve({
      [`GET /resumes/${RESUME_ID}/parse`]: () =>
        Response.json(
          reads++ === 0
            ? { status: "running", message: null, result: null, updated_at: "2026-11-13T12:00:00Z" }
            : DRAFT,
        ),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt(`/onboarding/review?resume=${RESUME_ID}`);
      const byHand = await screen.findByRole("button", { name: "Enter by hand instead" });
      const typing = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await typing.click(byHand);
      await typing.type(screen.getByLabelText("Full name"), "A. Testuser");
      await vi.advanceTimersByTimeAsync(2500);
      await typing.click(await screen.findByRole("button", { name: "Fill in the blanks" }));
      expect(screen.getByLabelText("Full name")).toHaveValue("A. Testuser");
      expect(screen.getByLabelText("Headline")).toHaveValue("Thread Engineer");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("preferences step", () => {
  it("saves titles, places, remote and pay, then opens the feed", async () => {
    serve({
      ...handlers,
      "PUT /preferences": async (request) => Response.json(await request.json()),
    });
    const { router } = renderAt("/onboarding/preferences");
    await user().type(await screen.findByLabelText("Job titles"), "Maze Mapper{Enter}Thread Engineer");
    await user().type(screen.getByLabelText("Places"), "Austin, TX{Enter}CO");
    await user().click(screen.getByLabelText("Show remote jobs too"));
    await user().type(screen.getByLabelText("Lowest yearly pay (optional)"), "$90,000");
    await user().click(screen.getByRole("button", { name: "Show my jobs" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/jobs"));
    // Exactly the fields the PUT takes: the GET's updated_at would be refused with a 422.
    expect(calls.find((c) => c.key === "PUT /preferences")?.body).toEqual({
      titles: ["Maze Mapper", "Thread Engineer"],
      locations: [
        { city: "Austin", region: "TX" },
        { city: null, region: "CO" },
      ],
      remote_ok: false,
      salary_floor: 90000,
      seniority: [],
      excluded_companies: [],
      excluded_keywords: ["night shift"],
    });
  });

  it("asks for a number for pay", async () => {
    renderAt("/onboarding/preferences");
    await user().type(await screen.findByLabelText("Lowest yearly pay (optional)"), "lots");
    await user().click(screen.getByRole("button", { name: "Show my jobs" }));
    expect(await screen.findByText("Enter a yearly amount in dollars, like 90000.")).toBeInTheDocument();
    expect(calls.map((c) => c.key)).not.toContain("PUT /preferences");
  });
});
