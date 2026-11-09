import { describe, expect, it } from "vitest";

import { cardLine, closedLabel, columnOf, dateToIso, sentText, stepText, type Application } from "./model";

// Made-up companies and jobs only.
const APP: Application = {
  id: "bbbbbbbb-1111-4111-8111-111111111111",
  job_id: null,
  job_status: null,
  title: "Maze Mapper",
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
  updated_at: "2026-11-02T12:00:00Z",
};

describe("columns", () => {
  it("puts rejected and withdrawn in Closed with their own label", () => {
    expect(columnOf("rejected")).toBe("closed");
    expect(columnOf("withdrawn")).toBe("closed");
    expect(columnOf("interview")).toBe("interview");
    expect(closedLabel("rejected")).toBe("Rejected");
    expect(closedLabel("withdrawn")).toBe("Withdrawn");
    expect(closedLabel("offer")).toBeNull();
  });
});

describe("card text", () => {
  it("dates the latest step", () => {
    expect(stepText(APP)).toBe("applied Nov 2");
    expect(stepText({ ...APP, status: "saved" })).toBe("saved Nov 1");
    expect(stepText({ ...APP, status: "withdrawn", closed_at: "2026-11-05T12:00:00Z" })).toBe("withdrawn Nov 5");
  });

  it("says what was sent, and marks a deleted file", () => {
    expect(sentText(APP)).toBeNull();
    const sent = { ...APP, resume_id: APP.id, resume_name: "backend.pdf", profile_version: 7 };
    expect(sentText(sent)).toBe("Sent: backend.pdf, version 7");
    expect(sentText({ ...sent, resume_deleted: true })).toBe("Sent: backend.pdf (deleted), version 7");
    expect(cardLine(sent)).toBe("Sent: backend.pdf, version 7");
  });

  it("shows the first line of notes on an interview card", () => {
    expect(cardLine({ ...APP, status: "interview", notes: "\nPanel on Friday\nBring a map" })).toBe("Panel on Friday");
    expect(cardLine({ ...APP, status: "saved", notes: "x" })).toBeNull();
  });

  it("turns a date input into midday UTC", () => {
    expect(dateToIso("2026-10-20")).toBe("2026-10-20T12:00:00Z");
    expect(dateToIso("")).toBeUndefined();
  });
});
