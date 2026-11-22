/**
 * What every site's form list is made of, and the helpers they share. A site's forms are found
 * by what a person reads on them (the form's heading and each box's label), not by the site's
 * internal class names. When a site changes a label, that field shows "Not found on this form"
 * and nothing else is touched.
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
  kind: string;
  /** What the form is for, in the panel's heading. */
  title: string;
  heading: RegExp;
  section: Section;
  parts: PartSpec[];
};

/** One site's forms and the panel's words for it. */
export type SiteForms = {
  name: string;
  /** How to open an edit form there, e.g. "press a pencil, or Add". */
  howToOpen: string;
  /** What Clew fills there, e.g. "your intro, about, experience and education". */
  covers: string;
  forms: FormSpec[];
};

export function byLabel(...names: string[]): PartSpec["fill"] {
  return (form, value) => {
    const control = findByLabel(form, names);
    return control ? fillControl(control, value) : false;
  };
}

/** A long text box: by its label, else the form's only multi-line box. */
export function longText(...names: string[]): PartSpec["fill"] {
  return (form, value) => {
    const box = findByLabel(form, names) ?? onlyTextarea(form);
    if (!box || box instanceof HTMLSelectElement) return false;
    setText(box, value);
    return true;
  };
}

export function dates(startNames: string[], endNames: string[]): PartSpec["fill"] {
  return (form, value) => {
    const range = parseDates(value);
    if (!range) return false;
    let filled = false;
    if (range.start) {
      const start = findDateSelects(form, startNames);
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

/** Reminds the user to tick the site's "current" box when a date range runs to the present. */
export function presentNote(site: string, what: string): PartSpec["note"] {
  return (value) => (parseDates(value)?.end === "present" ? `Tick "${what}" on ${site} if it isn't ticked.` : null);
}

function headingOf(container: Element): string {
  const labelledBy = container.getAttribute("aria-labelledby");
  const labelled = labelledBy ? container.ownerDocument.getElementById(labelledBy) : null;
  const text = (labelled ?? container.querySelector("h1, h2, h3"))?.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The edit form open on the page, if it's one of `forms`: an open dialog first, else (for
 * sites whose edit forms are whole pages) the page's main content.
 */
export function openForm(doc: Document, forms: FormSpec[]): { spec: FormSpec; form: Element } | null {
  const containers = [...doc.querySelectorAll("[role='dialog'], dialog[open]")];
  const main = doc.querySelector("main, [role='main']");
  if (main) containers.push(main);
  for (const container of containers) {
    const heading = headingOf(container);
    const spec = forms.find((f) => f.heading.test(heading));
    if (spec) return { spec, form: container };
  }
  return null;
}
