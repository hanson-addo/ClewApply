import type { components } from "../api/schema";
import { columnOf, type Application, type Column } from "../applications/model";

export type FeedJob = components["schemas"]["FeedJob"];
export type Preferences = components["schemas"]["PreferencesOut"];

export type Step = {
  id: "resume" | "preferences" | "jobs";
  title: string;
  hint: string;
  to: string;
  done: boolean;
};

export type Progress = { steps: Step[]; doneCount: number; complete: boolean };

/** The part of the day, for the greeting. */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** A first name for the greeting: the profile's name, else nothing (we never guess from an email). */
export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function hasPreferences(prefs: Preferences | null): boolean {
  if (!prefs) return false;
  return prefs.titles.length > 0 || prefs.locations.length > 0 || prefs.seniority.length > 0;
}

/** The setup checklist. A step is done only when we know it is; unknown counts as not done. */
export function setupProgress(
  hasProfile: boolean,
  prefs: Preferences | null,
  /** Saved jobs and applications, or null when they couldn't be loaded. */
  tracked: number | null = null,
): Progress {
  const prefsDone = hasPreferences(prefs);
  const steps: Step[] = [
    {
      id: "resume",
      title: "Add your resume",
      hint: "Clew reads it and builds your master profile.",
      to: "/onboarding/upload",
      done: hasProfile,
    },
    {
      id: "preferences",
      title: "Say what you're looking for",
      hint: "Roles, places and pay, so your feed fits.",
      to: "/onboarding/preferences",
      done: prefsDone,
    },
    {
      id: "jobs",
      title: "Save a job you like",
      hint: "Your feed ranks every job by fit. Saved jobs show up in Applications.",
      to: "/jobs",
      // Done once something is saved or tracked, not just because setup is finished.
      done: (tracked ?? 0) > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length };
}

export type PipelineCounts = Record<Column, number>;

export function pipelineCounts(apps: readonly Application[]): PipelineCounts {
  const counts: PipelineCounts = { saved: 0, applied: 0, interview: 0, offer: 0, closed: 0 };
  for (const app of apps) counts[columnOf(app.status)] += 1;
  return counts;
}

/** Applications that are still moving: not closed. */
export function activeCount(counts: PipelineCounts): number {
  return counts.saved + counts.applied + counts.interview + counts.offer;
}

/** A short line under the greeting that reflects where the user is. */
export function statusLine(hasProfile: boolean, counts: PipelineCounts, matches: number): string {
  if (!hasProfile) return "Add your resume and Clew turns it into your profile.";
  if (counts.interview > 0)
    return `You have ${counts.interview} ${counts.interview === 1 ? "interview" : "interviews"} in progress.`;
  if (matches > 0) return `${matches} ${matches === 1 ? "job matches" : "jobs match"} you right now.`;
  return "Your profile is ready. New jobs land here as they're posted.";
}

/** Pay as a short range, such as "$120k to $150k". Null when the posting has none. */
export function payText(job: Pick<FeedJob, "salary_min" | "salary_max">): string | null {
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  const { salary_min: min, salary_max: max } = job;
  if (min && max) return min === max ? k(min) : `${k(min)} to ${k(max)}`;
  if (min) return `From ${k(min)}`;
  if (max) return `Up to ${k(max)}`;
  return null;
}
