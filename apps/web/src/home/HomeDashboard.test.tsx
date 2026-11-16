import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { Application } from "../applications/model";
import { HomeDashboard } from "./HomeDashboard";
import type { FeedJob } from "./model";
import type { Dashboard } from "./useDashboard";

vi.mock("./webgl", () => ({ canDrawMap: () => false }));

const job = (over: Partial<FeedJob> = {}): FeedJob =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Product Designer",
    company: "Example Co",
    location: "Austin, TX",
    remote_type: "hybrid",
    fit_score: 88,
    salary_min: 120000,
    salary_max: 150000,
    ...over,
  }) as FeedJob;

const app = (status: Application["status"]) => ({ status }) as Application;

const base: Dashboard = {
  name: "Riley Example",
  hasProfile: true,
  prefs: null,
  jobs: { items: [job()], total: 12 },
  apps: [app("saved"), app("applied"), app("interview")],
};

function renderHome(data: Dashboard, hour = 9) {
  return render(
    <MemoryRouter>
      <HomeDashboard data={data} map={{ status: "ready", center: null, pins: [], unplaced: 0 }} hour={hour} />
    </MemoryRouter>,
  );
}

describe("HomeDashboard", () => {
  it("greets a returning user by first name and time of day", () => {
    renderHome(base, 9);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back, Riley.");
    expect(screen.getByText("Good morning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your matches" })).toHaveAttribute("href", "/jobs");
  });

  it("shows the big resume prompt to a new user and no numbers", () => {
    renderHome({ name: null, hasProfile: false, prefs: null, jobs: null, apps: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Let's get you hired.");
    expect(screen.getAllByRole("link", { name: /add your resume/i })[0]).toHaveAttribute(
      "href",
      "/onboarding/upload",
    );
    expect(screen.queryByRole("region", { name: "Your numbers" })).not.toBeInTheDocument();
  });

  it("shows a neutral hero, not the new-user one, when the profile couldn't load", () => {
    renderHome({ ...base, name: null, hasProfile: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back.");
    expect(screen.getByText(/couldn't load your profile/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add your resume/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your numbers" })).not.toBeInTheDocument();
  });

  it("lists top matches with fit, company, place and pay", () => {
    renderHome(base);
    const matches = screen.getByRole("region", { name: "Top matches" });
    const row = within(matches).getByRole("link", { name: /Product Designer/ });
    expect(row).toHaveAttribute("href", "/jobs/11111111-1111-4111-8111-111111111111");
    expect(row).toHaveTextContent("Example Co · Austin, TX · $120k to $150k");
    expect(row).toHaveTextContent("Fit 88 of 100");
    expect(within(matches).getByRole("link", { name: "See all 12" })).toBeInTheDocument();
  });

  it("shows the stat tiles from the matches and the tracker", () => {
    renderHome(base);
    const stats = screen.getByRole("region", { name: "Your numbers" });
    expect(within(stats).getByRole("link", { name: "12 Jobs matching you" })).toBeInTheDocument();
    expect(within(stats).getByRole("link", { name: "1 Interviews" })).toBeInTheDocument();
  });

  it("says so when matches could not load, and still shows the rest", () => {
    renderHome({ ...base, jobs: null });
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load your matches/i);
    expect(screen.getByRole("region", { name: "Your pipeline" })).toBeInTheDocument();
  });

  it("hides the setup checklist once everything is done", () => {
    const prefs = { titles: ["Designer"] } as NonNullable<Dashboard["prefs"]>;
    renderHome({ ...base, prefs: { ...prefs, locations: [], seniority: [] } as never });
    expect(screen.queryByRole("region", { name: "Finish setting up" })).not.toBeInTheDocument();
  });

  it("shows the checklist with the next step as a link", () => {
    renderHome(base);
    const checklist = screen.getByRole("region", { name: "Finish setting up" });
    expect(within(checklist).getByRole("link", { name: "Say what you're looking for" })).toHaveAttribute(
      "href",
      "/onboarding/preferences",
    );
  });

  it("has the jobs map card", () => {
    renderHome(base);
    expect(screen.getByRole("region", { name: "Jobs near you" })).toHaveTextContent(/no matching jobs with a city/i);
  });
});

describe("polish", () => {
  it("counts the numbers up, and lands on the real value", async () => {
    renderHome(base);
    const tile = screen.getByRole("link", { name: "12 Jobs matching you" });
    // The count-up runs about a second; leave room for a busy test machine.
    await waitFor(() => expect(tile).toHaveTextContent("12Jobs matching you"), { timeout: 4000 });
  });

  it("shows the yarn art and a hint when there are no matches yet", () => {
    renderHome({ ...base, jobs: { items: [], total: 0 } });
    expect(screen.getByText(/no matches yet/i)).toBeInTheDocument();
  });
});
