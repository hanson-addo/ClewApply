import type { components } from "../api/schema";

export type ProfileData = components["schemas"]["ProfileData"];
export type ProfileVersion = components["schemas"]["ProfileVersionOut"];
export type VersionSummary = components["schemas"]["ProfileVersionSummary"];

/** How a field is edited. Lists of strings are edited as text: one per line, or comma-separated. */
export type FieldKind = "text" | "longtext" | "lines" | "csv" | "date" | "url" | "email" | "tel";

export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  autoComplete?: string;
  /** Spans both columns of the section's grid. */
  wide?: boolean;
};

export type ListSectionId = "work" | "education" | "skills" | "projects" | "certificates";
export type SectionId = "basics" | ListSectionId;

export type ListSection = {
  id: ListSectionId;
  /** The last part of the page's address: /profile/experience. */
  slug: string;
  title: string;
  /** Names one entry, for buttons: "Add a role", "Remove the Example Corp role". */
  noun: string;
  /** The field that names an entry in headings and button labels. */
  nameKey: string;
  fields: FieldSpec[];
};

const DATE_HINT = "Month and year, for example 2021-03";

export const BASICS_FIELDS: FieldSpec[] = [
  { key: "name", label: "Full name", kind: "text", autoComplete: "name" },
  { key: "label", label: "Headline", kind: "text", hint: "For example, Senior Software Engineer" },
  { key: "email", label: "Email", kind: "email", autoComplete: "email" },
  { key: "phone", label: "Phone", kind: "tel", autoComplete: "tel" },
  { key: "url", label: "Website", kind: "url", autoComplete: "url", hint: "Starts with https://" },
  { key: "location.city", label: "City", kind: "text", autoComplete: "address-level2" },
  { key: "location.region", label: "State", kind: "text", autoComplete: "address-level1" },
  { key: "location.postalCode", label: "ZIP code", kind: "text", autoComplete: "postal-code" },
  { key: "summary", label: "Summary", kind: "longtext", wide: true },
];

export const LIST_SECTIONS: ListSection[] = [
  {
    id: "work",
    slug: "experience",
    title: "Experience",
    noun: "role",
    nameKey: "name",
    fields: [
      { key: "position", label: "Title", kind: "text", autoComplete: "organization-title" },
      { key: "name", label: "Company", kind: "text", autoComplete: "organization" },
      { key: "location", label: "Location", kind: "text" },
      { key: "url", label: "Company website", kind: "url" },
      { key: "startDate", label: "Start", kind: "date", hint: DATE_HINT },
      { key: "endDate", label: "End", kind: "date", hint: DATE_HINT },
      {
        key: "highlights",
        label: "What you did",
        kind: "lines",
        hint: "One achievement per line",
        wide: true,
      },
    ],
  },
  {
    id: "education",
    slug: "education",
    title: "Education",
    noun: "school",
    nameKey: "institution",
    fields: [
      { key: "institution", label: "School", kind: "text" },
      { key: "studyType", label: "Degree", kind: "text", hint: "For example, B.S." },
      { key: "area", label: "Field of study", kind: "text" },
      { key: "score", label: "GPA or grade", kind: "text" },
      { key: "startDate", label: "Start", kind: "date", hint: DATE_HINT },
      { key: "endDate", label: "End", kind: "date", hint: DATE_HINT },
    ],
  },
  {
    id: "skills",
    slug: "skills",
    title: "Skills",
    noun: "skill",
    nameKey: "name",
    fields: [
      { key: "name", label: "Skill or group", kind: "text", hint: "For example, Languages" },
      { key: "level", label: "Level", kind: "text", hint: "Optional, for example Advanced" },
      {
        key: "keywords",
        label: "Details",
        kind: "csv",
        hint: "Separate with commas, for example Python, Go, SQL",
        wide: true,
      },
    ],
  },
  {
    id: "projects",
    slug: "projects",
    title: "Projects",
    noun: "project",
    nameKey: "name",
    fields: [
      { key: "name", label: "Project name", kind: "text" },
      { key: "url", label: "Link", kind: "url", hint: "Starts with https://" },
      { key: "startDate", label: "Start", kind: "date", hint: DATE_HINT },
      { key: "endDate", label: "End", kind: "date", hint: DATE_HINT },
      { key: "description", label: "Description", kind: "longtext", wide: true },
      { key: "keywords", label: "Tools", kind: "csv", hint: "Separate with commas", wide: true },
    ],
  },
  {
    id: "certificates",
    slug: "certificates",
    title: "Certificates",
    noun: "certificate",
    nameKey: "name",
    fields: [
      { key: "name", label: "Certificate", kind: "text" },
      { key: "issuer", label: "Issued by", kind: "text" },
      { key: "date", label: "Date", kind: "date", hint: DATE_HINT },
      { key: "url", label: "Link", kind: "url", hint: "Starts with https://" },
    ],
  },
];

export const SECTIONS: { id: SectionId; slug: string; title: string }[] = [
  { id: "basics", slug: "basics", title: "Basics" },
  ...LIST_SECTIONS.map(({ id, slug, title }) => ({ id, slug, title })),
];

/** What an entry is called: "Software Engineer at Cobalt Freight", or "Role 2" before it has one. */
export function entryName(section: ListSection, entry: Record<string, unknown>, index: number): string {
  const noun = section.noun.charAt(0).toUpperCase() + section.noun.slice(1);
  return entrySummary(section, entry) || `${noun} ${index + 1}`;
}

/** "today, 2:05 PM", or "Oct 18, 2026, 2:05 PM" for older versions. */
export function versionDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `today, ${time}`;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${day}, ${time}`;
}

/** Versions come newest first, so the oldest is version 1. */
export function versionNumber(versions: VersionSummary[], id: string): number {
  const index = versions.findIndex((v) => v.id === id);
  return index === -1 ? 0 : versions.length - index;
}

export function sectionBySlug(slug: string | undefined) {
  return SECTIONS.find((s) => s.slug === slug);
}

/** One line that names a closed entry: "Software Engineer at Cobalt Freight". */
export function entrySummary(section: ListSection, entry: Record<string, unknown>): string {
  const text = (key: string) => {
    const value = entry[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const join = (parts: string[], sep: string) => parts.filter(Boolean).join(sep);
  switch (section.id) {
    case "work":
      return join([text("position"), text("name")], " at ");
    case "education":
      return join([join([text("studyType"), text("area")], " "), text("institution")], ", ");
    case "certificates":
      return join([text("name"), text("issuer")], ", ");
    default:
      return text(section.nameKey);
  }
}

export function emptyProfile(): ProfileData {
  return {
    basics: { profiles: [] },
    work: [],
    volunteer: [],
    education: [],
    awards: [],
    certificates: [],
    publications: [],
    skills: [],
    languages: [],
    interests: [],
    projects: [],
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Entry = Record<string, unknown>;

/** Reads a dotted key ("location.city") as the text shown in its input. */
export function fieldText(entry: Entry | undefined, spec: FieldSpec): string {
  const value = getPath(entry, spec.key);
  if (Array.isArray(value)) return value.join(spec.kind === "csv" ? "," : "\n");
  return typeof value === "string" ? value : "";
}

/** Writes an input's text back. Lists keep their raw pieces so typing isn't disturbed;
 *  `cleanProfile` trims them and drops empty ones before saving. */
export function withFieldText(entry: Entry, spec: FieldSpec, text: string): Entry {
  let value: unknown = text;
  if (spec.kind === "lines") value = text.split("\n");
  if (spec.kind === "csv") value = text.split(",");
  if (spec.kind === "date" || spec.key === "location.countryCode") value = text;
  return setPath(entry, spec.key, value);
}

function getPath(entry: Entry | undefined, key: string): unknown {
  let current: unknown = entry;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Entry)[part];
  }
  return current;
}

function setPath(entry: Entry, key: string, value: unknown): Entry {
  const [head, ...rest] = key.split(".");
  if (head === undefined) return entry;
  if (rest.length === 0) return { ...entry, [head]: value };
  const child = entry[head];
  const childEntry = typeof child === "object" && child !== null ? (child as Entry) : {};
  return { ...entry, [head]: setPath(childEntry, rest.join("."), value) };
}

/** Trims every string, turns empty strings into "not set" and drops entries left empty, so
 *  what's saved (and compared for unsaved changes) has no stray blanks. */
export function cleanProfile(profile: ProfileData): ProfileData {
  return cleanValue(profile as unknown as Json) as unknown as ProfileData;
}

function cleanValue(value: Json): Json {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map(cleanValue)
      .filter((item) => item !== "" && item !== null && !isEmptyObject(item));
  }
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = cleanValue(item);
      if (cleaned === "" || cleaned === null) continue;
      if (isEmptyObject(cleaned) && key !== "basics") continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function isEmptyObject(value: Json): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) => item === null || item === "" || (Array.isArray(item) && item.length === 0),
  );
}

/** True when two profiles hold the same data, ignoring blanks and key order. */
export function sameProfile(a: ProfileData, b: ProfileData): boolean {
  return stableJson(cleanProfile(a)) === stableJson(cleanProfile(b));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([x], [y]) => x.localeCompare(y)))
      : item,
  );
}

// --- Validation: the same rules the API applies, with messages a person can act on. ----------

const DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const URL_RE = /^https?:\/\/\S+$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[0-9+()\-. x]*$/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_ALL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Pasted text can carry hidden characters the server refuses; drop them as they arrive. */
export function stripControl(text: string): string {
  return text.replace(CONTROL_ALL, "");
}

export const MAX_LENGTH: Record<FieldKind, number> = {
  text: 200,
  longtext: 5000,
  lines: 5000,
  csv: 200,
  date: 10,
  url: 500,
  email: 254,
  tel: 40,
};

/** Field ids are "<section>.<index>.<key>" or "basics.<key>"; they also name the inputs. */
export type FieldErrors = Record<string, string>;

export function fieldId(section: SectionId, index: number | null, key: string): string {
  return index === null ? `${section}.${key}` : `${section}.${index}.${key}`;
}

/** The DOM id for a field id: dots aren't handy in CSS selectors. */
export function inputId(id: string): string {
  return `profile-${id.replaceAll(".", "-")}`;
}

export function validateProfile(profile: ProfileData): FieldErrors {
  const errors: FieldErrors = {};
  const basics = (profile.basics ?? {}) as Entry;
  for (const spec of BASICS_FIELDS) {
    check(errors, fieldId("basics", null, spec.key), spec, fieldText(basics, spec));
  }
  for (const section of LIST_SECTIONS) {
    const entries = (profile[section.id] ?? []) as Entry[];
    entries.forEach((entry, index) => {
      for (const spec of section.fields) {
        check(errors, fieldId(section.id, index, spec.key), spec, fieldText(entry, spec));
      }
      const endId = fieldId(section.id, index, "endDate");
      const start = typeof entry.startDate === "string" ? entry.startDate.trim() : "";
      const end = typeof entry.endDate === "string" ? entry.endDate.trim() : "";
      if (!errors[endId] && endsBeforeStart(start, end)) {
        errors[endId] = "End date must be after the start date.";
      }
    });
  }
  return errors;
}

/** Compares only as precisely as both dates allow: 2021 and 2021-03 don't conflict. */
function endsBeforeStart(start: string, end: string): boolean {
  if (!DATE.test(start) || !DATE.test(end)) return false;
  const length = Math.min(start.length, end.length);
  return end.slice(0, length) < start.slice(0, length);
}

function check(errors: FieldErrors, id: string, spec: FieldSpec, raw: string): void {
  const pieces =
    spec.kind === "lines" ? raw.split("\n") : spec.kind === "csv" ? raw.split(",") : [raw];
  for (const piece of pieces.map((p) => p.trim()).filter(Boolean)) {
    const message = problem(spec, piece);
    if (message) {
      errors[id] = message;
      return;
    }
  }
}

function problem(spec: FieldSpec, value: string): string | null {
  if (CONTROL.test(value)) return "This has a hidden character in it. Retype it.";
  const max = MAX_LENGTH[spec.kind].toLocaleString("en-US");
  if (value.length > MAX_LENGTH[spec.kind]) {
    return spec.kind === "lines" || spec.kind === "csv"
      ? `Keep each item under ${max} characters.`
      : `Keep this under ${max} characters.`;
  }
  if (spec.kind === "date" && !DATE.test(value)) return "Enter a date as YYYY-MM, for example 2021-03.";
  if (spec.kind === "url" && !URL_RE.test(value)) return "Links must start with https:// or http://.";
  if (spec.kind === "email" && !EMAIL.test(value)) return "Enter an email like name@example.com.";
  if (spec.kind === "tel" && !PHONE.test(value)) {
    return "Use only numbers, spaces and + ( ) - . in a phone number.";
  }
  return null;
}

/** Turns the API's 422 detail into field errors, for anything the checks above missed. */
export function errorsFromApi(detail: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(detail)) return errors;
  for (const item of detail) {
    const loc = (item as { loc?: unknown }).loc;
    if (!Array.isArray(loc) || loc[0] !== "body" || loc[1] !== "data") continue;
    const [section, second, third] = loc.slice(2) as (string | number)[];
    if (section === undefined) continue;
    const id =
      typeof second === "number" && third !== undefined
        ? `${section}.${second}.${third}`
        : second !== undefined
          ? `${section}.${String(second)}`
          : String(section);
    errors[id] = "This doesn't look right. Check it and try again.";
  }
  return errors;
}

/** The section a field id belongs to, for jumping to it from the error summary. */
export function sectionOf(id: string): SectionId {
  const head = id.split(".")[0];
  return SECTIONS.some((s) => s.id === head) ? (head as SectionId) : "basics";
}

/** The label of a field id, for the error summary. */
export function labelOf(id: string): string {
  const [section, second, ...rest] = id.split(".");
  if (section === "basics") {
    return BASICS_FIELDS.find((f) => f.key === [second, ...rest].join("."))?.label ?? "A field";
  }
  const list = LIST_SECTIONS.find((s) => s.id === section);
  const field = list?.fields.find((f) => f.key === rest.join("."));
  if (!list || !field) return "A field";
  const noun = list.noun.charAt(0).toUpperCase() + list.noun.slice(1);
  return `${noun} ${Number(second) + 1}: ${field.label}`;
}
