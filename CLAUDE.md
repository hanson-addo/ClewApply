# Clew: team rules

Clew is a job-search hub: one master profile synced to job sites through a browser add-on the user controls, plus one deduplicated, ranked job feed. Full design: https://claude.ai/code/artifact/cd08badf-820c-494f-afd9-307e715d1171

## Team roles

Each role works in its own thread of the "maze apply" project.

| Role | Owns |
| --- | --- |
| PM and manager | Backlog, specs, acceptance criteria, weekly status update to the owner |
| Designer | Design tokens, component specs, phone layout, accessibility |
| Developer | Code, tests, pull requests |
| Reviewer | Reviews every PR for bugs, quality and test coverage |
| Security | Threat model, security scanning, must approve every PR (see Lean mode below) |
| QA | Test plans and end-to-end checks of user journeys |

## How a change gets in

1. Work on a branch, never on `main`. Name it `<role>/<short-topic>`, or use the `claude/...` branch a Claude session was given.
2. Open a pull request using the template. Link the backlog item it closes.
3. Reviewer and Security each post a PR review whose first line is `Verdict: approve` or `Verdict: changes requested`. All Claude roles post through one GitHub account, and GitHub won't let an account approve its own PR, so this written verdict is the approval. The author never gives their own verdict.
4. All checks must pass.
5. The owner (hanson-addo) merges only when Reviewer and Security have both posted `Verdict: approve` (see Lean mode below). Nobody pushes directly to `main`.

**Lean mode (owner decision, 2026-11-04, to save tokens until phase 1 works end to end):** only the Developer and Reviewer threads run. The Reviewer also checks security on routine PRs, and its `Verdict: approve` is enough to merge them. Security is woken only for PRs that touch sign-in, uploads, resume parsing, personal data, encryption, secrets, CI workflow changes (permissions, secrets use) or new runtime dependencies, and those still need both verdicts. Designer and QA stay paused; QA returns for one full test pass once the job feed and tracker are in. The owner ends lean mode.

## Product rules (non-negotiable)

- Never ask for, store or log a user's password for any third-party job site.
- No server-side logins to LinkedIn, Indeed, ZipRecruiter or similar sites, and no scraping of them. Jobs come only from official APIs, public ATS job boards and the user's own alert emails.
- The browser add-on fills only fields the user ticked, and never presses Save, Submit or Apply. The user does that.
- The add-on requests host permissions only for supported job sites, never all sites.
- Sensitive answers (work authorization, veteran, disability, EEO) are encrypted separately and filled only when the user says so.
- Every user record carries a `plan` field from day one, so paid features can be switched on later.
- US only at launch.

## Engineering rules

- No secrets in code. Use environment variables, and keep `.env.example` with placeholder values only.
- Never put real people's resumes or personal data in tests or fixtures. Use made-up data.
- Logs must not contain profile content, resume text or tokens.
- Backend: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic. Type hints everywhere; ruff and mypy clean.
- Frontend and add-on: TypeScript strict mode, a typed API client generated from the backend's OpenAPI spec.
- Every PR includes tests for what it changes.

## Brand

Name: Clew. Colors: indigo `#101935`, coral `#FF6B4A`, lavender white `#F4F2FF`. Fonts: Syne for headlines, Figtree for body text. Logo: a coral yarn ball with two knitting needles and a curly loose end. Mockups: https://claude.ai/artifact/ViUm1ywkTR8FQdN1RyHS2D

## Easter egg

The owner asked for this line to live in the codebase: "A clew is the ball of thread that led Theseus out of the labyrinth." Put it only as a code comment in a server-side backend file (the backend package's `__init__.py`). Never put it in web app, add-on or any other code that ships to a user's browser.
