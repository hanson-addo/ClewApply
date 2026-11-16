import { describe, expect, it } from "vitest";

import type { Application } from "../applications/model";
import {
  activeCount,
  firstName,
  greetingFor,
  payText,
  pipelineCounts,
  setupProgress,
  statusLine,
  type Preferences,
} from "./model";

const prefs = (over: Partial<Preferences> = {}): Preferences => ({
  excluded_companies: [],
  excluded_keywords: [],
  locations: [],
  remote_ok: true,
  seniority: [],
  titles: [],
  updated_at: null,
  ...over,
});

const app = (status: Application["status"]) => ({ status }) as Application;

describe("greetingFor", () => {
  it("follows the hour", () => {
    expect(greetingFor(3)).toMatch(/midnight/);
    expect(greetingFor(9)).toBe("Good morning");
    expect(greetingFor(14)).toBe("Good afternoon");
    expect(greetingFor(20)).toBe("Good evening");
  });
});

describe("firstName", () => {
  it("takes the first word of the name", () => {
    expect(firstName("  Riley  Test Person ")).toBe("Riley");
  });
  it("is null when there is no name", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("   ")).toBeNull();
  });
});

describe("setupProgress", () => {
  it("starts with nothing done", () => {
    const p = setupProgress(false, null);
    expect(p.doneCount).toBe(0);
    expect(p.complete).toBe(false);
  });
  it("counts the resume once there is a profile", () => {
    expect(setupProgress(true, prefs()).steps.find((s) => s.id === "resume")?.done).toBe(true);
  });
  it("is complete with a profile, preferences and one saved job", () => {
    const p = setupProgress(true, prefs({ titles: ["Designer"] }), 1);
    expect(p.complete).toBe(true);
    expect(p.doneCount).toBe(3);
  });
  it("doesn't tick the jobs step until a job is saved", () => {
    expect(setupProgress(true, prefs({ titles: ["Designer"] }), 0).steps[2]?.done).toBe(false);
    expect(setupProgress(true, prefs({ titles: ["Designer"] }), null).steps[2]?.done).toBe(false);
  });
});

describe("pipeline", () => {
  const counts = pipelineCounts([app("saved"), app("saved"), app("interview"), app("rejected"), app("withdrawn")]);
  it("groups closed statuses together", () => {
    expect(counts).toEqual({ saved: 2, applied: 0, interview: 1, offer: 0, closed: 2 });
  });
  it("counts active applications without the closed ones", () => {
    expect(activeCount(counts)).toBe(3);
  });
});

describe("statusLine", () => {
  const none = pipelineCounts([]);
  it("nudges a new user to add a resume", () => {
    expect(statusLine(false, none, 0)).toMatch(/resume/i);
  });
  it("puts interviews first", () => {
    expect(statusLine(true, pipelineCounts([app("interview")]), 9)).toMatch(/1 interview in play/);
  });
  it("uses singular and plural for matches", () => {
    expect(statusLine(true, none, 1)).toBe("1 job matches you right now.");
    expect(statusLine(true, none, 4)).toBe("4 jobs match you right now.");
  });
});

describe("payText", () => {
  it("formats ranges and one-sided pay", () => {
    expect(payText({ salary_min: 120000, salary_max: 150000 })).toBe("$120k to $150k");
    expect(payText({ salary_min: 90000, salary_max: null })).toBe("From $90k");
    expect(payText({ salary_min: null, salary_max: 90000 })).toBe("Up to $90k");
    expect(payText({ salary_min: null, salary_max: null })).toBeNull();
  });
});
