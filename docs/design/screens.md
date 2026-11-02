# Screen specs

These specs cover the screens behind the phase 1 user journeys UP (resume upload), PRO (master profile), FEED (job feed) and TRK (applications), plus consent, settings and the privacy page, in the [QA test plan](../qa/e2e-test-plan.md). Mockups are on the [mockup canvas](https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D) as boards "1b. Onboarding: upload resume", "2. Onboarding: review parsed resume", "5. Master profile", "Phone: upload resume" and "Phone: master profile". Each section below names its own boards. Components and tokens are in [components.md](components.md) and [README.md](README.md).

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
3. If you agree, Anthropic's AI reads it to draft your profile. Nothing is read until you tick the box on the card (see [AI reading consent](#ai-reading-consent)).
4. Delete it any time from Profile, Settings. Show this point only once resume delete exists in the API; until then, leave it off.

The consent box and its wording must be visible without scrolling on desktop and sit above "Choose a file" on phones, so the user reads them before choosing a file.

### Upload card states

The card has one state at a time. The mockup's Tweaks panel ("Upload state") shows each one.

| State | What the card shows | Primary action | Also offered |
| --- | --- | --- | --- |
| Idle | Dashed drop zone, "Drag your resume here", "PDF or Word (.docx), up to 10 MB" | Choose a file | Enter your details by hand |
| Checking | File name and size, then a step list: Uploading, Checking for viruses, and Reading your resume only if the user agreed (see below) | None while it runs | |
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

### AI reading consent

Issue #75. Uploading never needs consent: the file is stored and virus-checked either way. Reading it with AI happens only after the user ticks the box.

The upload card shows this above "Choose a file", unticked by default:

> ☐ **Let Clew's AI read my resume and fill in my profile.**
> Clew uses Anthropic's AI to read your resume and fill in your profile. Anthropic may keep the text for up to 30 days and doesn't use it to train its models. [Privacy policy](/privacy)

This is the #75 wording; the owner approves the final text with the policy (#76). The bold first line is the checkbox `<label>`. The paragraph is tied to it with `aria-describedby`, so a screen reader hears both. The privacy policy link opens in a new tab, so a file mid-upload isn't lost, and its accessible name says so ("Privacy policy, opens in a new tab").

| User | What happens |
| --- | --- |
| Ticks the box, then uploads | The client records consent first (`ai_parsing_consent_at` plus the policy version shown, #75), then uploads. The step list is Uploading, Checking for viruses, Reading your resume. |
| Uploads without ticking | Steps are Uploading and Checking for viruses only. The Done state says "Your resume is saved." and offers **Read my resume** (primary, disabled until the box is ticked; ticking records consent, then pressing it starts reading) and **Enter my details by hand** (secondary, goes to step 2 with empty fields). |
| Agreed earlier to the current policy version | The box shows ticked, with "You agreed on Oct 20, 2026. Change this in Settings." Reading starts after upload. |
| Agreed to an older policy version | The box is unticked again, with "Our privacy policy changed. Please read it and tick again." |
| Withdrew consent in Settings | Same as never agreed. |

Rules:
- Never pre-tick the box, and never merge it into the upload button ("Upload and read" is not allowed).
- The consent record stores the timestamp and policy version only.
- Unticking after a read has started doesn't cancel that read. It stops future ones, and the box says so: "This stops future reads. Your current draft is kept."

## Review parsed resume (onboarding step 2)

Route: `/onboarding/review`. Shows the draft from `GET /resumes/{id}/parse` (#71). The draft is only a suggestion: nothing is saved to the profile until the user presses "Looks good, continue".

### Draft states

The client polls `GET /resumes/{id}/parse` every 2 seconds for the first 30 seconds, then every 5 seconds, and stops when the tab is hidden or the page is left. The server turns a read stuck for 15 minutes into `failed`, so the client needs no timeout of its own.

| Status | What the page shows | Actions |
| --- | --- | --- |
| No read (404), because the user didn't agree | Empty profile form with "Add your details below. You can let Clew's AI read your resume later from Settings." | Looks good, continue |
| `pending` | Skeleton form with `aria-busy="true"` and "Waiting to read your resume." | Enter by hand instead |
| `running` | Skeleton form and "Reading your resume. This usually takes under a minute." | Enter by hand instead |
| `done` | The filled form. Fields named in `check` carry a "Check this" pill, and the side panel says "2 fields need a look" with a link to each. | Looks good, continue |
| `failed` | A danger panel with the server's `message` (below), above an empty form | Depends on the message |

"Enter by hand instead" leaves the read running. If it finishes while the user is typing, a status line offers "Your resume is ready. Fill in the blanks from it?", which fills only fields that are still empty.

### When reading fails

The panel body is the server's `message` word for word, so QA and support see the same text. The title and actions come from this table, matched on the message.

| Server message | Title | Actions |
| --- | --- | --- |
| This file is password-protected. Remove the password and upload it again. | This file is locked | Upload another file, Enter by hand |
| We couldn't find any text in this file. If it's a scanned image, upload the original document instead. | We couldn't find any text | Upload another file, Enter by hand (UP-04, UP-08) |
| We couldn't read this resume. Save it again as a PDF or Word file and upload that. | We couldn't read this resume | Upload another file, Try again, Enter by hand |
| We couldn't accept this file. Please try a different copy. | We couldn't accept this file | Upload another file, Enter by hand. The file's download link is removed |
| This file hasn't passed the virus check, so it can't be read. | Still checking this file | Try again |
| Reading resumes is unavailable right now. Try again in a few minutes. | Reading is paused for a moment | Try again, Enter by hand |
| We're still reading your other resume. Try this one again when it's done. | Another resume is being read | Try again (enabled after 30 seconds), Enter by hand |
| You've reached today's limit for reading resumes. Try again tomorrow. | Daily limit reached | Enter by hand. No Try again button |
| Anything else | We couldn't read this resume | Try again, Enter by hand |

"Try again" calls `POST /resumes/{id}/parse`. A 429 answer shows its message in the same panel; a 409 shows the "Still checking this file" row.

### Saving the draft

- "Looks good, continue" saves the form with `PUT /profile` as version 1, change summary "From your resume upload", then goes to step 3 (UP-09).
- If the user already has a profile (a later upload from Profile), the button reads "Replace my profile" and the page says "This replaces your current profile. Your old one stays in History." It sends the current `base_version_id`; a 409 shows the master profile's "changed somewhere else" panel.
- Leaving without saving keeps the draft on the server, and coming back shows it again (UP-11).

### Accessibility

- One `role="status"` line announces each state change once ("Reading your resume.", "Done. 2 fields need a look."), never on every poll.
- The failure panel is `role="alert"`, and focus moves to its first action.
- A "Check this" pill is part of the field's label ("Headline, check this"). The side panel links move focus to the field.
- Skeletons are hidden from screen readers; the status line carries the meaning.

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

Work type (Remote, Hybrid near [city], On-site), location, minimum salary, posted within (1, 7, 30 days, any), and sources. Filters live in the URL query, so they survive reload and can be bookmarked (FEED-07). Only filter values go in the URL, never names, emails or profile data, and the app sends `Referrer-Policy: strict-origin-when-cross-origin` so the query never reaches outside sites. "Clear filters" restores the full list and is offered whenever any filter is on.

### Job detail

Order of sections, on desktop and phone alike:
1. Fit score as text ("FIT 92 OF 100"), title as `<h1>` on its own page or `<h2>` in the panel, company, location, salary or "Salary not posted".
2. **Why this fits:** the top three reasons (FEED-06).
3. **Skills check:** "You have" and "Not on your profile" as two plain lists from the posting (FEED-13). Each missing skill has an "Add to profile" link only when the skill isn't already in the profile under another name.
4. **Where it's posted:** every source. The "Apply here" source is the employer's own site first, then USAJobs, then a job board (FEED-04).
5. **About the job:** the first 600 characters, then "Read the full description". Descriptions from sources are sanitized to plain formatting (paragraphs, lists, bold, links) before display. No scripts, images, iframes, styles or event attributes ever render (FEED-16). Description links keep only `http:` and `https:` hrefs; any other href (`javascript:`, `data:`, `mailto:` and so on) is dropped and its text kept as plain text. Kept links open in a new tab with `rel="noopener noreferrer"`. Sanitize with an allowlist when a job is ingested and again before rendering; never pass source HTML straight to `dangerouslySetInnerHTML`.

Actions: the primary button is "Apply on [employer]'s site" and opens the posting in a new tab. Its accessible name ends "(opens in a new tab)". Under it, the destination's domain shows in `text-secondary` ("greenhouse.io"), so a look-alike link from a poisoned alert email is visible before the user clicks.

Outbound URLs ("Apply here" and every "Where it's posted" row) come from outside feeds, so the same rule applies: only `http:` and `https:` URLs become links or buttons, and every one opens with `rel="noopener noreferrer"`. A source with any other URL is listed as plain text with no link, and gets no Apply button. On phones the actions stick to the bottom of the screen. Then Save and "Not for me".

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

## Account settings

Route: `/settings`, from the avatar menu. Covers AUTH-09 and AUTH-15, plus the consent withdrawal (#75), export and delete (#31) promises.

### Layout

One column of Cards, max width 40rem, in this order. On every width the sections stack the same way; under `md` each Card goes full width with the 16px page gutter, and buttons go full width.

1. **Account**: email (read only, with "Change it in your sign-in settings" linking to Clerk's account page) and plan ("Free").
2. **Privacy**: AI resume reading, Download your data, and a link to the privacy policy.
3. **Sessions**: Sign out, and Sign out everywhere.
4. **Delete account**: a Card with a 2px `status-danger-fg` top border.

Each Card has an `<h2>`, so screen-reader users can jump between sections by heading.

### AI resume reading

A switch (`role="switch"`, with a visible "On" or "Off" text next to it) labeled "Let Clew's AI read my resumes". Under it:
- On: "You agreed on Oct 20, 2026 (privacy policy version 1). Anthropic may keep resume text for up to 30 days and doesn't use it to train its models."
- Off: "Clew won't read new resumes. You can still upload them and fill in your profile by hand."

Turning it off asks nothing and takes effect at once; a status line says "AI reading is off." Turning it off doesn't delete the profile, past drafts or files; the help text says "To remove your files, delete them from Profile." Turning it on shows the same wording as the upload card, then records consent with the current policy version.

### Download your data

"Download your data" explains: "A file with your profile, every version, your applications and your settings, in JSON." Pressing **Prepare download**:
1. Asks the user to confirm it's them (a passkey or a fresh one-time code, AUTH-15).
2. Calls `POST /me/export` and shows "Preparing your file." as a status line.
3. When ready, shows **Download (expires in 15 minutes)** and the file size. The link is never emailed or put in the URL bar.

If preparing fails: "We couldn't prepare your file. Try again in a few minutes."

### Sign out everywhere

"Sign out everywhere" asks in a Dialog: "Sign out on every device? You'll need to sign in again here too." with **Sign out everywhere** and Cancel. After it, the user lands on sign-in with "You're signed out on every device." (AUTH-09).

### Delete account

The Card says what goes: "This deletes your profile, every version, your resumes, your applications and your settings. It can't be undone." Then **Delete my account** (danger button).

1. Confirm it's them (passkey or fresh one-time code, AUTH-15).
2. A Dialog lists the same items, and has a text field labeled "Type DELETE to confirm". **Delete my account** stays disabled until the field matches (case-insensitive, spaces trimmed). Cancel is the default focus.
3. `DELETE /me`. While it runs the button says "Deleting…" and the dialog can't be closed.
4. The user is signed out and lands on a public page: "Your account is deleted. Copies in backups are removed within 30 days." with a link to the home page.

If it fails, the dialog shows "We couldn't delete your account. Nothing was removed. Try again, or contact us." and stays open.

### Accessibility

- The switch's state is in its name and in visible text, never color alone.
- Dialogs trap focus, close on Escape (except while deleting), and return focus to the button that opened them.
- Status lines use one shared `role="status"` region; errors use `role="alert"`.
- The typed confirm field has a visible label and its rule ("Type DELETE to confirm") is the label, not a placeholder.

## Privacy policy

Route: `/privacy`, public (no sign-in). Linked from sign-in, the upload consent box, Settings, and the footer of every page (#76). The owner writes and approves the text; this spec covers the page, not the wording.

### Layout

- Text column max width 68 characters (`max-width: 68ch`), body text 16px (`font.size.md`) at 1.6 line height, on `bg-surface`. The app header shows the logo only; the footer is the normal one.
- At the top: `<h1>` "Privacy policy", then one line such as "Version 1 · Effective November 15, 2026" (`text-secondary`, real date from the owner), then "What changed" linking to the change list at the bottom.
- A "The short version" box (`bg-subtle`, no border) with five or six bullets: what we collect, who processes it (Anthropic, Clerk, hosting and storage), Anthropic keeps resume text up to 30 days and doesn't train on it, we never sell your data, you can download or delete everything from Settings, US only.
- A table of contents as an `<nav aria-label="On this page">` list of links to each `<h2>`. On `lg` and up it sits in a sticky left column; under `lg` it sits after the short version box.
- Each `<h2>` has an id and a "Link to this section" anchor that appears on hover and focus.
- Processors are a real `<table>` with a `<caption>`: name, what they do, what data, where. Under `md` the table becomes one Card per processor.
- At the bottom: "Changes to this policy", a list of versions with dates and one line each.

### Versions

The page shows one version: the current one. The version number shown here is the one recorded with consent. When it changes in a way that affects AI reading, the upload card and Settings ask again (see [AI reading consent](#ai-reading-consent)).

### Print and accessibility

- The page prints cleanly: the header, footer and table of contents are hidden in print, and link URLs are printed after their text.
- Headings go `h1`, then `h2`, then `h3` with no skipped levels.
- No text in images. Language set with `lang="en"`.

## QA cases to add

Proposed IDs for the [QA test plan](../qa/e2e-test-plan.md); QA owns the final list.

| ID | Case | Expected |
| --- | --- | --- |
| CON-01 | Open upload as a new user | Consent box is unticked; wording and privacy link visible above "Choose a file" on desktop and phone |
| CON-02 | Upload without ticking | File stored and scanned; no read started (no parse row); "Read my resume" disabled until ticked |
| CON-03 | Tick, then upload | Consent stored with timestamp and policy version before the upload request; reading starts |
| CON-04 | Policy version raised | Box shows unticked with "Our privacy policy changed" |
| CON-05 | Turn AI reading off in Settings, then upload | No read starts; profile and files kept |
| DRAFT-01 | Each server failure message | Matching title and actions from the table; daily limit shows no Try again |
| DRAFT-02 | Screen reader during a read | Each state announced once, not on every poll |
| DRAFT-03 | Save the draft | Profile version 1 with "From your resume upload" |
| SET-01 | Download your data | Re-auth first; link expires; file has profile, versions, applications, settings |
| SET-02 | Delete account | Re-auth, typed DELETE, signed out, data gone; another session is signed out |
| SET-03 | Settings at 320px wide | No horizontal scroll; all buttons at least 44px tall |
| PRIV-01 | Open `/privacy` signed out | Loads; version and date at the top; table of contents links work |
| PRIV-02 | Print `/privacy` | No header, footer or table of contents; URLs printed |
