# Clew component specs

Each spec lists what the component is made of, which tokens it uses, its states, and what a screen reader and a phone need. Token names drop the `--clew-` prefix. Suggested React prop types are a starting point for the developer, not a fixed API.

Shared rules for every component:

- Focus ring comes from `base.css` (3px `focus-ring`, 2px offset). Don't override it.
- Hover is never the only way to see something. Anything shown on hover is also shown on focus.
- Disabled controls use the native `disabled` attribute plus 50% opacity. Prefer explaining why something can't be done over disabling it.
- Transitions use `motion-duration-fast` and `motion-easing`, and switch off under reduced motion.

---

## Logo

The coral yarn ball with two knitting needles and a curly loose end, next to the lowercase wordmark "clew" in Syne 800.

| Variant | Needles and knob color | Ball | Use |
| --- | --- | --- | --- |
| `onDark` | `color-ink-50` | `color-coral-500`, wraps in `color-ink-900` | App header, sign-in |
| `onLight` | `color-ink-900` | same | Emails, light panels |
| `mark` | ball and loose end only | | Favicon, add-on toolbar icon at 16 to 32px |

- The SVG is decorative (`aria-hidden="true"`); the wrapping link is named "Clew home".
- Minimum size: 24px for the full mark, 16px for `mark`.
- Source SVG: the "Clew brand" board in the mockups.

## AppHeader

Indigo bar on every signed-in page.

- **Anatomy:** logo link, main nav, Sync Center badge, avatar menu button.
- **Tokens:** `bg-inverse`, bottom border `bg-inverse-raised`, text `text-on-inverse`. Nav item: 44px min height, `radius-sm`, padding `space-3` by `space-3`, Figtree 600 `sm`. Current item: `action-primary-bg` fill, `action-primary-fg` text, weight 800. Sync count badge: `action-primary-bg` pill with `action-primary-fg`, `xs` 800.
- **Phone (under `lg`):** nav collapses behind a menu button (`aria-expanded`, `aria-controls`, label "Menu"). The drawer slides from the right, full height, `bg-inverse`, nav items 56px tall. Sync Center stays visible in the bar as an icon link with its count.
- **Screen reader:** `<header>` then `<nav aria-label="Main">`. Current link has `aria-current="page"`. Badge text is inside the link: "Sync Center, 3 changes waiting" (visible "3" plus a `clew-sr-only` span). Avatar button: `aria-label="Account menu for Alex Rivera"`, opens a menu with Settings, Privacy and data, Sign out.

```ts
type AppHeaderProps = { current: 'jobs' | 'profile' | 'sync' | 'connections' | 'applications'; pendingSyncCount: number; userName: string };
```

## Button

| Variant | Background | Text | Border | Use |
| --- | --- | --- | --- | --- |
| `primary` | `action-primary-bg` | `action-primary-fg` | none | One per view: Continue, Apply with autofill, Approve and fill |
| `secondary` | `action-secondary-bg` | `action-secondary-fg` | 2px `action-secondary-border` | Save, Not now |
| `inverse` | `action-inverse-bg` | `action-inverse-fg` | none | Passkey sign-in, actions on light panels that need weight |
| `ghost` | transparent | `text-link` | none | Low-priority actions in a row (Edit, Skip) |
| `danger` | `status-danger-fg` | `color-white` | none | Delete account, Disconnect site (always behind a confirm dialog) |

- **Sizes:** `md` 48px (`control-height`), `lg` 56px (`control-height-lg`). Radius `md`, Figtree 700 (800 for primary), padding `space-5` horizontal. Never below 44px.
- **States:** hover primary becomes `action-primary-bg-hover`; pressed shifts down 1px; loading keeps the width, shows a spinner, sets `aria-busy="true"` and keeps the label for screen readers ("Saving").
- **Phone:** primary actions at the bottom of a form go full width.
- **Screen reader:** a `<button type="button">` unless it submits a form. If it navigates, render an `<a href>` styled as a button. Icon-only buttons need `aria-label`.

```ts
type ButtonProps = { variant?: 'primary' | 'secondary' | 'inverse' | 'ghost' | 'danger'; size?: 'md' | 'lg'; loading?: boolean; fullWidth?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>;
```

## TextField

- **Anatomy:** visible label (Figtree 700 `sm`), optional hint (`text-secondary` `sm`), input, error text.
- **Tokens:** input `bg-surface`, 2px `border-control`, radius `lg`, height 48px (56px on sign-in), text `md`. Focus: border `border-strong` plus the focus ring. Error: border `status-danger-fg`, error text `status-danger-fg` with an alert icon.
- **Rules:** placeholder is an example only ("you@example.com"), never the label. Use the right `type` and `autocomplete` (`email`, `given-name`, `tel`, `postal-code`) so phones show the right keyboard and autofill works. Font size never below 16px, or iOS zooms the page.
- **Screen reader:** `<label for>`; hint and error joined in `aria-describedby`; `aria-invalid="true"` on error; required fields use `required` and the label says "(required)".

```ts
type TextFieldProps = { label: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>;
```

## Checkbox and Radio

- Native inputs, 20px, `accent-color: var(--clew-control-accent)`. The whole row (input plus label) is the tap target, at least 44px tall.
- Groups sit in a `<fieldset>` with a `<legend>` (Feed filters: "Work type", "Sources").
- In the Sync Center, each change row has a checkbox labeled with the field name: "Include headline change".

## SensitiveFieldset

Work authorization, veteran status, disability and EEO answers.

- A `<fieldset>` with a `<legend>` and a short note: "Encrypted separately. Clew only fills these when you say so."
- Inputs use `autocomplete="off"` so the browser doesn't save them.
- Saved values are masked by default ("Answered"), with a "Show" toggle button (`aria-pressed`, label "Show veteran status") that reveals the value until the user leaves the section.
- Values never appear in toasts, the live region, error summaries or page titles. Announce "Saved" rather than the answer.

## FileUpload

Resume upload on onboarding step 1 and "Replace file" on the profile. Screen-level states and error copy are in [screens.md](screens.md#resume-upload-onboarding-step-1).

- **Anatomy:** a drop zone (2px dashed `border-control`, `bg-subtle`, radius `lg`) holding an icon, "Drag your resume here", the limits line ("PDF or Word (.docx), up to 10 MB", `text-secondary`), and a primary Button that is the `<label>` for a visually hidden `<input type="file" accept=".pdf,.docx">`.
- **Drag over:** border becomes `focus-ring` and the background `bg-selected`; the text changes to "Drop to upload". Dropping more than one file uses the first and says "We used the first file."
- **Phone (under `md`):** no drop zone text; the full-width button opens the phone's file picker. A hint under it says "Opens Files, iCloud Drive or Google Drive on your phone."
- **Progress:** an `<ol>` of steps (done, current, to do) plus one `role="status"` line. Never a bare percentage bar with no words.
- **Screen reader:** the button reads "Choose a file, PDF or Word, up to 10 MB" (the limits line is joined with `aria-describedby`). The input itself must stay focusable: hide it with the `clew-sr-only` pattern, never `display: none`.

```ts
type FileUploadProps = { accept: string[]; maxBytes: number; onFile: (file: File) => void; state: 'idle' | 'checking' | 'done' | 'error'; error?: { title: string; body: string } };
```

## Select

- Native `<select>` styled like TextField, with a custom chevron icon (`aria-hidden`). Use native so phones get their own picker.

## StatusPill

Short status on cards and table rows.

| Tone | Tokens | Example |
| --- | --- | --- |
| `success` | `status-success-bg` / `-fg` | Up to date, Connected |
| `warning` | `status-warning-bg` / `-fg` | 3 changes behind, Resume file outdated |
| `danger` | `status-danger-bg` / `-fg` | Sync failed |
| `info` | `status-info-bg` / `-fg` | New |
| `neutral` | transparent, 1px `border-control`, `text-secondary` | Not connected |

- Pill radius, `xs` 600, padding `space-1` by `space-3`. The text is the meaning; color only reinforces it.
- Not interactive. If it needs an action, put a link next to it ("Review").

## Card

- `bg-surface`, radius `lg`, padding `space-5`, 1px `border-subtle`. No shadow unless it floats (menus, sheets use `shadow-overlay`).
- If the whole card is clickable, the card title is the link or button, and the card gets a stretched hit area; there are no nested interactive elements inside the hit area other than secondary buttons placed outside it.

## JobCard

One merged job in the feed list.

- **Anatomy:** FitScore, title (Figtree 700 `lg`), company, location and salary (`text-secondary` `sm`), top reason (`text-accent` 600 `xs`), sources ("Seen on Northwind site, LinkedIn, Indeed", `text-secondary` `xs`).
- **States:** default 1px `border-subtle`; hover border `border-control`; selected 2px `focus-ring` border with FitScore filled coral.
- **Desktop:** a `<button>` that shows the job in the detail panel; selected has `aria-current="true"`.
- **Phone:** an `<a href="/jobs/:id">` that opens the job detail page.
- **Screen reader name:** title first, then the rest, e.g. "Senior Backend Engineer, Northwind Health, Remote US, $165k to $190k, fit 92 of 100". The list is a `<ul>` with a count heading: "148 jobs, 41 duplicates merged".

## FitScore

- 52px square, radius `md`. Number in Figtree 700 `lg`, the word "FIT" in `xs` below it.
- Default: `bg-selected` with `text-selected`. On the selected card: `action-primary-bg` with `action-primary-fg`.
- Screen reader: "Fit 92 of 100" (the visual "FIT" is `aria-hidden`).
- Color never encodes the score band; the number does.

## JobDetail

- Desktop: right-hand panel, sticky below the header, scrolls on its own. Phone: its own page with a "Back to jobs" link at the top.
- **Sections (h2 or h3):** Why this fits (list), Where it's posted (one row per source, the "Apply here" source first), apply note, actions.
- **Actions:** primary "Apply with autofill" (full width), then secondary Save and "Not for me". On phone the action row sticks to the bottom of the screen above the safe area (`env(safe-area-inset-bottom)`).
- When the user picks a new job on desktop, announce its title through the live region; don't move focus.

## FilterPanel

- Desktop: left column card. Phone and tablet: a bottom sheet opened by a "Filters" button that shows the active count ("Filters, 2 on").
- Sheet: `role="dialog"`, `aria-modal="true"`, title "Filters", Apply and Clear buttons pinned at the bottom. Focus moves to the title on open and back to the Filters button on close.
- Result count updates through the live region: "148 jobs".

## Stepper (onboarding and connect flow)

- Ordered list (`<ol aria-label="Steps">`) of pills in the indigo header.
- Done: `bg-inverse-raised` with `text-on-inverse`, visible text ends in ", done". Current: `action-primary-bg` with `action-primary-fg`, weight 800, `aria-current="step"`. To do: 1px `border-inverse`, `text-on-inverse-muted`.
- Phone: show "Step 2 of 4: Review profile" as text instead of all pills.

## ChangeRow (Sync Center and add-on panel)

The core trust moment: the user sees exactly what will change on a site and approves it.

- **Anatomy:** checkbox, field name (Figtree 700), "On LinkedIn now" value, "From your Clew profile" value, optional "Edit before sending" link.
- **Tokens:** row `bg-surface`, divider `border-subtle`. Old value `text-secondary` with a strikethrough is not enough on its own: each side has a visible label ("Now", "New").
- **Desktop:** before and after side by side. **Phone:** stacked, "Now" above "New".
- **Screen reader:** the checkbox label reads "Include headline: now 'Backend Engineer', new 'Senior Backend Engineer, Python'". Long values are truncated visually with a "Show all" button (`aria-expanded`), never cut off for screen readers.
- **Sensitive fields:** when a change touches a sensitive answer (work authorization, veteran, disability, EEO), the row shows "Updated" instead of the old and new values, in both the Sync Center and the add-on panel. The checkbox label reads "Include veteran status (updated)".
- Primary button below the list states the count: "Fill 3 approved changes". The add-on never presses the site's own Save button; the panel tells the user "Now press Save on LinkedIn".

## ConnectionCard and site list

- Job feeds are cards: name, StatusPill, one-line description, one action.
- Profile sites are a table on `md` and up (Site, How it updates, Profile status, Action), with a visually hidden "Action" column header. Under `md` each row becomes a card with the same content in that order.
- Table: real `<table>` with `<th scope="col">`; the Action link text includes the site ("Review LinkedIn") via a `clew-sr-only` span.

## Dialog and Drawer

- Native `<dialog>` or an equivalent with `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at its title.
- Backdrop `color-ink-900` at 60% opacity. Panel `bg-surface`, radius `xl`, `shadow-overlay`, max width 560px. On phone it becomes a bottom sheet.
- Focus goes to the first field or the title on open, is trapped while open, Escape closes, and focus returns to the opener.
- Destructive dialogs name the action in the button ("Disconnect LinkedIn"), never "OK".

## Toast and live region

- One polite live region (`role="status"`) is mounted once in the app shell. Toasts render inside it, bottom center on phone, bottom left on desktop, above the safe area.
- `bg-inverse`, `text-on-inverse`, radius `lg`, `shadow-overlay`. Stay at least 6 seconds, pause on hover and focus, have a close button. Anything the user must act on goes in the page, not a toast.
- Errors that block the user use `role="alert"` inline instead.

## ErrorSummary

- Appears at the top of a form after a failed submit: `status-danger-bg` panel with a 2px `status-danger-edge` border, heading "Fix 2 things to continue", then a list of links to each field.
- Receives focus (`tabindex="-1"`) when shown.

## ApplicationCard

One card on the Applications board.

- **Anatomy:** title (link to the application's page), company and latest date (`text-secondary`), one context line (screens.md says which per column), an optional neutral StatusPill (Rejected, Withdrawn, Posting closed), then a labeled Status `<select>`.
- **Tokens:** `bg-surface`, 1px `border-subtle`, radius `lg`, padding `space-4`. Columns use `bg-sunken` with radius `lg`.
- **Moving:** the Status select is required and always visible. Drag and drop is an optional extra and never the only way. The select's label is "Status", with the job title appended for screen readers.
- **Screen reader:** each column is a `<section>` labeled by its heading ("Applied 2"). Cards are list items. Moves are announced in the live region.

```ts
type ApplicationStatus = 'saved' | 'applied' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
type ApplicationCardProps = { id: string; title: string; company: string; status: ApplicationStatus; dateLabel: string; contextLine?: string; onStatusChange: (s: ApplicationStatus) => void };
```

## Avatar

- 40px circle (`size-avatar`), initials in Figtree 700 `sm`. On the indigo header: `color-ink-50` fill, `text-primary` initials.
- Always inside a button with an `aria-label`; the initials are `aria-hidden`.

## Skeleton (loading)

- `color-ink-200` blocks with radius matching the content. A gentle pulse, off under reduced motion.
- The region being loaded has `aria-busy="true"`; the live region says "Loading jobs" once, then the result count when done.

## EmptyState

- Short heading, one sentence, one primary action. For a new account's feed: "No jobs yet", "Connect a job feed and we'll start finding matches.", button "Connect a job feed".
- No illustrations that carry meaning; decorative art is `aria-hidden`.
