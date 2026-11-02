# Clew phase 1: end-to-end test plan

Owner: QA. Status: draft for review. Source of truth for behavior: the [design doc](https://claude.ai/code/artifact/cd08badf-820c-494f-afd9-307e715d1171) and [mockups](https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D).

Phase 1 ("Foundation") covers five user journeys: sign in, resume upload, master profile, job feed, and application tracker. The browser add-on, Sync Center pushes and email alert import are phase 2 and 3; their regression plan is sketched at the end so test IDs and fixtures are ready when they land.

## 1. How we test

| Layer | Tool | Runs on |
| --- | --- | --- |
| End-to-end (this plan) | Playwright + TypeScript, Chromium in CI; Firefox and WebKit nightly | Every PR (smoke), nightly (full) |
| API contract | pytest against FastAPI with a test Postgres | Every PR (developer owns) |
| Accessibility | `@axe-core/playwright` on every screen in the E2E run | Every PR |
| Visual | Playwright screenshots at 1280px and 390px for each screen | Nightly, diffs reviewed by Designer |

Rules that apply to every test:

- **Made-up data only.** Fixtures use invented people ("Riley Test", `riley+e2e@example.test`). No real resumes or personal data, per CLAUDE.md.
- **No calls to real third-party sites.** USAJobs and Greenhouse/Lever/Ashby are replaced by recorded fixture responses served from a local stub. LinkedIn, Indeed and ZipRecruiter are never contacted.
- **No third-party passwords anywhere**, including fixtures and test logs.
- **Each test makes its own user** through a test-only seeding endpoint (enabled only when `CLEW_ENV=test`), so tests run in parallel and never depend on each other.
- **Stable selectors.** Tests find elements by role and accessible name first, `data-testid` second, never by CSS class or text that marketing may change.
- **Auth in tests.** Login is Clerk. Tests run against a Clerk development instance using Clerk's Playwright testing helpers (`@clerk/testing`, testing tokens to get past bot protection) and test emails such as `riley+clerk_test@example.test` with Clerk's fixed one-time code (`424242`), so no mailbox is needed and no email is actually sent. Google and LinkedIn sign-in are checked by hand weekly, since automating third-party consent screens is fragile.

## 2. Environments and test data

| Item | Value |
| --- | --- |
| App under test | `docker compose up` (web, api, postgres, redis, worker, job-source stub) |
| Base URL | `http://localhost:5173` (web), `http://localhost:8000` (api) |
| Job fixtures | `e2e/fixtures/jobs/`: 40 USAJobs results, 3 Greenhouse boards, 1 Lever, 1 Ashby, with 8 planted duplicate pairs and 2 near-misses that must *not* merge |
| Resume fixtures | `e2e/fixtures/resumes/`: `clean.pdf`, `clean.docx`, `two-column.pdf`, `scanned-image.pdf`, `empty.pdf`, `huge-11mb.pdf`, `exactly-10mb.pdf`, `10mb-plus-1.pdf`, `fake-pdf.exe`. The EICAR antivirus test file is never committed; UP-07 writes it to a temp file at test time so it can't trip GitHub, laptop or CI scanners |
| Expected parse | `e2e/fixtures/resumes/*.expected.json` in JSON Resume shape |

Priority key: **P0** blocks release and runs on every PR. **P1** runs nightly and blocks release if red. **P2** nightly, tracked but doesn't block.

## 3. Journeys and test cases

### 3.1 Sign in and accounts

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| AUTH-01 | P0 | New user signs up with a `+clerk_test` email and the fixed one-time code | Lands on Onboarding step 1; a `users` row exists with `plan = free` |
| AUTH-02 | P0 | Returning user signs in with a `+clerk_test` email and the fixed code | Lands on Job feed |
| AUTH-03 | P0 | Passkey registration offered after first login, then sign in with passkey | Uses Playwright's virtual WebAuthn authenticator; second sign-in needs no email |
| AUTH-04 | P1 | Continue with Google (manual weekly check) | Account created; name and email filled |
| AUTH-05 | P1 | Continue with LinkedIn (manual weekly check) | Name, headline and photo pre-filled in the profile |
| AUTH-06 | P0 | Session cookies, checked against Clerk's cookie model | `__client` (on Clerk's own domain) is `HttpOnly` and `Secure`. `__session` (on our domain) is `Secure` and `SameSite=Lax` and expires in 60 seconds or less; it is not HttpOnly because Clerk's SDK reads it. No Clerk or app tokens in `localStorage` or `sessionStorage`. Needs Security's agreement, since threat model R3 (#33) assumes HttpOnly app cookies |
| AUTH-07 | P1 | Session token refresh: stay idle on a page for 3 minutes, then act | The `__session` token value has changed at least once (Clerk refreshes it about every 60 seconds); the action succeeds and the user stays signed in. Also: the API rejects a captured `__session` token older than its expiry |
| AUTH-08 | P0 | Sign out | Cookies cleared; Back button shows sign-in, not cached pages |
| AUTH-09 | P1 | "Sign out everywhere" from Settings | A second browser context is signed out on its next request |
| AUTH-10 | P0 | Signed-out user opens `/jobs`, `/profile`, `/applications` | Redirected to sign-in, then back to the page they asked for |
| AUTH-11 | P0 | Cross-user access, applied as a pattern: user A tries to read, change or delete user B's records by ID on **every** per-user endpoint (profile, versions, resume files, applications, connections, sensitive answers), with a new case added as each endpoint lands | API returns 404; UI shows not-found. Covers the row-level security promise and threat model R1 |
| AUTH-12 | P1 | Wrong one-time code entered | Clear error and a "send a new code" button |
| AUTH-13 | P1 | Sign-in rate limit (10 bad attempts) | Further attempts blocked with a friendly message |
| AUTH-14 | P0 | Sign-in page copy | Shows "Clew never asks for your passwords" (or approved wording); no field asks for a job-site password |
| AUTH-15 | P2 | Re-authentication before data export or account deletion | Prompts for a passkey or a fresh one-time code first |

### 3.2 Resume upload and onboarding

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| UP-01 | P0 | Upload `clean.pdf` on Onboarding | 4-step progress advances; parsed profile matches `clean.expected.json` on name, email, every job title/company/date, and at least 90% of skills |
| UP-02 | P0 | Upload `clean.docx` | Same as UP-01 |
| UP-03 | P1 | Upload `two-column.pdf` | Fields parse; any low-confidence field shows a "Check this" flag |
| UP-04 | P1 | Upload `scanned-image.pdf` | Either parses via OCR or says it couldn't read the file and offers manual entry; never a blank profile with no message |
| UP-05 | P0 | Upload `huge-11mb.pdf` | Rejected with HTTP 413 and "Files must be 10 MB or smaller" |
| UP-05b | P0 | 10 MB boundary: upload `exactly-10mb.pdf` (10,485,760 bytes) and `10mb-plus-1.pdf` (10,485,761 bytes) | The first is accepted; the second gets HTTP 413 and "Files must be 10 MB or smaller" |
| UP-06 | P0 | Upload `fake-pdf.exe` renamed to `.pdf` | Rejected by content type check, not just extension |
| UP-07 | P0 | Upload an EICAR test file generated at test time | Rejected by malware scan; nothing stored; audit log entry written |
| UP-08 | P1 | Upload `empty.pdf` | Friendly error, offer manual entry |
| UP-09 | P0 | User edits a flagged field and finishes onboarding | Lands on Job feed; profile version 1 saved with the edit |
| UP-10 | P0 | Resume file download link | Is a signed URL that stops working after it expires; another user's session can't open it |
| UP-11 | P1 | Leave onboarding mid-way and come back | Resumes at the same step with uploaded data kept |
| UP-12 | P2 | Skip upload, enter profile by hand | Allowed; profile saved |
| UP-13 | P1 | Upload a `.txt`, `.rtf` or image file | Rejected with "PDF or Word only" |

### 3.2b Reading a resume (API)

Reading runs in the background worker after every upload (#71). In CI the worker talks to a local stand-in for the AI (`e2e/fake-anthropic.mjs`), so these need no AI key; RP-09 uses the real AI and runs only when a key is set. Spec: `e2e/tests/resume-parse-api.spec.ts`.

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| RP-01 | P0 | Upload a made-up text PDF, then poll `GET /resumes/{id}/parse` | Pending or running, then done; the draft profile holds the name from the file's text |
| RP-02 | P0 | Draft profile flags | A field with low confidence (or none) is listed in `check`; a confident one isn't |
| RP-03 | P0 | Password-protected PDF | Failed: "This file is password-protected. Remove the password and upload it again." |
| RP-04 | P0 | PDF with no text layer (scanned image) | Failed: "We couldn't find any text in this file…" |
| RP-05 | P1 | Word file whose text part is over 5 MB | Failed: "We couldn't read this resume…" |
| RP-06 | P1 | `POST /resumes/{id}/parse` after a failure; and on a finished read | Restarts (202, pending); a finished read is returned as it is |
| RP-07 | P0 | A second resume while one is still being read | The second is refused with "We're still reading your other resume…"; `POST` gets 429; it can be read once the first is done |
| RP-08 | P0 | 11th start in a day | 429 with "You've reached today's limit for reading resumes…" |
| RP-09 | P1 | Real AI reads a made-up resume (needs `CLEW_E2E_ANTHROPIC_API_KEY`) | Done, with the name from the file |
| RP-10 | P0 | Another user's resume; no session | 404 for another user's resume; 401 without a session |

### 3.3 Master profile and versions

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| PRO-01 | P0 | Edit headline and save | New profile version created; previous version unchanged in history |
| PRO-02 | P0 | Add, edit, reorder and delete a work entry | Each save creates one version with a readable change summary |
| PRO-03 | P0 | Version history: open an old version and restore it | Restoring creates a *new* version equal to the old one; nothing is overwritten |
| PRO-04 | P1 | Unsaved changes, then navigate away | Prompt to save or discard |
| PRO-05 | P1 | Validation: end date before start date, bad email, 5,000-char headline | Inline errors; save blocked |
| PRO-06 | P0 | Sensitive answers (work authorization, veteran, disability, EEO) | Stored separately (not in `profile_versions.data`); hidden by default in the UI; never appear in API logs |
| PRO-07 | P1 | Resume variants: create "Backend" from the profile, export PDF | PDF downloads and contains the variant's overrides |
| PRO-08 | P1 | "Changes not on every site yet" panel | With no sites connected in phase 1, the panel shows an empty state, not an error |
| PRO-09 | P1 | Saved application answers (Profile > Application answers) | Add, edit, delete an answer; persists after reload |
| PRO-10 | P0 | Two tabs edit the profile at once | Second save is told the profile changed and is offered a reload; no silent overwrite |
| PRO-11 | P1 | Export all my data | JSON download includes profile, versions, applications; excludes other users' data |
| PRO-12 | P1 | Delete account | Signed out; sign-in again fails; data gone from API |

#### Profile editor screen

From the Master profile spec in `docs/design/screens.md` (#74). Automated once the editor (#15) merges; each also runs at phone width (390 px) unless marked desktop.

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| PE-01 | P0 | Edit each section (basics, experience, education, skills) and save | One new version per save; toast "Saved…"; the entry shows "Edited, not synced"; reload shows the edit |
| PE-02 | P0 | Only one entry open at a time | Opening a second entry closes the first; closed entries show a summary and an Edit link named for the entry |
| PE-03 | P1 | Discard with and without changes | Asks to confirm only when there are changes; confirming restores the saved values |
| PE-04 | P0 | Leave with unsaved changes (PRO-04) | "Save your changes?" with Save, Discard and Keep editing; each does what it says |
| PE-05 | P0 | Validation (PRO-05): end before start, bad email, non-http link, 201-character headline | The messages from the spec appear inline and in the error summary; save is blocked; nothing saved |
| PE-06 | P1 | "I still work here" | Ticking it clears and disables the end date |
| PE-07 | P0 | Save after the profile changed in another tab (PRO-10) | Alert "Your profile changed somewhere else."; Reload latest and Keep my edits for now; nothing overwritten |
| PE-08 | P0 | History: open an old version, restore it (PRO-03) | Read-only view; confirm "Restore version N?…"; a new version equal to it, change summary "Restored version N" |
| PE-09 | P1 | Section switching | Desktop: nav with `aria-current`; phone: "Section" select changes the route; focus moves to the section heading |
| PE-10 | P0 | Phone width (390 px) | No sideways scroll; sticky Save and Discard don't cover the focused field; no serious axe issues |
| PE-11 | P0 | Sensitive answers never show in history, toasts or the live region (PRO-06) | Absent from every history view and announcement |

### 3.4 Job feed

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| FEED-01 | P0 | Feed loads after onboarding with fixture jobs | Cards show title, company, location, fit score 0 to 100, top reason, and "Seen on" sites |
| FEED-02 | P0 | Dedup: 8 planted duplicate pairs | Each pair shows as one card; "Seen on" lists both sources |
| FEED-03 | P0 | Dedup near-misses: same title, different company; same company, different city | Stay as separate cards |
| FEED-04 | P0 | Primary link | Card's main link goes to the employer ATS posting before USAJobs or a job site |
| FEED-05 | P0 | Ranking order | Cards sorted by fit score, highest first; a fixture job built to match the test profile ranks in the top 3 |
| FEED-06 | P0 | Detail panel | Shows the top three reasons (for example "Matches 8 of 10 skills"), all postings, and the apply button |
| FEED-07 | P0 | Filters: remote, location, salary floor, posted within | Results narrow; clearing filters restores the list; filters survive reload |
| FEED-08 | P0 | Save a job | Appears in Applications under Saved |
| FEED-09 | P0 | Dismiss a job | Removed from feed; stays dismissed after reload |
| FEED-10 | P1 | Profile change re-ranks | Add a skill that a fixture job needs; that job's score rises after the worker runs |
| FEED-11 | P1 | Closed jobs | A fixture job whose sources vanish for 7 days (clock moved) is marked closed and drops from the feed |
| FEED-12 | P1 | Empty state | New user with no matching jobs sees guidance, not a blank page |
| FEED-13 | P1 | Keyword check on a job | Lists skills found and missing against the posting |
| FEED-14 | P0 | "Apply" opens the original posting in a new tab and offers to log it | Logging it creates an Applied card in the tracker with the resume variant chosen |
| FEED-15 | P2 | Large feed (2,000 jobs) | First page renders in under 2 seconds on CI hardware; infinite scroll or paging works |
| FEED-16 | P0 | Job description HTML from a source | Rendered safely: a fixture posting with a `<script>` tag and an `onerror` image does not run script |

### 3.5 Application tracker

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| TRK-01 | P0 | Board columns | Saved, Applied, Interview, Offer, Closed. Closed holds both Rejected and Withdrawn cards, each with its own label |
| TRK-01b | P0 | Mark one card Rejected and another Withdrawn | Both land in Closed with the right label; the API stores them as separate statuses |
| TRK-01c | P1 | Reopen a Withdrawn card (move it back to Applied) | Leaves Closed, loses the Withdrawn label, keeps its notes, resume version and original `applied_at`; survives reload |
| TRK-02 | P0 | Move a card Saved → Applied → Interview by drag and drop | Status saved; survives reload; `applied_at` set on first move to Applied |
| TRK-03 | P0 | Move a card with keyboard only | Same result as TRK-02 (accessibility) |
| TRK-04 | P0 | Card shows the resume version sent | Matches the variant chosen in FEED-14, even after the profile changes later |
| TRK-05 | P1 | Add notes to a card | Saved and shown on reopen |
| TRK-06 | P1 | Add an application by hand (job not in the feed) | Card created with title, company, link |
| TRK-07 | P1 | Delete an application | Gone after reload |
| TRK-08 | P2 | Phone width | Board becomes a single column with a status picker |

### 3.6 Cross-cutting

| ID | P | Case | Expected |
| --- | --- | --- | --- |
| X-01 | P0 | Axe scan on every screen | No serious or critical violations |
| X-02 | P0 | Phone width (390px) on every screen | Single column, no horizontal scroll, top bar collapses to a menu |
| X-03 | P1 | Keyboard-only run of the whole happy path | Possible end to end with visible focus |
| X-04 | P0 | Security headers on the web app | CSP set, HSTS set, no inline script allowed |
| X-05 | P0 | CSRF | A state-changing request without the CSRF token is rejected |
| X-06 | P1 | API error (stub returns 500) | Friendly error with retry; no stack trace shown |
| X-07 | P0 | Logs during the full run | A scan of api and worker logs finds none of the fixture resume text, resume file names, profile fields, sensitive-answer values or tokens |
| X-08 | P1 | Brand | Clew logo and colors on sign-in and top bar match the mockups (visual diff) |
| X-09 | P2 | Easter egg | The Theseus line exists in the backend package `__init__.py` and does not appear in any built web or add-on bundle |

## 4. The full happy path (one test, P0)

`journey.spec.ts` runs these steps as one user and is the release gate:

1. Sign up with a `+clerk_test` email and the fixed one-time code.
2. Upload `clean.pdf`; fix one "Check this" field; finish onboarding.
3. Feed shows deduplicated, ranked jobs; open the top job's detail panel.
4. Save that job; dismiss another.
5. Edit the profile headline; confirm a new version in history.
6. Apply to the saved job with the "Backend" variant; log it.
7. Move it to Interview on the tracker; add a note.
8. Sign out; sign back in; everything above is still there.

## 5. Phase 2 preview: browser add-on regression (LinkedIn, Indeed, USAJobs)

Not built yet; listed so field maps get test hooks from the start.

- **No live sites in CI.** Each site gets saved copies of its profile edit pages (`e2e/fixtures/sites/linkedin/*.html` etc.) served locally. The add-on is loaded into Playwright's Chromium with `--load-extension`, and its host permission list is pointed at the local copies in test builds only.
- **Weekly live check by hand** on a dedicated test account per site, with a checklist, because saved copies go stale. A failed live check opens a field-map bug.
- Cases for every site: the add-on asks for that one site's permission only; fills only ticked fields; highlights them; **never clicks Save, Submit or Apply** (test asserts no submit event fired); skipped fields stay in the Sync Center; the sync event is logged; sensitive answers are filled only when the user opts in.
- Field maps are JSON from the API, so each map gets a contract test that every selector in it exists on the saved page copy.

## 6. Exit criteria for phase 1 release

- All P0 and P1 cases green on main for 3 nights in a row.
- No open bugs of severity high or critical.
- Axe: zero serious or critical violations.
- Security sign-off on AUTH-06, AUTH-11, UP-06, UP-07, UP-10, PRO-06, FEED-16, X-04, X-05, X-07.

## 7. What QA needs from the developer scaffold

- `docker compose` that starts the whole app with a job-source stub.
- A seeding endpoint that is only registered when `CLEW_ENV=test` (not registered and then checked per call); a test confirms it 404s when `CLEW_ENV=production`.
- Clerk development-instance keys only, stored as CI secrets and not exposed to `pull_request` jobs from forks.
- `data-testid` on job cards, board columns and profile sections.
- A way to move the server clock in test mode (job expiry). Not used for sign-in, since Clerk refreshes its token in the browser.

## 8. Open questions

None right now. Decided by the PM on Oct 17, 2026: resumes are PDF or Word up to 10 MB; Rejected and Withdrawn are separate statuses shown together in one Closed column. Backlog: issue #34.
