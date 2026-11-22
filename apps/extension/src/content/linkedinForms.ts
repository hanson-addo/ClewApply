/**
 * LinkedIn's profile edit forms, found by what a person reads on them (the dialog's heading
 * and each box's label), not by LinkedIn's internal class names. When LinkedIn changes a
 * label, that field shows "Not found on this form" and nothing else is touched.
 */

import { fillControl, fillDate, findByLabel, findDateSelects, onlyTextarea, parseDates, setText } from "./fill";

export type Section = "basics" | "work" | "education";

export type PartSpec = {
  part: string;
  /** Puts the value in; false when the box isn't on this form. */
  fill: (form: Element, value: string) => boolean;
  /** Something the user still has to do after this part is filled. */
  note?: (value: string) => string | null;
};

export type FormSpec = {
  kind: "intro" | "about" | "position" | "education";
  /** What the form is for, in the panel's heading. */
  title: string;
  heading: RegExp;
  section: Section;
  parts: PartSpec[];
};

function byLabel(...names: string[]): PartSpec["fill"] {
  return (form, value) => {
    const control = findByLabel(form, names);
    return control ? fillControl(control, value) : false;
  };
}

function about(form: Element, value: string): boolean {
  const box = findByLabel(form, ["About", "Description", "Summary"]) ?? onlyTextarea(form);
  if (!box || box instanceof HTMLSelectElement) return false;
  setText(box, value);
  return true;
}

function dates(endNames: string[]): PartSpec["fill"] {
  return (form, value) => {
    const range = parseDates(value);
    if (!range) return false;
    let filled = false;
    if (range.start) {
      const start = findDateSelects(form, ["Start date"]);
      if (!start || !fillDate(start, range.start)) return false;
      filled = true;
    }
    if (range.end && range.end !== "present") {
      const end = findDateSelects(form, endNames);
      if (!end || !fillDate(end, range.end)) return false;
      filled = true;
    }
    return filled;
  };
}

function presentNote(what: string): PartSpec["note"] {
  return (value) => (parseDates(value)?.end === "present" ? `Tick "${what}" on LinkedIn if it isn't ticked.` : null);
}

export const LINKEDIN_FORMS: FormSpec[] = [
  {
    kind: "intro",
    title: "Intro",
    heading: /^edit intro\b/i,
    section: "basics",
    parts: [
      { part: "headline", fill: byLabel("Headline") },
      {
        part: "location",
        fill: byLabel("City", "Location"),
        note: () => "Pick the matching place from LinkedIn's list under City.",
      },
    ],
  },
  {
    kind: "about",
    title: "About",
    heading: /^(add|edit) (about|summary)\b/i,
    section: "basics",
    parts: [{ part: "about", fill: about }],
  },
  {
    kind: "position",
    title: "Experience",
    heading: /^(add|edit) (experience|position)\b/i,
    section: "work",
    parts: [
      { part: "title", fill: byLabel("Title") },
      {
        part: "company",
        fill: byLabel("Company name", "Company or organization", "Company"),
        note: () => "If LinkedIn suggests the company, pick it from the list.",
      },
      { part: "dates", fill: dates(["End date"]), note: presentNote("I am currently working in this role") },
    ],
  },
  {
    kind: "education",
    title: "Education",
    heading: /^(add|edit) education\b/i,
    section: "education",
    parts: [
      { part: "school", fill: byLabel("School"), note: () => "If LinkedIn suggests the school, pick it from the list." },
      { part: "degree", fill: byLabel("Degree") },
      { part: "field", fill: byLabel("Field of study") },
      { part: "dates", fill: dates(["End date", "End date (or expected)"]) },
    ],
  },
];

function headingOf(dialog: Element): string {
  const labelledBy = dialog.getAttribute("aria-labelledby");
  const labelled = labelledBy ? dialog.ownerDocument.getElementById(labelledBy) : null;
  const text = (labelled ?? dialog.querySelector("h1, h2, h3"))?.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/** The LinkedIn edit form open on the page, if it's one Clew fills. */
export function openForm(doc: Document): { spec: FormSpec; form: Element } | null {
  for (const dialog of doc.querySelectorAll("[role='dialog'], dialog[open]")) {
    const heading = headingOf(dialog);
    const spec = LINKEDIN_FORMS.find((f) => f.heading.test(heading));
    if (spec) return { spec, form: dialog };
  }
  return null;
}
