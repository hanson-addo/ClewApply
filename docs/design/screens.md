# Screen specs

These specs cover the screens behind the phase 1 user journeys UP (resume upload), PRO (master profile), FEED (job feed) and TRK (applications) in the [QA test plan](../qa/e2e-test-plan.md). Mockups are on the [mockup canvas](https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D) as boards "1b. Onboarding: upload resume", "2. Onboarding: review parsed resume", "5. Master profile", "Phone: upload resume" and "Phone: master profile". Each section below names its own boards. Components and tokens are in [components.md](components.md) and [README.md](README.md).

## Resume upload (onboarding step 1)

Route: `/onboarding/upload`. Comes right after first sign-in. The stepper shows step 1 of 4.

### Layout

| Width | Layout |
| --- | --- |
| `lg` and up | Two columns: intro and the three privacy points on the left, the upload card on the right |
| Under `lg` | One column: heading, upload card, then privacy points. Drag and drop is not offered under `md` (phones can't drag files), so the card shows only "Choose a file" |

### Privacy points

The left column (on phones, under the card) lists these before any file is chosen, so the user knows them before uploading:

1. Every file is checked for viruses before we keep it.
2. Only you can open it. Download links expire after 5 minutes.
3. An AI service reads it to draft your profile. The privacy policy link names the provider.
4. Delete it any time from Profile, Settings. Show this point only once resume delete exists in the API; until then, leave it off.

The AI line must be visible without scrolling on desktop and appear above "Choose a file" on phones, because reading starts as soon as the upload finishes (#71).

### Upload card states

The card has one state at a time. The mockup's Tweaks panel ("Upload state") shows each one.

| State | What the card shows | Primary action | Also offered |
| --- | --- | --- | --- |
| Idle | Dashed drop zone, "Drag your resume here", "PDF or Word (.docx), up to 10 MB" | Choose a file | Enter your details by hand |
| Checking | File name and size, then a three-step list: Uploading, Checking for viruses, Reading your resume | None while it runs | |
| Done | All three steps ticked, "Done. We found 5 sections in your resume." | Review what we found (goes to step 2) | |
| Error | Danger panel with a title and one sentence, see below | Choose another file, or Try again | Enter it by hand |

The file input is a real `<input type="file" accept=".pdf,.docx">` with a visible `<label>` styled as the primary button. The drop zone is an extra, never the only way in. Keyboard and screen-reader users use the button.

### Error messages

Each API response maps to one message. The body text reuses the backend's wording so support and QA see the same words.

| API response | Title | Body | Action | Manual entry offered |
| --- | --- | --- | --- | --- |
| Too large (413), or the browser sees the file is over 10 MB before sending | This file is over 10 MB | Files must be 10 MB or smaller. Try saving it as a PDF without images, or remove extra pages. | Choose another file | No |
| Wrong type (415), or the extension isn't .pdf or .docx | We can only read PDF and Word files | Upload a PDF or Word (.docx) file. Pages, Google Docs and Word can all save one with File, Download or Save as. | Choose another file | Yes |
| Virus check flagged it (422) | We couldn't accept this file | Our virus check flagged it, so it wasn't kept anywhere. Please try a different copy, ideally one you export fresh from your editor. | Choose another file | Yes |
| Scanner or storage unavailable (503) | Uploads are paused for a moment | We can't check files for viruses right now, and we never keep a file we haven't checked. Try again in a few minutes. | Try again | Yes |
| Parsed but no text found (scanned image or empty file) | We couldn't find any text in this file | It might be a scan or a photo of a page. Try the original PDF or Word file, or enter your details by hand. It takes about five minutes. | Choose another file | Yes |
| Network error | The upload didn't finish | Check your connection and try again. Nothing was saved. | Try again | No |

Rules:
- Check size and extension in the browser first, so a 50 MB file fails at once instead of after a long upload. The server still checks both (content type comes from the file itself).
- Never show the file's contents, and never put the file name in page titles, toasts or analytics events (threat model, logs rule in CLAUDE.md).
- Errors never leave a blank profile without a message (UP-04, UP-08).

### Accessibility

- The step list is an `<ol aria-label="Upload progress">`. The current step has `aria-current="step"`; done steps end in ", done".
- One `role="status"` line under the list announces each step change ("Checking for viruses. This usually takes under 30 seconds.") and the result ("Done. We found 5 sections in your resume.").
- The error panel is `role="alert"`, so it is read as soon as it appears. Focus moves to its primary action button.
- When the upload finishes, focus moves to "Review what we found".
- The spinner-like ring for the current step is decorative; motion stops under reduced motion and the text still says what's happening.

### Leaving and coming back

If the user leaves mid-way, the next visit opens the step they were on with the uploaded file kept (UP-11). "Replace file" on step 2 returns here and shows the current file name above the drop zone.

### Until parsing merges

Resume parsing is in review (#71): after upload, `GET /resumes/{id}/parse` reports progress and returns a draft profile plus the fields to "Check this". Until that merges, `POST /resumes` only stores and scans the file, so "Reading your resume" is skipped and "Review what we found" opens step 2 with empty fields, labeled "We'll fill this in from your resume soon. For now, add your details here."

## Review parsed resume (onboarding step 2)

Covered by the existing mockup. Additions:
- A field the parser wasn't sure about gets a warning StatusPill ("Check this", "Check the dates") next to its label, and the side panel counts them ("2 fields need a look"). The pill text is part of the label, so a screen reader hears "Headline, check this".
- "Looks good, continue" saves profile version 1 with change summary "From your resume upload".

## Master profile

Route: `/profile/:section`, where section is one of basics, experience, education, skills, variants, answers, sensitive. Data shape is the JSON Resume schema in `backend/src/clew/profile/schema.py`.

### Layout

| Width | Layout |
| --- | --- |
| `lg` and up | Section nav on the left, the section's form in the middle, side panel on the right (changes not on every site yet, resume variants, history) |
| `md` to `lg` | Section nav on the left, form on the right; the side panel moves under the form |
| Under `md` | A "Section" `<select>` at the top, then the "changes not on every site yet" banner (one tappable row), then the form. Save and Discard stick to the bottom of the screen above the safe area |

### Editing and saving

- One entry is open for editing at a time (a role, a school). Closed entries show a summary line and an Edit link whose name includes the entry ("Edit Software Engineer at Cobalt Freight").
- Save sends the whole profile with `base_version_id` set to the version the edit started from. A successful save adds a version, shows a toast "Saved. 3 changes are waiting in the Sync Center.", and marks the entry with the warning pill "Edited, not synced".
- Discard asks for confirmation only if there are changes.
- Leaving the page with unsaved changes asks "Save your changes?" with Save, Discard and Keep editing (PRO-04).
- Dates use `<input type="month">`; "Present" is a checkbox "I still work here" that clears the end date.

### Validation

Errors show inline under the field and in an ErrorSummary on save (PRO-05). Messages:

| Rule | Message |
| --- | --- |
| End date before start date | End date must be after the start date. |
| Email doesn't look like an address | Enter an email like name@example.com. |
| Link isn't http or https | Links must start with https:// or http://. |
| Text over its limit (200 for short fields, 5,000 for descriptions) | Keep this under 200 characters. Show a live count once the user is within 20 characters of the limit |
| Control characters (from pasted text) | Strip them silently on paste; the server refuses them |
| Whole profile over 256 KB | Your profile is too long to save. Shorten some descriptions. |

### Edited somewhere else (409)

If the profile changed in another tab or device since the edit started (PRO-10), Save is refused. Show an inline warning panel above the form, `role="alert"`:

> **Your profile changed somewhere else.** Reload it to see the latest version. Your edits to this entry are kept below so you can copy them.

Actions: Reload latest (primary) and Keep my edits for now. Never silently overwrite.

### History and restore

- "History" lists versions newest first: "Version 7 · today · 3 fields". Each row opens a read-only view of that version.
- "Restore this version" saves it as a new version (change summary "Restored version 5"); nothing is overwritten or deleted (PRO-03). Confirm first: "Restore version 5? Your current profile stays in history."
- History never shows sensitive answers; they aren't part of profile versions.

### Sensitive answers section

Uses the SensitiveFieldset spec in components.md: encrypted separately, `autocomplete="off"`, masked by default with a Show toggle, never in toasts, history or the live region (PRO-06).

### Accessibility

- The section nav is `<nav aria-label="Profile sections">` with `aria-current="page"` on the current section. On phones the `<select>` has a visible "Section" label and changes the route on change.
- After switching section, focus moves to the section's `<h1>`.
- The phone header keeps Sync Center reachable: an icon link whose name is "Sync Center, 3 changes waiting".
- The sticky Save bar doesn't cover the focused field: the form gets bottom padding equal to the bar's height, and focused fields scroll into view above it.

## Job feed

Route: `/jobs`. The signed-in home page. Covers QA journeys FEED-01 to FEED-16. Mockup boards: "4. Job feed", "Phone: job feed", "Phone: job detail".

### Layout

| Width | Layout |
| --- | --- |
| `lg` and up | Filters column, job list, and a sticky job detail panel, side by side |
| `md` to `lg` | Job list and detail side by side; filters open in a sheet from a "Filters" button |
| Under `md` | One column: search, a "Filters, 3 on" button, the result count, then the list. Tapping a job opens its detail as its own page (`/jobs/:id`) with "Back to jobs" at the top |

### Job list

- Sorted by fit score, highest first (FEED-05). Each card is a JobCard (components.md): fit score, title, company, location and salary, the top reason, and "Seen on" listing every site the job was merged from (FEED-01, FEED-02).
- The result line says how many jobs and how many duplicates were merged: "148 jobs, 41 duplicates merged". It is in the live region, so it is announced when filters change.
- Load 25 jobs at a time. A "Show 25 more" button at the end of the list loads the next page and moves focus to the first new card. No infinite scroll, so keyboard and screen-reader users can reach the footer (FEED-15).
- A job that closed (its sources gone for 7 days) leaves the feed. If it was saved, its Applications card gets a neutral "Posting closed" pill (FEED-11).

### Filters

Work type (Remote, Hybrid near [city], On-site), location, minimum salary, posted within (1, 7, 30 days, any), and sources. Filters live in the URL query, so they survive reload and can be bookmarked (FEED-07). "Clear filters" restores the full list and is offered whenever any filter is on.

### Job detail

Order of sections, on desktop and phone alike:
1. Fit score as text ("FIT 92 OF 100"), title as `<h1>` on its own page or `<h2>` in the panel, company, location, salary or "Salary not posted".
2. **Why this fits:** the top three reasons (FEED-06).
3. **Skills check:** "You have" and "Not on your profile" as two plain lists from the posting (FEED-13). Each missing skill has an "Add to profile" link only when the skill isn't already in the profile under another name.
4. **Where it's posted:** every source. The "Apply here" source is the employer's own site first, then USAJobs, then a job board (FEED-04).
5. **About the job:** the first 600 characters, then "Read the full description". Descriptions from sources are sanitized to plain formatting (paragraphs, lists, bold, links) before display. No scripts, images, iframes, styles or event attributes ever render (FEED-16). Links in descriptions open in a new tab with `rel="noopener noreferrer"`.

Actions: the primary button is "Apply on [employer]'s site" and opens the posting in a new tab. Its accessible name ends "(opens in a new tab)". On phones the actions stick to the bottom of the screen. Then Save and "Not for me".

### After "Apply"

When the user comes back to the Clew tab after opening a posting, show a panel above the detail: "Did you apply to Senior Backend Engineer?" with "Yes, log it" (primary) and "Not yet". "Yes, log it" asks which resume version was sent (default: the variant used for autofill, else the default variant) and creates an Applied card (FEED-14). Never log an application without the user saying so.

### Save and Not for me

- Save adds the job to Applications under Saved, changes the button to "Saved" (`aria-pressed="true"`), and shows a toast with a link: "Saved. View in Applications" (FEED-08).
- "Not for me" hides the job, moves focus to the next card, and shows a toast with Undo for 10 seconds. Hidden jobs stay hidden after reload (FEED-09). Settings has a "Hidden jobs" list to bring one back.

### Empty and loading states

| State | Heading | Text | Action |
| --- | --- | --- | --- |
| New account, nothing connected | No jobs yet | Connect a job feed and we'll start finding matches. | Connect a job feed |
| Connected, but nothing matches | No matches right now | Try fewer filters, or widen the location or salary. New jobs arrive every few hours. | Clear filters |
| Loading | Skeleton cards with `aria-busy="true"` | "Loading jobs" announced once | |
| Feed failed to load | We couldn't load your jobs | Check your connection and try again. | Try again |

FEED-12 needs the first two to show guidance, never a blank page.

## Applications

Route: `/applications`. Covers TRK-01 to TRK-08. Mockup boards: "7. Applications" (clickable) and "Phone: applications".

### Columns

Saved, Applied, Interview, Offer, Closed. Closed holds both rejected and withdrawn applications, each with a neutral pill that says which (TRK-01, TRK-01b). Each column shows its count in its heading.

### Moving a card

- Every card has a visible **Status** select with Saved, Applied, Interview, Offer, "Closed: rejected" and "Closed: withdrawn". This is the main way to move a card: it works with a keyboard, a screen reader and touch (TRK-03). Its accessible name includes the job ("Status of Senior Backend Engineer").
- Drag and drop between columns is an extra on desktop (TRK-02). While dragging, the target column gets a 2px `focus-ring` outline.
- After a move, the live region says "Senior Backend Engineer moved to Interview." Focus stays on the card's Status select in its new column.
- The first move to Applied sets the applied date. Moving a card back out of Closed removes its Rejected or Withdrawn pill and keeps its notes, resume version and applied date (TRK-01c).

### Card contents

Title, company, the date of the latest step ("applied Oct 20"), and one line that matters for that column:
- Saved: fit score, or a blocker such as "Sync USAJobs profile first".
- Applied: "Sent: Backend resume, version 7". This is the version that was sent, and it never changes when the profile changes later (TRK-04).
- Interview: the next step and date, from the card's notes.
- Closed: the Rejected or Withdrawn pill.

Opening a card (its title is a link) shows a detail page with the posting link, the resume version (with a "Download this version" link), notes (TRK-05), and Delete. Delete asks first: "Delete this application? This can't be undone." (TRK-07).

### Add an application

"Add an application" opens a dialog for a job that isn't in the feed: job title (required), company (required), link (optional, must be http or https), status (default Applied), date, and resume version. It creates the card in its column (TRK-06).

### Phone

Under `md` the board becomes one list with a row of status tabs above it (Saved 2, Applied 2, Interview 1, Offer 0, Closed 1). The tabs are `role="tablist"` buttons, and the arrow keys move between them. Each card keeps its Status select, so moving a card never needs dragging (TRK-08).

### Empty state

Each empty column says what goes there ("Save a job from your feed to keep it here."). A brand-new account sees one message instead of five empty columns: "No applications yet. Save or apply to a job from your feed and it shows up here." with a "Go to your jobs" button.
