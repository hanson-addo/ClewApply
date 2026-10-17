# Clew design system

This is the designer's handoff for the web app and the browser add-on. It covers the tokens, the rules for phones and screen readers, and how each screen is laid out. Component-by-component specs are in [components.md](components.md).

- Tokens (source of truth): [`packages/design-tokens/tokens.json`](../../packages/design-tokens/tokens.json)
- Generated CSS variables: `packages/design-tokens/tokens.css`
- Generated TypeScript: `packages/design-tokens/tokens.ts`
- Base styles (focus ring, skip link, reduced motion): `packages/design-tokens/base.css`
- Clickable mockups: https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D

## Using the tokens

```ts
import '@clew/design-tokens/tokens.css';
import '@clew/design-tokens/base.css';
import { tokens, cssVar } from '@clew/design-tokens';

const style = { color: cssVar('text-secondary') };   // var(--clew-text-secondary)
const coral = tokens.color.coral['500'];             // '#FF6B4A'
```

Components use **semantic** tokens (`--clew-text-primary`, `--clew-action-primary-bg`), never the raw palette (`--clew-color-ink-900`). The palette exists so the semantic layer can be retuned in one place.

To change a value, edit `tokens.json`, run `npm run build` in `packages/design-tokens`, and commit all three files. `npm test` fails if the generated files are stale or if any text pair drops below WCAG AA contrast.

## Brand in one paragraph

Night indigo `#101935` carries structure: the app header, primary text, dark panels. Yarn coral `#FF6B4A` is the one accent, used only as a **fill** (primary buttons, the current nav item, the fit score on the selected job) with indigo text on top. Lavender white `#F4F2FF` is text on indigo and the subtle surface. Page background is `ink-100` `#EDEBF5`, cards are white. Headlines are Syne 800, everything else is Figtree.

## Color rules

| Use | Token | Value | Why |
| --- | --- | --- | --- |
| Page background | `bg-page` | `#EDEBF5` | Soft lavender so white cards read as cards |
| Cards, inputs | `bg-surface` | `#FFFFFF` | |
| App header, dark panels | `bg-inverse` | `#101935` | |
| Body text | `text-primary` | `#101935` | 14.7:1 on page |
| Secondary text | `text-secondary` | `#454B66` | 7.3:1 on page |
| Links, accent text | `text-link`, `text-accent` | `#B23A1E` | Coral 500 is only 2.8:1 on white, so text uses coral 700 |
| Primary button | `action-primary-bg` / `-fg` | `#FF6B4A` / `#101935` | 6.2:1 |
| Input and checkbox borders | `border-control` | `#7D82A0` | 3.8:1, meets the 3:1 rule for controls |
| Focus ring | `focus-ring` | `#D4421F` | 3px outline, 2px offset |
| Selected row or chip | `bg-selected` / `text-selected` | `#FFE9E3` / `#8A2A12` | |

Status colors (success green, warning amber, danger berry, info blue) always come as a pair (`status-*-bg` + `status-*-fg`) and always with a word or icon. Color is never the only signal. Danger is berry `#A3123A`, not red, so it never looks like the coral brand.

**Never:** coral 500 as text on a light background; white text on coral; gray placeholder text as the only label.

## Type

| Role | Font | Size token | Notes |
| --- | --- | --- | --- |
| Hero (sign-in only) | Syne 800 | `hero` (40 to 60px) | `line-height-tight` |
| Page title (h1) | Syne 800 | `3xl` (28 to 36px) | One per page |
| Section title (h2) | Figtree 700 | `xl` 20px | |
| Card title | Figtree 700 | `lg` 18px | |
| Body | Figtree 400 | `md` 16px | Never smaller on phones |
| Meta, labels | Figtree 600 | `sm` 14px | |
| Fine print, badges | Figtree 600 | `xs` 13px | Never for anything the user must read to act |

All sizes are in `rem`, so text grows when a person raises their browser or phone font size. Layouts must survive 200% text zoom without clipping or horizontal scrolling (WCAG 1.4.4, 1.4.10).

## Spacing, radius, size

- Spacing is a 4px scale: `space-1` (4px) through `space-16` (64px). Gaps between sibling cards are `space-4`; page side padding is `space-4` on phones and `space-6` from `md` up.
- Radius: `sm` 8px for nav items and small chips, `md` 10px for buttons, `lg` 14px for inputs and cards, `xl` 18px for large panels, `pill` for badges.
- Every tappable thing is at least `touch-target` 44 by 44px. Standard controls are `control-height` 48px; the main call to action on a page is `control-height-lg` 56px.

## Phones and small screens

Clew is designed mobile-first. Breakpoints: `sm` 480, `md` 768, `lg` 1024, `xl` 1280.

| Screen | Phone (under 768px) | Tablet (768 to 1023px) | Desktop (1024px and up) |
| --- | --- | --- | --- |
| App header | Logo, Sync Center badge, menu button. Nav opens as a full-height drawer | Same as phone | Logo, inline nav, avatar |
| Sign in | Form first, maze art below it, shortened | Form and art stacked | Art left, form right |
| Job feed | One column. Filters in a sheet behind a "Filters" button. Tapping a job opens its detail as a full page with a back link | List and detail side by side, filters in a sheet | Filters, list, detail in three columns |
| Profile | Sections stack; section nav becomes a select at the top | Two columns | Section nav on the left |
| Sync Center | One card per site, each change as a stacked before/after row | Same | Before and after side by side |
| Connections | Profile-site table becomes a list of cards | Table | Table |
| Applications | Columns become tabs (Saved, Applied, Interview, Offer) | Horizontally scrolling board inside its own box | Full board |
| Add-on panel | Not available on phones (browser add-ons are desktop only). Phone users see "Open Clew on a computer to sync your profile" | | 360px side panel |

No page scrolls sideways at 320px wide. Wide tables scroll inside their own box with a visible edge shadow, never the whole page.

## Screen readers and keyboard

These apply to every screen. Component-level details are in [components.md](components.md).

1. **Landmarks.** Every page has one `<header>`, one `<nav aria-label="Main">`, one `<main id="main">`, and a skip link ("Skip to main content") as the first focusable element.
2. **Headings.** One `<h1>` per page that names it ("Your jobs", "Sync Center"). Sections use `<h2>`, cards use `<h3>`. Never skip a level to get a smaller size.
3. **Page changes.** On client-side route changes, move focus to the new page's `<h1>` (with `tabindex="-1"`) and update `document.title` as "Page name · Clew".
4. **Real elements.** Buttons are `<button>`, links that go somewhere are `<a href>`, form fields have a visible `<label>`. Never a clickable `<div>`.
5. **Current state.** The current nav item has `aria-current="page"`, the current onboarding step has `aria-current="step"`, toggles use `aria-pressed`, the selected job uses `aria-current="true"`.
6. **Announcements.** Sync results, saved changes and errors are announced through one polite live region (`role="status"`); blocking errors use `role="alert"`. The Sync Center count badge is part of the link name: "Sync Center, 3 changes waiting".
7. **Icons.** Decorative SVGs get `aria-hidden="true"`. Icon-only buttons get `aria-label`. The logo link is named "Clew home".
8. **Focus.** Visible focus ring on everything (from `base.css`). Dialogs and drawers trap focus, close on Escape, and return focus to the button that opened them.
9. **Motion.** All animation respects `prefers-reduced-motion`. Nothing flashes or autoplays.
10. **Forms.** Errors appear next to the field in text, are linked with `aria-describedby`, and the field gets `aria-invalid="true"`. On submit, focus moves to an error summary at the top that links to each field.
11. **Sensitive answers** (work authorization, veteran, disability, EEO) are their own fieldset with a legend explaining they are encrypted and only filled when the user says so.

## Accessibility test checklist (for QA)

- Keyboard only: reach and use every control on every screen; focus order follows the visual order.
- VoiceOver on iPhone (Safari) and NVDA on Windows (Chrome): sign in, onboard, filter the feed, approve a sync change.
- 320px wide and 200% zoom: no sideways scroll, no clipped text.
- axe or Lighthouse accessibility: no violations on any page.
- `npm test` in `packages/design-tokens` passes (contrast of every token pair).

## Not designed yet

- Dark mode. Tokens are named by role so a dark set can be added later without touching components.
- Empty states for a brand-new account with no connected sites and no jobs.
- Email templates.
