# Home page redesign: plan

Branch: `developer/home-redesign`. Goal: a signed-in home that looks premium, feels alive, and is useful every visit. Today it shows "You're in." and one small "Add your resume" button on a wide empty page.

Rules that still apply (CLAUDE.md): tokens only (no raw hex in components), WCAG AA, phone layout, tests with every PR, made-up data only, no scraping, jobs only from official APIs / public ATS boards / alert emails, US only.

## What we found

- `apps/web/src/pages/HomePage.tsx` renders a 40rem column with an h1, one line and one button. Styles are `.home` in `styles.css`.
- The home page already fetches `/me`. The feed (`/feed`), applications (`/applications`), profile (`/profile`) and preferences (`/preferences`) endpoints exist, so most dashboard content needs no backend work.
- **Jobs have only a text `location` and `remote_type`. There are no coordinates.** The map needs geocoding on the backend (Phase 4).
- The home state should change with the user's progress: new user (no resume), profile done, active searching.

## Phase 0: Design direction (decide before coding)

- [x] Pick the look: dark indigo hero with coral glow and a lavender content area (recommended, matches the brand), or a fully light page.
- [ ] Sketch desktop and phone layouts of the home in the design doc (`docs/design/screens.md`, new "Home" section).
- [ ] Decide the motion rules: subtle entrance, hover lift, no motion if `prefers-reduced-motion`.
- [x] Confirm map provider (see Phase 4 options) and budget.

## Phase 1: Visual foundation (tokens and shell)

Status: done. Screenshots are in `docs/design/screenshots/home/`.

- [x] Add tokens: elevation scale (soft layered shadows), larger radii, a gradient (indigo to ink-700 with a coral glow), glass/blur surface for the hero card.
- [x] Type scale: bigger Syne display size for the greeting (clamp-based, fluid), tighter tracking.
- [x] Rebuild the app header: sticky, slim, blur on scroll, avatar menu instead of an email plus a Sign out button.
- [x] Wider page container (about 72rem) with a 12-column grid on desktop, one column on phone.
- [x] Run `npm run build` in `packages/design-tokens`; keep contrast tests passing.

## Phase 2: Home v1 (no backend changes)

Status: built, not yet looked at in a browser. Needs a visual pass with real Clerk keys. The map card was a "Coming soon" teaser until Phase 4.

- [x] **Hero**: personal greeting ("Good morning, Sam"), one-line status, and a large primary action sized for the page (not a small button). Includes the Clew yarn art as a decorative background (`aria-hidden`).
- [x] **Setup checklist card** for new users: Add resume, Review profile, Set preferences, Install add-on (disabled until it exists). Progress ring plus a big "Add your resume" drop-zone card that links to `/onboarding/upload`.
- [x] **Stat tiles** (once the user has data): new matches today, saved jobs, applications in progress, interviews.
- [x] **Top matches strip**: 3 to 5 job cards from `/feed` with fit score, company, location, one-click save.
- [x] **Application pipeline** mini board: counts per status with a link to `/applications`.
- [x] **Empty, loading and error states** for every block (skeleton shimmer, not spinners).
- [x] Different layouts for: no resume, resume but no preferences, fully set up.
- [x] Keep the existing error states (`email_required`, 503, generic) working.

## Phase 3: Polish

Status: done. Notes are in `docs/design/home-benchmarks.md`.

- [x] Micro-interactions: card hover lift, progress ring animation, count-up on stat tiles (all off under reduced motion).
- [x] Illustrations/empty-state art in brand style (needles, yarn, maze motif from `MazeArt`).
- [x] Dark-hero and light-section contrast check; keyboard focus order; screen-reader landmarks and headings.
- [x] Phone layout pass at 360px and 390px widths.
- [x] Compare against 3 or 4 best-in-class dashboards (Linear, Notion, Teal, Huntr) and note what we match or beat.

## Phase 4: Jobs map (the big feature)

User opens Home and sees a map centered on their location, with pins for jobs near them in their preferred roles.

Status: built in #122 (geocoding) and the step 5 PR (endpoint and map card). Tiles could not be fetched from the build sandbox, so the screenshots show pins on the plain indigo background; check the full map locally.

- [x] **Map library and tiles:** MapLibre GL (BSD-3) with OpenFreeMap vector tiles (free, no key or account), styled indigo with coral pins.
- [x] **Backend geocoding**: `lat`/`lng`/`geocode_status` on catalog jobs, from a committed GeoNames table of US places (no runtime geocoder, so R19 holds). Remote jobs with no city get no pin.
- [x] **Backend endpoint**: `GET /feed/map` returns up to 300 compact pins, best fit first, with the same filters as the feed (dealbreakers, dismissed jobs, R28 unverified boards). It takes no location; the map centers on the first saved place.
- [x] **User location**: "Near me" asks the browser only on a press, rounds to about 1 km at once, and uses it only in the browser (center the map, sort the list). It is never sent to the API, stored or logged.
- [x] **Frontend**: map card on Home with clustered pins, a React card for the picked pin linking to the job, and a Map/List toggle. Without WebGL, the list is shown.
- [ ] Privacy review (Security wakes for this one: personal data, plus a new runtime dependency).
- [x] Performance: the map library loads in its own chunk, only when the map is shown.
- [ ] Before launch: GeoNames and OpenStreetMap credit on the about or privacy page; re-geocode `not_found` jobs after the place table is rebuilt.

## Phase 5: Idea parking lot (not scheduled)

- [ ] Daily digest card ("3 new roles match you").
- [ ] Salary insight tiles per role and city.
- [ ] Commute-time rings on the map.
- [ ] Follow-up reminders on stale applications.
- [ ] Resume strength score with suggestions.
- [ ] Saved searches with map areas.

## Suggested PR order

1. Design doc and tokens (Phase 0, 1).
2. Header and hero with the big resume call to action (Phase 2, first part).
3. Dashboard blocks (Phase 2, rest).
4. Polish (Phase 3).
5. Geocoding backend (Phase 4, backend).
6. Map UI (Phase 4, frontend).

Each PR: tests included, linked to its backlog item, Reviewer verdict (plus Security for the map PRs).
