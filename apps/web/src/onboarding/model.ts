import type { components } from "../api/schema";
import { fieldId, LIST_SECTIONS, type ProfileData, type SectionId } from "../profile/model";

export type Parse = components["schemas"]["ResumeParseOut"];
export type Consent = components["schemas"]["AiConsentOut"];
export type Preferences = components["schemas"]["Preferences"];

export const STEPS = ["Upload your resume", "Review your profile", "Job preferences", "Your jobs"];

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A problem shown in the upload card's danger panel (docs/design/screens.md, Error messages). */
export type UploadProblem = {
  title: string;
  body: string;
  action: "choose" | "retry";
  byHand: boolean;
};

const TOO_LARGE: UploadProblem = {
  title: "This file is over 10 MB",
  body: "Files must be 10 MB or smaller. Try saving it as a PDF without images, or remove extra pages.",
  action: "choose",
  byHand: false,
};
const WRONG_TYPE: UploadProblem = {
  title: "We can only read PDF and Word files",
  body: "Upload a PDF or Word (.docx) file. Pages, Google Docs and Word can all save one with File, Download or Save as.",
  action: "choose",
  byHand: true,
};
const FLAGGED: UploadProblem = {
  title: "We couldn't accept this file",
  body: "Our virus check flagged it, so it wasn't kept anywhere. Please try a different copy, ideally one you export fresh from your editor.",
  action: "choose",
  byHand: true,
};
const PAUSED: UploadProblem = {
  title: "Uploads are paused for a moment",
  body: "We can't check files for viruses right now, and we never keep a file we haven't checked. Try again in a few minutes.",
  action: "retry",
  byHand: true,
};
const TOO_MANY: UploadProblem = {
  title: "You've uploaded a lot of files recently",
  body: "Try again in an hour. Your earlier uploads are still saved.",
  action: "choose",
  byHand: true,
};
export const NETWORK: UploadProblem = {
  title: "The upload didn't finish",
  body: "Check your connection and try again. Nothing was saved.",
  action: "retry",
  byHand: false,
};

/** Checks a chosen file before sending it, so a 50 MB file fails at once. */
export function checkFile(file: { name: string; size: number }): UploadProblem | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return WRONG_TYPE;
  if (file.size > MAX_FILE_BYTES) return TOO_LARGE;
  return null;
}

/** The problem for an upload answer that isn't 201. */
export function uploadProblem(status: number): UploadProblem {
  if (status === 413) return TOO_LARGE;
  if (status === 415) return WRONG_TYPE;
  if (status === 422) return FLAGGED;
  if (status === 429) return TOO_MANY;
  if (status === 503) return PAUSED;
  return NETWORK;
}

/** What a failed read offers. The panel body is always the server's own message. */
export type ReadFailure = {
  title: string;
  upload: boolean;
  retry: boolean;
  /** Seconds before "Try again" is enabled. */
  retryAfter?: number;
  /** Links to the consent box instead of retrying. */
  consent?: boolean;
};

const FAILURES: [string, ReadFailure][] = [
  ["password-protected", { title: "This file is locked", upload: true, retry: false }],
  ["couldn't find any text", { title: "We couldn't find any text", upload: true, retry: false }],
  ["couldn't accept this file", { title: "We couldn't accept this file", upload: true, retry: false }],
  ["hasn't passed the virus check", { title: "Still checking this file", upload: false, retry: true }],
  ["Reading resumes is unavailable", { title: "Reading is paused for a moment", upload: false, retry: true }],
  [
    "still reading your other resume",
    { title: "Another resume is being read", upload: false, retry: true, retryAfter: 30 },
  ],
  ["today's limit", { title: "Daily limit reached", upload: false, retry: false }],
  [
    "haven't agreed to let Clew's AI",
    { title: "AI reading is off", upload: false, retry: false, consent: true },
  ],
  ["couldn't read this resume", { title: "We couldn't read this resume", upload: true, retry: true }],
];

export function readFailure(message: string | null | undefined): ReadFailure {
  const found = FAILURES.find(([words]) => message?.includes(words));
  return found ? found[1] : { title: "We couldn't read this resume", upload: false, retry: true };
}

/** "basics.location.city" and "work[0].position" from the parser, as profile field ids. */
export function checkFieldId(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

/** The section and entry a field id belongs to. */
export function fieldPlace(id: string): { section: SectionId; index: number | null } {
  const [section, second] = id.split(".");
  const index = Number(second);
  return {
    section: section as SectionId,
    index: Number.isInteger(index) && second !== "" ? index : null,
  };
}

/** How many profile sections have something in them, for "We found 5 sections". */
export function sectionsFound(profile: ProfileData): number {
  const basics = Object.values(profile.basics ?? {}).some((v) =>
    typeof v === "object" && v !== null ? Object.values(v).some(Boolean) : Boolean(v),
  );
  const lists = LIST_SECTIONS.filter((s) => (profile[s.id] ?? []).length > 0).length;
  return (basics ? 1 : 0) + lists;
}

/** Fills only the fields that are still empty, so typing done by hand is kept. */
export function fillBlanks(mine: ProfileData, draft: ProfileData): ProfileData {
  const basics = { ...(draft.basics ?? {}), ...withoutBlanks(mine.basics ?? {}) };
  const draftLocation = (draft.basics?.location ?? {}) as Record<string, unknown>;
  const myLocation = (mine.basics?.location ?? {}) as Record<string, unknown>;
  basics.location = { ...draftLocation, ...withoutBlanks(myLocation) };
  const next: ProfileData = { ...mine, basics: basics as ProfileData["basics"] };
  for (const { id } of LIST_SECTIONS) {
    if ((mine[id] ?? []).length === 0 && (draft[id] ?? []).length > 0) {
      (next as Record<string, unknown>)[id] = draft[id];
    }
  }
  return next;
}

function withoutBlanks(entry: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined && typeof v !== "object",
    ),
  );
}

/** A checked field's id when the form has an input for it. */
export function linkable(id: string): boolean {
  const { section } = fieldPlace(id);
  return section === "basics" || LIST_SECTIONS.some((s) => s.id === section);
}

export { fieldId };

/** Where the last uploaded resume is remembered, so leaving and coming back keeps it (UP-11). */
const RESUME_KEY = "clew.onboarding.resume";

export function rememberResume(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(RESUME_KEY, id);
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Storage can be blocked; the resume id is also in the address.
  }
}

export function rememberedResume(): string | null {
  try {
    return sessionStorage.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}

/** "Austin, TX" or "TX" as a preference location; null when no state is given. */
export function parseLocation(text: string): { city: string | null; region: string } | null {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { city: null, region: parts[0] as string };
  return { city: parts[0] as string, region: parts.slice(1).join(", ") };
}

export function locationText(location: { city?: string | null; region: string }): string {
  return location.city ? `${location.city}, ${location.region}` : location.region;
}

/** One entry per line (or per comma too, with `commas`), trimmed, without repeats. */
export function listFrom(text: string, { commas = false } = {}): string[] {
  const seen = new Set<string>();
  return text
    .split(commas ? /[\n,]/ : /\n/)
    .map((p) => p.trim())
    .filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
}
