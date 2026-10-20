# Screen specs: resume upload and master profile

These specs cover the screens behind phase 1 user journeys UP (resume upload) and PRO (master profile) in the [QA test plan](../qa/e2e-test-plan.md). Mockups are on the [mockup canvas](https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D) as boards "1b. Onboarding: upload resume", "2. Onboarding: review parsed resume", "5. Master profile", "Phone: upload resume" and "Phone: master profile". Components and tokens are in [components.md](components.md) and [README.md](README.md).

## Resume upload (onboarding step 1)

Route: `/onboarding/upload`. Comes right after first sign-in. The stepper shows step 1 of 4.

### Layout

| Width | Layout |
| --- | --- |
| `lg` and up | Two columns: intro and the three privacy points on the left, the upload card on the right |
| Under `lg` | One column: heading, upload card, then privacy points. Drag and drop is not offered under `md` (phones can't drag files), so the card shows only "Choose a file" |

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

### Not built yet

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
