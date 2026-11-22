/**
 * Indeed's profile edit forms (profile.indeed.com). They may open as a dialog or as their own
 * page; either way they're found by heading and labels.
 */

import { choose, findByLabel, normalizeLabel, setText } from "./fill";
import { byLabel, dates, longText, presentNote, type PartSpec, type SiteForms } from "./forms";

// Common short forms, so "BS" can pick Indeed's "Bachelor's" from its list.
const LEVELS: [RegExp, string][] = [
  [/^(ba|bs|bsc|bfa|bachelor)/, "bachelor"],
  [/^(ma|ms|msc|mba|mfa|master)/, "master"],
  [/^(phd|doctor|md|jd|edd)/, "doctor"],
  [/^(aa|as|aas|associate)/, "associate"],
  [/^(ged|high school|diploma)/, "high school"],
];

/** The level-of-education list, matched loosely; a text box gets the value as it is. */
export const degreeLevel: PartSpec["fill"] = (form, value) => {
  const control = findByLabel(form, ["Level of education", "Degree"]);
  if (!control) return false;
  if (!(control instanceof HTMLSelectElement)) {
    setText(control, value);
    return true;
  }
  const want = normalizeLabel(value).replace(/[.']/g, "");
  const level = LEVELS.find(([pattern]) => pattern.test(want))?.[1] ?? want;
  return choose(control, (o) => {
    const text = normalizeLabel(o.textContent).replace(/[.']/g, "");
    return o.value !== "" && (text === want || text.startsWith(level));
  });
};

const FROM = ["From", "Start date"];
const TO = ["To", "End date"];

export const INDEED: SiteForms = {
  name: "Indeed",
  howToOpen: "press a pencil, or Add",
  covers: "your headline, summary, location, work experience and education",
  forms: [
    {
      kind: "headline",
      title: "Headline",
      heading: /^(add|edit) (resume )?headline\b/i,
      section: "basics",
      parts: [{ part: "headline", fill: byLabel("Headline", "Resume headline") }],
    },
    {
      kind: "summary",
      title: "Summary",
      heading: /^(add|edit) summary\b/i,
      section: "basics",
      parts: [{ part: "summary", fill: longText("Summary") }],
    },
    {
      kind: "contact",
      title: "Contact information",
      heading: /^(edit )?(contact information|location)\b/i,
      section: "basics",
      parts: [{ part: "location", fill: byLabel("City, state", "City", "Location") }],
    },
    {
      kind: "experience",
      title: "Work experience",
      heading: /^(add|edit) (work )?experience\b/i,
      section: "work",
      parts: [
        { part: "title", fill: byLabel("Job title", "Title") },
        { part: "company", fill: byLabel("Company") },
        { part: "dates", fill: dates(FROM, TO), note: presentNote("Indeed", "I currently work here") },
        { part: "duties", fill: longText("Description") },
      ],
    },
    {
      kind: "education",
      title: "Education",
      heading: /^(add|edit) education\b/i,
      section: "education",
      parts: [
        { part: "degree", fill: degreeLevel, note: () => "Check the level of education Indeed picked." },
        { part: "field", fill: byLabel("Field of study") },
        { part: "school", fill: byLabel("School", "School name") },
        { part: "dates", fill: dates(FROM, TO) },
      ],
    },
  ],
};
