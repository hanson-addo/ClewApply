import type { components } from "../api/schema";

export type FeedJob = components["schemas"]["FeedJob"];
export type FeedPage = components["schemas"]["FeedPage"];
export type JobDetail = components["schemas"]["JobDetail"];

/** A short note at the bottom of the screen, with an optional Undo. */
export type Toast = { message: string; undo?: () => void };

export const PAGE_SIZE = 25;
export const DESCRIPTION_PREVIEW = 600;

export type WorkType = "remote" | "not-remote";
export type Source = "greenhouse" | "lever" | "ashby" | "usajobs" | "email";

export type Filters = {
  work?: WorkType;
  region?: string;
  minSalary?: number;
  postedWithin?: 1 | 7 | 30;
  source?: Source;
};

export const SOURCES: readonly Source[] = ["greenhouse", "lever", "ashby", "usajobs", "email"];
export const POSTED_WITHIN = [1, 7, 30] as const;

const SOURCE_NAMES: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  usajobs: "USAJobs",
  email: "Job alert email",
};

/** Sites that are the employer's own job board. */
const EMPLOYER_BOARDS = new Set(["greenhouse", "lever", "ashby"]);

export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

/**
 * Filters from the page's address. Only filter values live there, never profile data, so a
 * bookmarked or shared link carries nothing personal. Unknown or malformed values are ignored.
 */
export function readFilters(params: URLSearchParams): Filters {
  const filters: Filters = {};
  const work = params.get("work");
  if (work === "remote" || work === "not-remote") filters.work = work;
  const region = params.get("state")?.trim();
  if (region && /^[A-Za-z .]{2,40}$/.test(region)) filters.region = region;
  const salary = Number(params.get("min_pay"));
  if (Number.isInteger(salary) && salary > 0 && salary <= 2_000_000) filters.minSalary = salary;
  const within = Number(params.get("posted"));
  const days = POSTED_WITHIN.find((d) => d === within);
  if (days) filters.postedWithin = days;
  const source = SOURCES.find((s) => s === params.get("source"));
  if (source) filters.source = source;
  return filters;
}

export function writeFilters(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.work) params.set("work", filters.work);
  if (filters.region) params.set("state", filters.region);
  if (filters.minSalary) params.set("min_pay", String(filters.minSalary));
  if (filters.postedWithin) params.set("posted", String(filters.postedWithin));
  if (filters.source) params.set("source", filters.source);
  return params;
}

export function countFilters(filters: Filters): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/** The feed API's query for these filters and page. */
export function feedQuery(filters: Filters, page: number) {
  return {
    remote: filters.work === undefined ? undefined : filters.work === "remote",
    region: filters.region,
    min_salary: filters.minSalary,
    posted_within_days: filters.postedWithin,
    source: filters.source,
    page,
    per_page: PAGE_SIZE,
  };
}

/**
 * A link from an outside feed, only if it is plain http or https. Anything else
 * (javascript:, data:, mailto: and so on) is never made clickable.
 */
export function safeUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

/** The host shown under the Apply button, so a look-alike link is visible before a click. */
export function domainOf(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

export function applyLabel(job: FeedJob): string {
  // An unverified board may not be the company's own, so never call it "their site" (R28).
  if (EMPLOYER_BOARDS.has(job.apply_source) && !job.unverified_board) return `Apply on ${job.company}'s site`;
  if (job.apply_source === "usajobs") return "Apply on USAJobs";
  const url = safeUrl(job.apply_url);
  return url ? `Apply on ${domainOf(url)}` : "Apply";
}

function short(amount: number): string {
  return amount >= 1000 ? `$${Math.round(amount / 1000)}k` : `$${amount}`;
}

export function salaryText(job: Pick<FeedJob, "salary_min" | "salary_max">): string | null {
  const low = job.salary_min ?? null;
  const high = job.salary_max ?? null;
  if (low !== null && high !== null && low !== high) return `${short(low)} to ${short(high)}`;
  const one = high ?? low;
  return one === null ? null : short(one);
}

export function placeText(job: Pick<FeedJob, "location" | "remote_type">): string {
  if (job.location) return job.location;
  if (job.remote_type === "remote") return "Remote";
  return "Location not listed";
}

/** The card's screen-reader name: title first, then the rest. */
export function cardName(job: FeedJob): string {
  const parts = [job.title, job.company, placeText(job)];
  const salary = salaryText(job);
  if (salary) parts.push(salary);
  parts.push(`fit ${job.fit_score} of 100`);
  if (job.unverified_board) parts.push("unverified board");
  return parts.join(", ");
}
