/**
 * The job sites the extension can fill (#130 step 3). Each needs its own host permission,
 * asked for only when the user turns that site on, and nothing runs on a site until the user
 * presses Fill in the popup.
 */

export type SiteId = "linkedin";

export type Site = {
  id: SiteId;
  name: string;
  /** The optional host permission Chrome asks the user for. */
  origin: string;
  /** The content script, injected only when the user presses Fill. */
  script: string;
  /** True for the pages where the site's own profile edit forms open. */
  isProfilePage: (url: URL) => boolean;
};

export const SITES: Record<SiteId, Site> = {
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    origin: "https://www.linkedin.com/*",
    script: "content/linkedin.js",
    // The member's own profile and its edit forms all live under /in/<name>/.
    isProfilePage: (url) => url.protocol === "https:" && url.host === "www.linkedin.com" && /^\/in\/[^/]+/.test(url.pathname),
  },
};

/** The site whose profile page this is, if it's one the extension fills. */
export function siteForUrl(url: string | undefined): Site | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return Object.values(SITES).find((site) => site.isProfilePage(parsed)) ?? null;
}
