import type { components } from "../api/schema";

export type Application = components["schemas"]["ApplicationOut"];
export type Status = components["schemas"]["ApplicationStatus"];

/** Board columns. Closed holds both rejected and withdrawn applications (TRK-01). */
export type Column = "saved" | "applied" | "interview" | "offer" | "closed";

export const COLUMNS: readonly { id: Column; label: string; empty: string }[] = [
  { id: "saved", label: "Saved", empty: "Save a job from your feed to keep it here." },
  { id: "applied", label: "Applied", empty: "Jobs you've applied to show up here." },
  { id: "interview", label: "Interview", empty: "Move a card here when you get an interview." },
  { id: "offer", label: "Offer", empty: "The way out of the maze. Offers land here." },
  { id: "closed", label: "Closed", empty: "Rejected and withdrawn applications end up here." },
];

/** The Status select's choices, in order (TRK-03). */
export const STATUS_CHOICES: readonly { value: Status; label: string }[] = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Closed: rejected" },
  { value: "withdrawn", label: "Closed: withdrawn" },
];

export function columnOf(status: Status): Column {
  return status === "rejected" || status === "withdrawn" ? "closed" : status;
}

export function columnLabel(column: Column): string {
  return COLUMNS.find((c) => c.id === column)?.label ?? column;
}

/** The pill on a closed card: which kind of closed it is (TRK-01b). */
export function closedLabel(status: Status): string | null {
  if (status === "rejected") return "Rejected";
  if (status === "withdrawn") return "Withdrawn";
  return null;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function shortDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso));
}

/** The date of the latest step, such as "applied Nov 2". */
export function stepText(app: Application): string {
  if (app.closed_at) return `${app.status === "rejected" ? "rejected" : "withdrawn"} ${shortDate(app.closed_at)}`;
  if (app.applied_at && app.status !== "saved") return `applied ${shortDate(app.applied_at)}`;
  return `saved ${shortDate(app.created_at)}`;
}

/** What was sent: "Sent: resume.pdf, version 7" (TRK-04). Null when nothing is recorded. */
export function sentText(app: Application): string | null {
  const parts: string[] = [];
  if (app.resume_name) parts.push(app.resume_deleted ? `${app.resume_name} (deleted)` : app.resume_name);
  if (app.profile_version) parts.push(`version ${app.profile_version}`);
  return parts.length ? `Sent: ${parts.join(", ")}` : null;
}

/** The card's one line that matters for its column. */
export function cardLine(app: Application): string | null {
  const column = columnOf(app.status);
  if (column === "applied" || column === "offer") return sentText(app);
  if (column === "interview") return app.notes.split("\n").find((line) => line.trim())?.trim() ?? null;
  return null;
}

/** A date input's "YYYY-MM-DD" as midday UTC, so no time zone moves it to another day. */
export function dateToIso(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : undefined;
}

export function byNewest(a: Application, b: Application): number {
  return b.updated_at.localeCompare(a.updated_at);
}

/** The line under the board's title, such as "5 active, 2 interviews". Closed cards don't count. */
export function summaryOf(byColumn: ReadonlyMap<Column, readonly unknown[]>): string {
  const count = (column: Column) => byColumn.get(column)?.length ?? 0;
  const active = count("saved") + count("applied") + count("interview") + count("offer");
  const interviews = count("interview");
  const offers = count("offer");
  const parts = [`${active} active`];
  if (interviews) parts.push(`${interviews} ${interviews === 1 ? "interview" : "interviews"}`);
  if (offers) parts.push(`${offers} ${offers === 1 ? "offer" : "offers"}`);
  return parts.join(", ");
}
