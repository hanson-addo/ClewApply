import { describe, expect, it } from "vitest";

import { emptyProfile, type ProfileData } from "../profile/model";

import {
  checkFieldId,
  checkFile,
  fieldPlace,
  fillBlanks,
  listFrom,
  locationText,
  parseLocation,
  readFailure,
  sectionsFound,
  uploadProblem,
} from "./model";

// Made-up people and companies only.
describe("upload checks", () => {
  it("refuses the wrong type or a file over 10 MB before sending", () => {
    expect(checkFile({ name: "resume.pdf", size: 1000 })).toBeNull();
    expect(checkFile({ name: "Resume.DOCX", size: 1000 })).toBeNull();
    expect(checkFile({ name: "resume.doc", size: 1000 })?.title).toBe("We can only read PDF and Word files");
    expect(checkFile({ name: "resume.pdf", size: 10 * 1024 * 1024 + 1 })?.title).toBe("This file is over 10 MB");
  });

  it("maps each upload answer to one message", () => {
    expect(uploadProblem(413).title).toBe("This file is over 10 MB");
    expect(uploadProblem(415).byHand).toBe(true);
    expect(uploadProblem(422).title).toBe("We couldn't accept this file");
    expect(uploadProblem(503)).toMatchObject({ title: "Uploads are paused for a moment", action: "retry" });
    expect(uploadProblem(429).title).toBe("You've uploaded a lot of files recently");
    expect(uploadProblem(500).title).toBe("The upload didn't finish");
  });
});

describe("read failures", () => {
  it("matches the server's messages to a title and actions", () => {
    expect(readFailure("This file is password-protected. Remove the password and upload it again.")).toMatchObject({
      title: "This file is locked",
      retry: false,
      upload: true,
    });
    expect(readFailure("You've reached today's limit for reading resumes. Try again tomorrow.").retry).toBe(false);
    expect(readFailure("We're still reading your other resume. Try this one again when it's done.").retryAfter).toBe(30);
    expect(readFailure("You haven't agreed to let Clew's AI read your resume.").consent).toBe(true);
    expect(readFailure("Something new").title).toBe("We couldn't read this resume");
    expect(readFailure(null).retry).toBe(true);
  });
});

describe("check flags", () => {
  it("turns parser paths into form field ids", () => {
    expect(checkFieldId("basics.location.city")).toBe("basics.location.city");
    expect(checkFieldId("work[2].position")).toBe("work.2.position");
    expect(fieldPlace("work.2.position")).toEqual({ section: "work", index: 2 });
    expect(fieldPlace("basics.label")).toEqual({ section: "basics", index: null });
  });
});

describe("drafts", () => {
  const draft: ProfileData = {
    ...emptyProfile(),
    basics: {
      name: "Ariadne Testuser",
      label: "Thread Engineer",
      location: { city: "Austin", region: "TX" },
      profiles: [],
    },
    work: [{ name: "Labyrinth Logistics", position: "Maze Mapper", highlights: [] }],
    skills: [{ name: "Knots", keywords: [] }],
  };

  it("counts the sections that have something in them", () => {
    expect(sectionsFound(draft)).toBe(3);
    expect(sectionsFound(emptyProfile())).toBe(0);
  });

  it("fills only what is still empty", () => {
    const mine: ProfileData = {
      ...emptyProfile(),
      basics: { name: "A. Testuser", label: "", location: { city: "Denver" }, profiles: [] },
    };
    const filled = fillBlanks(mine, draft);
    expect(filled.basics?.name).toBe("A. Testuser");
    expect(filled.basics?.label).toBe("Thread Engineer");
    expect(filled.basics?.location).toEqual({ city: "Denver", region: "TX" });
    expect(filled.work).toEqual(draft.work);
    expect(fillBlanks({ ...mine, work: [{ name: "Mine", highlights: [] }] }, draft).work).toEqual([{ name: "Mine", highlights: [] }]);
  });
});

describe("preferences text", () => {
  it("reads places and lists", () => {
    expect(parseLocation("Austin, TX")).toEqual({ city: "Austin", region: "TX" });
    expect(parseLocation(" Texas ")).toEqual({ city: null, region: "Texas" });
    expect(parseLocation("  ")).toBeNull();
    expect(locationText({ city: null, region: "CO" })).toBe("CO");
    expect(listFrom("Maze Mapper, Guide\nmaze mapper\n\n", { commas: true })).toEqual(["Maze Mapper", "Guide"]);
    expect(listFrom("Austin, TX\nCO")).toEqual(["Austin, TX", "CO"]);
  });
});
