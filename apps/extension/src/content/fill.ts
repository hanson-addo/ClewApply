/**
 * Putting values into a site's own form, the way typing would. Nothing here reads what the
 * user already typed: only whether a box exists and can be edited. Nothing here clicks a
 * button, submits a form or navigates (product rule: the user presses Save).
 */

export type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const TEXT_INPUTS = new Set(["text", "search", ""]);

/** "Company name*" and "Company name (required)" both read as "company name". */
export function normalizeLabel(text: string | null): string {
  return (text ?? "")
    .replace(/\*|\(required\)|required/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEditable(element: Element | null | undefined): element is Control {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLSelectElement) return !element.disabled;
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUTS.has(element.type) && !element.disabled && !element.readOnly;
  }
  return false;
}

/** The editable box in `root` whose label (or aria-label) is one of `names`. */
export function findByLabel(root: ParentNode, names: string[]): Control | null {
  const wanted = new Set(names.map(normalizeLabel));
  for (const label of root.querySelectorAll("label")) {
    if (!wanted.has(normalizeLabel(label.textContent))) continue;
    const control = label.control ?? label.querySelector("input, textarea, select");
    if (isEditable(control)) return control;
  }
  for (const control of root.querySelectorAll("input, textarea, select")) {
    if (wanted.has(normalizeLabel(control.getAttribute("aria-label"))) && isEditable(control)) return control;
  }
  return null;
}

/** The only editable multi-line box in `root`, if there is exactly one. */
export function onlyTextarea(root: ParentNode): HTMLTextAreaElement | null {
  const boxes = [...root.querySelectorAll("textarea")].filter(isEditable);
  return boxes.length === 1 ? (boxes[0] as HTMLTextAreaElement) : null;
}

function fire(control: Control): void {
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Sets a box's value through the element's own setter, so frameworks that track the value
 * (React and others) see the change, then fires the events typing would.
 */
export function setText(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(control, value);
  fire(control);
}

/** Picks the first option `matches` accepts. False when none does. */
export function choose(select: HTMLSelectElement, matches: (option: HTMLOptionElement) => boolean): boolean {
  const option = [...select.options].find((o) => !o.disabled && matches(o));
  if (!option) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, option.value);
  fire(select);
  return true;
}

/** Fills a text box or picks a select option by its text. False when that can't be done. */
export function fillControl(control: Control, value: string): boolean {
  if (control instanceof HTMLSelectElement) {
    const want = normalizeLabel(value);
    return choose(control, (o) => normalizeLabel(o.textContent) === want);
  }
  setText(control, value);
  return true;
}

// --- dates ----------------------------------------------------------------------------------

export type YearMonth = { year: string; month: number | null };
export type DateRange = { start: YearMonth | null; end: YearMonth | "present" | null };

const DATE = String.raw`(\d{4})(?:-(\d{2}))?(?:-\d{2})?`;
const RANGE = new RegExp(String.raw`^(?:${DATE} )?to (?:${DATE}|(present))$`);

/** Clew's "2021-03 to present" (see backend sync/sites.py `_dates`). */
export function parseDates(value: string): DateRange | null {
  const m = RANGE.exec(value.trim());
  if (!m) return null;
  const [, startYear, startMonth, endYear, endMonth, present] = m;
  const ym = (year: string | undefined, month: string | undefined): YearMonth | null =>
    year ? { year, month: month ? Number(month) : null } : null;
  return { start: ym(startYear, startMonth), end: present ? "present" : ym(endYear, endMonth) };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function isMonthSelect(select: HTMLSelectElement): boolean {
  return [...select.options].some((o) => normalizeLabel(o.textContent).startsWith("jan"));
}

function isYearSelect(select: HTMLSelectElement): boolean {
  return [...select.options].some((o) => /^\d{4}$/.test(normalizeLabel(o.textContent)));
}

/**
 * The month and year selects for "Start date" or "End date": the group (a fieldset with that
 * legend, or an element labelled by that text) holding one month select and one year select.
 */
export function findDateSelects(
  root: ParentNode,
  names: string[],
): { month: HTMLSelectElement | null; year: HTMLSelectElement } | null {
  const wanted = new Set(names.map(normalizeLabel));
  const groups: Element[] = [];
  for (const legend of root.querySelectorAll("legend")) {
    if (wanted.has(normalizeLabel(legend.textContent)) && legend.parentElement) groups.push(legend.parentElement);
  }
  for (const group of root.querySelectorAll("[aria-label]")) {
    if (wanted.has(normalizeLabel(group.getAttribute("aria-label")))) groups.push(group);
  }
  for (const group of groups) {
    const selects = [...group.querySelectorAll("select")].filter((s) => !s.disabled);
    const year = selects.find(isYearSelect);
    if (year) return { month: selects.find(isMonthSelect) ?? null, year };
  }
  return null;
}

/** Picks the month and year. False when the year (or a needed month) has no option. */
export function fillDate(selects: { month: HTMLSelectElement | null; year: HTMLSelectElement }, date: YearMonth): boolean {
  if (date.month !== null && selects.month) {
    const name = MONTHS[date.month - 1] ?? "";
    const picked = choose(selects.month, (o) => {
      const text = normalizeLabel(o.textContent);
      return text === name || text === name.slice(0, 3) || o.value === String(date.month);
    });
    if (!picked) return false;
  }
  return choose(selects.year, (o) => normalizeLabel(o.textContent) === date.year);
}
