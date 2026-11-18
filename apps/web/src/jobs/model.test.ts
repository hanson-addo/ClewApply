import { describe, expect, it } from "vitest";

import {
  applyLabel,
  cardName,
  countFilters,
  countMoreFilters,
  feedQuery,
  readFilters,
  safeUrl,
  salaryText,
  writeFilters,
  type FeedJob,
} from "./model";

// Made-up companies and jobs only.
const JOB: FeedJob = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  title: "Maze Mapper",
  company: "Labyrinth Logistics",
  unverified_board: false,
  location: "Austin, TX",
  remote_type: "onsite",
  salary_min: 120000,
  salary_max: 150000,
  posted_at: "2026-11-05T12:00:00Z",
  apply_url: "https://boards.greenhouse.io/labyrinth/jobs/1",
  apply_source: "greenhouse",
  seen_on: ["greenhouse", "usajobs"],
  saved: false,
  fit_score: 88,
  reasons: ["Title matches “Maze Mapper”"],
};

describe("filters in the address", () => {
  it("round-trips known values", () => {
    const params = new URLSearchParams("work=remote&state=TX&min_pay=90000&posted=7&source=lever");
    const filters = readFilters(params);
    expect(filters).toEqual({
      work: "remote",
      region: "TX",
      minSalary: 90000,
      postedWithin: 7,
      source: "lever",
    });
    expect(writeFilters(filters).toString()).toBe(params.toString());
    expect(countFilters(filters)).toBe(5);
  });

  it("keeps the What words, tidied and capped, and counts only the folded filters as more", () => {
    const filters = readFilters(new URLSearchParams(`q=${encodeURIComponent("  maze   mapper ")}&state=TX&work=remote`));
    expect(filters).toEqual({ what: "maze mapper", region: "TX", work: "remote" });
    expect(writeFilters(filters).toString()).toBe("q=maze+mapper&work=remote&state=TX");
    expect(countMoreFilters(filters)).toBe(1);
    expect(feedQuery(filters, 1)).toMatchObject({ q: "maze mapper", region: "TX" });
    expect(readFilters(new URLSearchParams(`q=${"a".repeat(200)}`)).what).toHaveLength(80);
  });

  it("ignores unknown or malformed values", () => {
    const params = new URLSearchParams(
      "work=space&state=<script>&min_pay=-5&posted=3&source=linkedin&name=Riley",
    );
    expect(readFilters(params)).toEqual({});
  });

  it("maps to the feed query", () => {
    expect(feedQuery({ work: "not-remote", postedWithin: 30 }, 2)).toMatchObject({
      remote: false,
      posted_within_days: 30,
      page: 2,
      per_page: 25,
    });
    expect(feedQuery({}, 1).remote).toBeUndefined();
  });
});

describe("outbound links", () => {
  it.each(["javascript:alert(1)", "data:text/html,hi", "mailto:a@example.test", "not a url"])(
    "never makes %s clickable",
    (url) => {
      expect(safeUrl(url)).toBeNull();
    },
  );

  it("keeps http and https", () => {
    expect(safeUrl("https://jobs.example.test/1")?.hostname).toBe("jobs.example.test");
    expect(safeUrl("http://jobs.example.test/1")).not.toBeNull();
  });

  it("names the Apply button by where it goes", () => {
    expect(applyLabel(JOB)).toBe("Apply on Labyrinth Logistics's site");
    expect(applyLabel({ ...JOB, unverified_board: true })).toBe("Apply on boards.greenhouse.io");
    expect(applyLabel({ ...JOB, apply_source: "usajobs" })).toBe("Apply on USAJobs");
    expect(applyLabel({ ...JOB, apply_source: "email", apply_url: "https://www.jobs.example.test/x" })).toBe(
      "Apply on jobs.example.test",
    );
  });
});

describe("card text", () => {
  it("formats pay", () => {
    expect(salaryText(JOB)).toBe("$120k to $150k");
    expect(salaryText({ salary_min: null, salary_max: 90000 })).toBe("$90k");
    expect(salaryText({ salary_min: null, salary_max: null })).toBeNull();
  });

  it("puts the title first in the screen-reader name", () => {
    expect(cardName(JOB)).toBe("Maze Mapper, Labyrinth Logistics, Austin, TX, $120k to $150k, fit 88 of 100");
    expect(cardName({ ...JOB, unverified_board: true })).toMatch(/, unverified board$/);
  });
});
