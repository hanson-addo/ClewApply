# Clew threat model

Version 1, 2026-10-17. Owner: Security role. Review this document whenever a PR adds a new data store, a new third-party integration, a new extension permission, or a new way for data to leave Clew.

Source design: [Clew product and system design](https://claude.ai/code/artifact/cd08badf-820c-494f-afd9-307e715d1171), sections "User login and accounts", "Data storage model" and "Data security and privacy".

## 1. What Clew is, from an attacker's point of view

Clew holds a complete identity record for every job seeker (name, address, phone, email, work and education history, resume files) plus answers that are legally sensitive (work authorization, veteran status, disability, EEO). It also holds read-only access to some users' mailboxes and a paired browser add-on that can type into job sites where the user is logged in.

That makes three things worth stealing or abusing:

1. The profile and resume data itself (identity theft, phishing, resale).
2. The sensitive answers (discrimination, extortion, legal exposure for Clew).
3. Clew's reach into other places: the mailbox OAuth tokens and the add-on running inside the user's logged-in browser.

The most important protection is already a design decision: Clew never asks for, stores or uses a user's password for any job site. A full breach of Clew must never let an attacker take over a user's LinkedIn, Indeed or ZipRecruiter account. Every rule below protects that property or limits the damage when something else goes wrong.

## 2. System overview and trust boundaries

```
 User's browser                         Clew cloud                         Third parties
 ┌───────────────────────┐   TLS   ┌──────────────────────────┐   TLS   ┌────────────────────┐
 │ Web app (React)       │◄──────►│ API (FastAPI)            │◄──────►│ Auth provider       │
 │  cookies: HttpOnly    │   B1    │  ├ Postgres (RLS)        │   B4    │ (Clerk)             │
 ├───────────────────────┤         │  ├ Object storage (S3)   │         ├────────────────────┤
 │ Clew add-on (MV3)     │◄──────►│  ├ Redis + workers       │◄──────►│ USAJobs API,        │
 │  own revocable token  │   B2    │  ├ KMS (data keys)       │   B5    │ Greenhouse/Lever/   │
 │  fills job-site forms │         │  └ LLM / embedding API ──┼──────►│ Ashby boards        │
 └──────────┬────────────┘         └──────────────────────────┘   B6    ├────────────────────┤
            │ B3 (DOM of job sites)                                    │ Gmail / Outlook     │
            ▼                                                          │ (read-only OAuth)   │
   LinkedIn, Indeed, ZipRecruiter, USAJobs pages (user logged in)      │ LLM provider        │
                                                                       └────────────────────┘
```

| Boundary | Between | Why it matters |
| --- | --- | --- |
| B1 | Web app and API | Every request is untrusted until the API checks the session and that the caller owns the record. |
| B2 | Add-on and API | The add-on lives on an untrusted machine and holds a token that can read the full profile. |
| B3 | Add-on and job-site pages | Job-site pages (and any script injected into them) are hostile to the add-on. |
| B4 | API and auth provider | Clew trusts the provider's identity claims; a misconfiguration here is an account takeover. |
| B5 | Workers and job sources | Job postings and alert emails are attacker-controlled text that Clew parses, stores and renders. |
| B6 | API and LLM provider | Resume text leaves Clew for parsing and "why this job" text. |

## 3. Assets

| Asset | Where it lives | Sensitivity | Impact if exposed or changed |
| --- | --- | --- | --- |
| Profile versions (JSON Resume data) | `profile_versions` | High (PII) | Identity theft, phishing, privacy-law breach |
| Resume files | Object storage, `resume_variants.file_key` | High (PII) | Same as above, plus file-borne malware if tampered |
| Sensitive answers (work authorization, veteran, disability, EEO) | `sensitive_answers` (envelope-encrypted) | Critical | Discrimination, legal liability, loss of trust |
| Mailbox OAuth refresh tokens | `connections.token_ciphertext` | Critical | Read access to a user's email; Google can revoke Clew's Gmail access for everyone |
| Add-on tokens | Add-on storage, API token table | High | Read the full profile, drive autofill |
| Web session cookies and refresh tokens | Browser cookies, auth provider | High | Full account takeover |
| Per-user data keys and KMS access | KMS, service roles | Critical | Decrypts every sensitive answer and OAuth token |
| Field maps (per-site autofill rules served by the API) | API, database | High (integrity) | A tampered map can fill the wrong data into the wrong field, or into an attacker's form |
| Job catalog and match scores | `jobs`, `job_matches` | Low confidentiality, medium integrity | Fake or malicious postings shown to users |
| Audit log | `audit_log` | Medium (integrity critical) | Lost ability to investigate incidents |
| Service secrets (DB URL, API keys, KMS role, OAuth client secrets) | Secrets manager, CI | Critical | Everything above |
| Source code and CI | GitHub | High | Supply-chain compromise of web app and add-on |

## 4. Attackers

| Attacker | Capability | Most likely goal |
| --- | --- | --- |
| A1. Outside attacker on the internet | Sends any request to the API and web app, signs up for free accounts | Read other users' data (broken access control), take over accounts, mass-scrape profiles |
| A2. Account takeover attacker | Has a victim's email or a phished session | Read and export the victim's profile, connect their mailbox, pair a rogue add-on |
| A3. Malicious job posting or alert email | Controls text that Clew ingests from boards and emails | Stored XSS in the feed, prompt injection into the LLM, phishing links that look endorsed by Clew |
| A4. Hostile job-site page or script on it | Runs JavaScript in the same page the add-on fills | Read data the add-on puts in the DOM, trick the add-on into filling extra fields, message the add-on |
| A5. Lookalike or compromised add-on | Publishes a fake "Clew" add-on, or compromises the build or store account | Harvest profiles and tokens from many users at once |
| A6. Supply-chain attacker | Compromises an npm, PyPI or GitHub Action dependency | Run code in CI, the API, the web app or the add-on |
| A7. Insider or compromised operator account | Has cloud console, database or support-tool access | Bulk read of PII and sensitive answers |
| A8. Third-party processor | The LLM, auth, email or storage provider, or an attacker inside one | Retain or leak resume text |

Out of scope for v1: nation-state attackers, physical attacks on cloud data centers, and a fully compromised user device (if the user's own machine is owned, Clew cannot protect what the user can see).

## 5. Risks and mitigations

Each risk has an ID so PR reviews can cite it ("touches R4"). Likelihood (L) and impact (I) are High, Medium or Low before mitigation. "Required" mitigations must be in place before the feature they cover ships to real users.

### Accounts and sessions

| ID | Risk | L / I | Required mitigations |
| --- | --- | --- | --- |
| R1 | Broken object-level access: user A reads or edits user B's profile, resume, applications or connections by changing an id (IDOR) | H / H | Every query is scoped by the authenticated `user_id` taken from the session, never from the request body or path. Postgres row-level security on every per-user table as a second guard. Use random UUIDs, never sequential ids, in URLs. An automated test for every per-user endpoint that a second user gets 404. |
| R2 | Account takeover through credential stuffing, phishing or a weak auth provider setup | H / H | Passkeys by default; MFA required before connecting a mailbox, exporting data, pairing an add-on or deleting the account. Login rate limits and breached-password checks (auth provider). Verify the provider's tokens properly: check signature, issuer, audience and expiry on every request; reject `alg: none` and unexpected algorithms. Email change requires confirming from the old address. |
| R3 | Session theft or misuse: XSS reads the session token, CSRF on cookie-authenticated requests | M / H | Sign-in is Clerk, so session cookies follow Clerk's model: the app-domain `__session` cookie holds a short-lived (about 60s) session JWT that Clerk's SDK reads, so it is not HttpOnly; the long-lived `__client` credential is HttpOnly on Clerk's own domain, and Clerk rotates it. What Clew controls: a strict CSP with no inline script and no `dangerouslySetInnerHTML` on untrusted data (R16), because an XSS can read the short-lived token; verify the Clerk JWT on every API request (R2); CSRF protection on cookie-authenticated state-changing requests (SameSite=Lax plus an Origin check or CSRF token); never copy session or refresh tokens into localStorage or sessionStorage; "Sign out everywhere" revokes all Clerk sessions and all add-on tokens. |
| R4 | Social sign-in account linking: an attacker signs in with Google or LinkedIn using an unverified email that matches a victim's Clew account | M / H | Only link accounts on a provider-verified email, and require the existing user to confirm the link from inside their signed-in account. |

### Profile data, resumes and sensitive answers

| ID | Risk | L / I | Required mitigations |
| --- | --- | --- | --- |
| R5 | Database or backup leak exposes all profiles | M / H | Encryption at rest for database, backups and object storage with KMS keys. Network-private database; no public endpoint. Least-privilege database roles (the API cannot drop tables or read the audit log's admin views). Backups expire on a 30-day cycle. |
| R6 | Sensitive answers exposed or used without consent | M / Critical | Envelope encryption with a per-user data key, separate from general profile data. Decrypted only in the request that fills them, after an explicit user action, and never written to logs, caches, analytics, LLM prompts or job-match features. Not included in ranking. Every decrypt is written to the audit log. |
| R7 | Malicious resume upload: malware, oversized files, parser exploits, zip bombs, PDF scripts | M / M | Allowlist types (PDF, DOCX) checked by content, not by extension. Size limit (10 MB proposed). Malware scan before the file is parsed or served. Parse in an isolated worker with time and memory limits. Store under random keys; serve only through short-lived signed URLs with `Content-Disposition: attachment`. |
| R8 | PII leaks through logs, error trackers, analytics or support tools | H / H | Structured logging with an allowlist of fields; profile content, resume text, tokens and email bodies never logged. Scrub request bodies in the error tracker. No third-party analytics scripts on pages that show profile data. |
| R9 | Resume text sent to the LLM provider is retained or used for training | M / H | Use an LLM API with zero-retention or no-training terms in the contract. Send the minimum text needed; never send sensitive answers. List the provider as a processor in the privacy policy. |
| R10 | Bulk export abuse: a takeover attacker exports everything | M / H | Re-authentication and MFA before export. Export delivered as a download link to the signed-in session, plus an email notice to the account address. Rate limited and audit logged. |

### Browser add-on

| ID | Risk | L / I | Required mitigations |
| --- | --- | --- | --- |
| R11 | Over-broad permissions turn the add-on into spyware if compromised | M / Critical | Host permissions only for the supported job-site domains, never `<all_urls>`. No `cookies`, `history`, `webRequest` or `tabs` permissions unless a reviewed PR justifies them. Each new permission needs Security approval. |
| R12 | Hostile job-site page reads data the add-on placed in the page, or drives the add-on through messages | M / H | The add-on fills only fields the user ticked, one site at a time, after a user click. Content scripts never accept commands from page `postMessage` or DOM events; only the add-on's own UI can start a fill. Validate the page origin against the field map's domain before filling. Never inject profile data into the page except into the target input. Never presses Save, Submit or Apply. |
| R13 | Tampered or malicious field map fills data into the wrong place or an attacker's form | L / H | Field maps are served only by the Clew API over TLS, signed by the backend, and the add-on verifies the signature with a key built into the add-on. A field map can name only selectors on its own listed domain. Field-map changes go through PR review like code. |
| R14 | Stolen add-on token reads the full profile | M / H | Pairing through a one-time, short-lived code shown in the signed-in web app. Token is scoped to profile read and sync-event write only (no export, no settings, no mailbox). Shown in the device list and revocable. Rotated on a schedule. |
| R15 | Fake "Clew" add-on in a store, or the real store listing is hijacked | M / Critical | Store accounts protected with hardware-key MFA and owned by the company, not a person. Web app links only to the official store listing ids. Releases built by CI from a tagged commit, not from a laptop. Content Security Policy in the manifest with no remote code. |

### Ingested content: job boards and alert emails

| ID | Risk | L / I | Required mitigations |
| --- | --- | --- | --- |
| R16 | Stored XSS from job descriptions or email content rendered in the feed | H / H | Treat every posting and email as untrusted HTML. Sanitize on the server with an allowlist (e.g. `nh3`/`bleach`) and render with React's escaping; never `dangerouslySetInnerHTML` on unsanitized data. Strict CSP on the web app (no inline scripts). |
| R17 | Mailbox OAuth token leak or scope creep | M / Critical | Read-only scope; fetch only messages from a published allowlist of job-alert senders; never store full mailbox content, only parsed job fields. Tokens envelope-encrypted per user. Disconnect revokes the token at Google or Microsoft, not just in Clew. Google's restricted-scope security assessment passed before public launch. |
| R18 | Prompt injection: posting or email text tells the LLM to leak or change data | M / M | LLM output is treated as untrusted data and validated against a schema; the LLM never has tools or access to other users' data. Never put sensitive answers or other users' data in the prompt. |
| R19 | Server-side request forgery through job URLs, board tokens or company domains a user supplies | M / H | Workers fetch only from an allowlist of known source hosts (USAJobs, Greenhouse, Lever, Ashby APIs). No fetching of arbitrary user-supplied URLs. Block private and metadata IP ranges at the egress layer. |
| R20 | Phishing links in fake postings that look endorsed by Clew | M / M | Show the destination domain on every outbound link; mark jobs whose primary link is not the employer's ATS. Allow users to report a posting. |

### Platform, code and operations

| ID | Risk | L / I | Required mitigations |
| --- | --- | --- | --- |
| R21 | Secrets committed to the repo or leaked from CI | M / Critical | Gitleaks on every PR and push (PR #1). Secrets only in a secrets manager and GitHub encrypted secrets; `.env.example` with placeholders only. CI workflows use least-privilege `permissions:`, and workflows triggered by pull requests never receive deploy secrets. |
| R22 | Vulnerable or malicious dependency (npm, PyPI, GitHub Actions) | H / H | Lock files committed and installed with `npm ci` / hash-checked pip installs. Dependency scanning and Dependabot updates (section 6). Third-party GitHub Actions pinned to a full commit SHA. New dependencies called out in the PR description. |
| R23 | Injection in backend code (SQL, command, template) | M / H | SQLAlchemy parameterized queries only; no string-built SQL. No `shell=True` subprocess calls with user input. Static analysis in CI (section 6). |
| R24 | Over-privileged cloud roles or an insider bulk-reads data | L / Critical | Separate roles for API, workers and migrations. Production database access only through audited break-glass; no standing human access. Support tools never show sensitive answers. |
| R25 | No way to detect or investigate an incident | M / H | Append-only audit log for sign-ins, connections, pairings, syncs, exports, sensitive-answer decrypts and admin actions. Alerts on unusual export volume and repeated 403/404 patterns (IDOR probing). |
| R26 | Abuse and scraping: bots sign up to scrape the job catalog or burn LLM credits | H / M | Rate limits per user and per IP; captcha or similar on sign-up when abuse appears; quotas on resume parsing. |
| R27 | Deleted users' data lingers | M / M | Account deletion removes profile data and revokes all tokens (OAuth at the provider, add-on tokens) within 30 days; backups age out within 30 days. Deletion is tested. |

## 6. Automated scanning in CI

Each item should be a required check once branch protection is on. `security.yml` also runs weekly, so new advisories against unchanged lock files still show up.

| Check | Tool | When to add | Cost on a private repo |
| --- | --- | --- | --- |
| Secrets | Gitleaks (`secret-scan.yml`) | In place | Free for personal accounts |
| GitHub Actions | Every action pinned to a full commit SHA; Dependabot for `github-actions` keeps the pins current | In place | Free |
| Python dependencies | `pip-audit --strict --require-hashes` on the exported `uv.lock`, plus Dependabot for `uv` | In place (`security.yml`) | Free |
| JS dependencies | `npm audit --audit-level=high` for `apps/web` and `e2e`, plus Dependabot for `npm`. Add the add-on when it lands | In place (`security.yml`) | Free |
| Static analysis | Semgrep OSS with `p/python`, `p/typescript`, `p/react`, `p/secrets` and `p/github-actions` (WARNING and ERROR rules block); `ruff` `S` (bandit) rules in `ci.yml` | In place (`security.yml`) | Free |
| Workflow hardening | `actionlint` (with shellcheck) on `.github/workflows/` | In place (`security.yml`) | Free |
| Container images | Trivy scan of built images | First Dockerfile | Free |
| Add-on manifest check | A small test that fails if the manifest gains `<all_urls>` or a new permission | First add-on PR | Free |

GitHub's own CodeQL and dependency review action need GitHub Advanced Security on private repositories, so the free tools above are the default. If the repo moves to a plan with Advanced Security, CodeQL can replace Semgrep.

## 7. Security review checklist for every PR

Security reviews each PR against this list and cites risk IDs from section 5.

- Does any new endpoint read or write per-user data? It must scope by session `user_id` and have a cross-user test (R1).
- Does it add a log line, error report or analytics event? No profile content, resume text, tokens or email bodies (R8).
- Does it touch sensitive answers, OAuth tokens or keys? Encryption, consent and audit rules apply (R6, R17).
- Does it render content from postings, emails or users? Sanitized and escaped, no `dangerouslySetInnerHTML` on raw data (R16).
- Does it change the add-on manifest, content scripts or field maps? Permissions, origin checks and user-click rules apply (R11 to R14).
- Does it fetch a URL? Only allowlisted hosts (R19).
- Does it add a dependency or a GitHub Action? Pinned, locked and justified (R22).
- Does it add a secret or config value? Environment or secrets manager only, placeholder in `.env.example` (R21).
- Does it send data to a new third party? Needs a privacy-policy update and owner sign-off (R9).

## 8. Open questions

- Sign-in is Clerk (README). The design doc's "HttpOnly cookies only" rule doesn't hold for Clerk's `__session` cookie, and R3 is written for Clerk's model. If the owner wants HttpOnly-only sessions, that means a different provider or a backend session layer in front of Clerk. Clerk's account-linking settings also decide R4.
- Which LLM provider and what retention terms (R9)?
- Where will production run first (Render or AWS)? Render needs a plan for private networking and KMS-equivalent key management for envelope encryption (R5, R6).
- Branch protection on `main` is not yet on. Until it is, nothing technically stops a direct push, and "Security must approve" is a team rule rather than an enforced check.
