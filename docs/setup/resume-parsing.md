# Resume parsing

An uploaded resume is read into a draft profile in the background. The user checks the
draft (the fields listed in `check` first) and saves it with `PUT /profile`.

## How it runs

1. **Upload:** `POST /resumes` virus-scans and stores the file, then queues a parse job on
   Redis. The job payload holds only ids.
2. **Worker:** `uv run arq clew.worker.WorkerSettings` picks up the job. It logs in to
   Postgres as `clew_app` and binds the job's user, so row-level security applies.
3. **The job:**
   - Loads the file and scans it again, because signatures may be newer than at upload.
   - Extracts the text in a child process limited to 512 MB of memory, 20 s of CPU and
     30 s of wall-clock time. It reads the first 10 pages and 50,000 characters, and a
     DOCX's `word/document.xml` only (5 MB uncompressed at most, 100:1 compression at most).
   - Sends only that text to the LLM. The file, its name, the user's email and ids are
     never sent.
4. **The answer:** must fit `ProfileData`, or it's thrown away as `parse_invalid`. SSNs,
   birth dates, driver's license and passport numbers, and bank and card numbers are
   stripped from every text field. The result goes in `resume_parses`, and
   `GET /resumes/{id}/parse` reports it.

A service that's down (storage, scanner, LLM) is retried 3 more times, waiting 1, 2, then
3 minutes. After that the parse fails with "try again in a few minutes", and
`POST /resumes/{id}/parse` restarts it.

## Limits (threat model R26)

- **One at a time:** each user can have one resume being read at once.
- **Daily cap:** 10 parse starts per user per rolling 24 hours, counted in `usage_events`,
  which the API can only add to.

## Settings

| Variable | Meaning |
| --- | --- |
| `CLEW_REDIS_URL` | Redis for jobs. In production use `rediss://` (TLS) with a password, on the private network only. |
| `CLEW_ANTHROPIC_API_KEY` | LLM key. Use a separate key for each environment, and set a monthly spend limit in the Anthropic console. Keep keys in env vars or secrets only. |
| `CLEW_PARSER_MODEL` | Model id (default `claude-haiku-5-5`). |
| `CLEW_PARSER_TIMEOUT_SECONDS` | Per-request timeout for the LLM (default 60). |

Without Redis or a key, uploads still work, and parses report "unavailable".

## Before launch

- **Privacy policy:** name Anthropic as a subprocessor, and say that resume text is
  processed by an AI provider to fill in the profile.
- **Retention:** clear parse results 30 days after the user saves or dismisses them, and
  include `resume_parses` and `usage_events` in the owner-run account deletion job.

## Checking the parser for real

`uv run python scripts/eval_parser.py` sends the made-up resumes in `tests/fixtures/resumes`
to the real LLM and lists every field that differs from the expected output. It needs a
key. CI never runs it.
