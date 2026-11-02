import { describe, expect, it } from "vitest";

import {
  BASICS_FIELDS,
  LIST_SECTIONS,
  cleanProfile,
  emptyProfile,
  entryName,
  errorsFromApi,
  fieldText,
  labelOf,
  sameProfile,
  sectionBySlug,
  sectionOf,
  stripControl,
  validateProfile,
  versionDate,
  versionNumber,
  withFieldText,
  type ProfileData,
} from "./model";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing test value");
  return value;
}

const work = must(LIST_SECTIONS.find((s) => s.id === "work"));
const skills = must(LIST_SECTIONS.find((s) => s.id === "skills"));
const spec = (section: typeof work, key: string) => must(section.fields.find((f) => f.key === key));

/** Test data skips list fields the server fills in (highlights, courses), like a request may. */
function profile(changes: Record<string, unknown>): ProfileData {
  return { ...emptyProfile(), ...changes } as ProfileData;
}

describe("field text", () => {
  it("edits nested basics keys", () => {
    const city = must(BASICS_FIELDS.find((f) => f.key === "location.city"));
    const entry = withFieldText({ name: "Riley Example" }, city, "Springfield");
    expect(entry).toEqual({ name: "Riley Example", location: { city: "Springfield" } });
    expect(fieldText(entry, city)).toBe("Springfield");
  });

  it("keeps list pieces raw while typing", () => {
    const highlights = spec(work, "highlights");
    const entry = withFieldText({}, highlights, "Built reports\n");
    expect(entry.highlights).toEqual(["Built reports", ""]);
    expect(fieldText(entry, highlights)).toBe("Built reports\n");
    const keywords = spec(skills, "keywords");
    expect(withFieldText({}, keywords, "Python, SQL").keywords).toEqual(["Python", " SQL"]);
  });
});

describe("cleanProfile", () => {
  it("trims, drops blanks and empty entries, and keeps other sections", () => {
    const cleaned = cleanProfile(
      profile({
        basics: { name: "  Riley Example ", label: "", profiles: [] },
        work: [{ name: "Cobalt Freight", highlights: ["Built reports", " "] }, { name: " " }],
        languages: [{ language: "Spanish" }],
      }),
    );
    expect(cleaned.basics).toEqual({ name: "Riley Example", profiles: [] });
    expect(cleaned.work).toEqual([{ name: "Cobalt Freight", highlights: ["Built reports"] }]);
    expect(cleaned.languages).toEqual([{ language: "Spanish" }]);
  });

  it("makes blank differences not count as changes", () => {
    const a = profile({ basics: { name: "Riley Example", profiles: [] } });
    const b = profile({ basics: { name: "Riley Example ", label: "", profiles: [] }, work: [{}] });
    expect(sameProfile(a, b)).toBe(true);
    expect(sameProfile(a, profile({ basics: { name: "Riley", profiles: [] } }))).toBe(false);
  });
});

describe("validateProfile", () => {
  it("accepts a good profile", () => {
    const good = profile({
      basics: { name: "Riley Example", email: "riley@example.test", url: "https://example.test", profiles: [] },
      work: [{ name: "Cobalt Freight", startDate: "2021-03", endDate: "2023" }],
    });
    expect(validateProfile(good)).toEqual({});
  });

  it("uses the screen spec's messages", () => {
    const errors = validateProfile(
      profile({
        basics: { email: "riley", url: "example.test", phone: "call me", profiles: [] },
        work: [{ startDate: "2022-05", endDate: "2021-01" }],
        education: [{ startDate: "March 2020" }],
        skills: [{ keywords: ["x".repeat(201)] }],
      }),
    );
    expect(errors).toEqual({
      "basics.email": "Enter an email like name@example.com.",
      "basics.url": "Links must start with https:// or http://.",
      "basics.phone": "Use only numbers, spaces and + ( ) - . in a phone number.",
      "work.0.endDate": "End date must be after the start date.",
      "education.0.startDate": "Enter a date as YYYY-MM, for example 2021-03.",
      "skills.0.keywords": "Keep each item under 200 characters.",
    });
  });

  it("compares dates only as precisely as both allow", () => {
    const sameYear = profile({ work: [{ startDate: "2021-06", endDate: "2021" }] });
    expect(validateProfile(sameYear)).toEqual({});
  });

  it("flags long text and hidden characters", () => {
    const errors = validateProfile(
      profile({ basics: { name: "x".repeat(201), label: "Analyst\u0000", profiles: [] } }),
    );
    expect(errors["basics.name"]).toBe("Keep this under 200 characters.");
    expect(errors["basics.label"]).toBe("This has a hidden character in it. Retype it.");
  });
});

describe("helpers", () => {
  it("strips control characters but keeps new lines and tabs", () => {
    expect(stripControl("a\u0000b\u0007c\nd\te\u007f")).toBe("abc\nd\te");
  });

  it("maps the API's 422 locations to field ids", () => {
    expect(
      errorsFromApi([
        { loc: ["body", "data", "work", 1, "url"], msg: "bad" },
        { loc: ["body", "data", "basics", "email"], msg: "bad" },
        { loc: ["body", "change_summary"], msg: "bad" },
      ]),
    ).toEqual({
      "work.1.url": "This doesn't look right. Check it and try again.",
      "basics.email": "This doesn't look right. Check it and try again.",
    });
    expect(errorsFromApi("nope")).toEqual({});
  });

  it("names fields, entries and sections for people", () => {
    expect(labelOf("basics.location.city")).toBe("City");
    expect(labelOf("work.0.startDate")).toBe("Role 1: Start");
    expect(sectionOf("education.2.area")).toBe("education");
    expect(sectionBySlug("experience")?.id).toBe("work");
    expect(sectionBySlug("sensitive")).toBeUndefined();
    expect(entryName(work, { position: "Analyst", name: "Cobalt Freight" }, 0)).toBe(
      "Analyst at Cobalt Freight",
    );
    expect(entryName(work, {}, 1)).toBe("Role 2");
  });

  it("numbers versions oldest first and dates them", () => {
    const versions = [
      { id: "b", created_at: "2026-10-19T15:00:00Z", change_summary: null, is_current: true },
      { id: "a", created_at: "2026-10-18T15:00:00Z", change_summary: null, is_current: false },
    ];
    expect(versionNumber(versions, "b")).toBe(2);
    expect(versionNumber(versions, "a")).toBe(1);
    const now = new Date("2026-10-19T18:00:00Z");
    expect(versionDate("2026-10-19T17:30:00Z", now)).toMatch(/^today, /);
    expect(versionDate("2026-01-05T12:00:00Z", now)).toMatch(/^Jan 5, 2026, /);
  });
});
