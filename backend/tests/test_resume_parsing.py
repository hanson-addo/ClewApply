"""Reading an uploaded resume into a draft profile, end to end (#12): upload, the worker's
job, and what the user sees. The LLM is a fake; the files are made-up resumes."""

import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clew.api.resume_parse import DAILY_PARSE_LIMIT, MESSAGES, TRY_AGAIN
from clew.auth.deps import get_token_verifier
from clew.db.session import get_sessionmaker
from clew.jobs import QueueUnavailable, get_job_queue
from clew.main import create_app
from clew.models import ParseStatus, Resume, ResumeParse
from clew.resumes.parser import ParsedResume, ParseFailed, ParserUnavailable, to_parsed_resume
from clew.resumes.parsing import ParseError, RetryLater, run_parse
from clew.scanning import get_malware_scanner
from clew.storage import get_object_store
from tests.file_helpers import infected_docx, text_docx, text_pdf
from tests.resume_fixtures import expected_profile, resume_text
from tests.test_auth import verifier
from tests.test_resume_parser import sure_of_everything
from tests.test_resumes import KEY, FakeScanner, MemoryStore, as_user, upload


class FakeQueue:
    def __init__(self) -> None:
        self.jobs: list[tuple[uuid.UUID, uuid.UUID]] = []
        self.down = False

    async def enqueue_parse(self, parse_id: uuid.UUID, user_id: uuid.UUID) -> None:
        if self.down:
            raise QueueUnavailable
        self.jobs.append((parse_id, user_id))


class FakeParser:
    def __init__(self, name: str = "software-engineer") -> None:
        self.output = sure_of_everything(expected_profile(name))
        self.error: Exception | None = None
        self.texts: list[str] = []

    async def parse(self, text: str) -> ParsedResume:
        self.texts.append(text)
        if self.error is not None:
            raise self.error
        return to_parsed_resume(self.output)


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def scanner() -> FakeScanner:
    return FakeScanner()


@pytest.fixture
def queue() -> FakeQueue:
    return FakeQueue()


@pytest.fixture
def parser() -> FakeParser:
    return FakeParser()


@pytest.fixture
async def api(
    store: MemoryStore, scanner: FakeScanner, queue: FakeQueue
) -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    app.dependency_overrides[get_object_store] = lambda: store
    app.dependency_overrides[get_malware_scanner] = lambda: scanner
    app.dependency_overrides[get_job_queue] = lambda: queue
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def alice() -> dict[str, str]:
    return as_user(f"user_parse_alice_{uuid.uuid4().hex[:8]}")


@pytest.fixture
def bob() -> dict[str, str]:
    return as_user(f"user_parse_bob_{uuid.uuid4().hex[:8]}")


async def upload_resume(
    api: AsyncClient, who: dict[str, str], data: bytes | None = None, name: str = "cv.pdf"
) -> str:
    data = data if data is not None else text_pdf(resume_text("software-engineer"))
    response = await api.post("/resumes", headers=who, files=upload(name, data))
    assert response.status_code == 201, response.text
    resume_id: str = response.json()["id"]
    return resume_id


async def run_jobs(
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser | None,
    *,
    final_attempt: bool = True,
) -> None:
    jobs, queue.jobs = queue.jobs, []
    for parse_id, user_id in jobs:
        await run_parse(
            get_sessionmaker(),
            store=store,
            scanner=scanner,
            parser=parser,
            parse_id=parse_id,
            user_id=user_id,
            final_attempt=final_attempt,
        )


async def parse_state(api: AsyncClient, who: dict[str, str], resume_id: str) -> dict[str, Any]:
    response = await api.get(f"/resumes/{resume_id}/parse", headers=who)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_upload_queues_a_parse_and_the_job_fills_in_the_draft(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    resume_id = await upload_resume(api, alice)
    assert len(queue.jobs) == 1
    assert (await parse_state(api, alice, resume_id))["status"] == "pending"

    scans_before = scanner.scanned
    await run_jobs(queue, store, scanner, parser)
    # Scanned again before reading, in case signatures are newer than at upload.
    assert scanner.scanned == scans_before + 1
    assert "Nimbus Ledger Inc." in parser.texts[0]

    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "done"
    assert state["message"] is None
    assert state["result"]["profile"]["basics"]["name"] == "Avery Quinlan"
    assert state["result"]["check"] == []


async def test_word_files_are_read_too(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    data = text_docx(resume_text("registered-nurse"))
    resume_id = await upload_resume(api, alice, data, "cv.docx")
    await run_jobs(queue, store, scanner, parser)
    assert "ICU Staff Nurse" in parser.texts[0]
    assert (await parse_state(api, alice, resume_id))["status"] == "done"


async def test_the_draft_can_be_saved_as_the_profile(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    resume_id = await upload_resume(api, alice)
    await run_jobs(queue, store, scanner, parser)
    draft = (await parse_state(api, alice, resume_id))["result"]["profile"]

    saved = await api.put(
        "/profile", headers=alice, json={"data": draft, "change_summary": "From my resume"}
    )
    assert saved.status_code == 200
    assert saved.json()["data"]["basics"]["name"] == "Avery Quinlan"


async def test_newly_detected_malware_fails_the_parse_and_blocks_download(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    resume_id = await upload_resume(api, alice)
    # Signatures updated since the upload: the stored file is now flagged.
    for key, (_, content_type) in store.objects.items():
        store.objects[key] = (infected_docx(), content_type)
    await run_jobs(queue, store, scanner, parser)

    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "failed"
    assert state["message"] == MESSAGES[ParseError.INFECTED]
    assert parser.texts == []
    download = await api.get(f"/resumes/{resume_id}/download", headers=alice)
    assert download.status_code == 409


@pytest.mark.parametrize(
    ("data", "error"),
    [
        (text_pdf(""), ParseError.NO_TEXT),
        (b"%PDF-1.7\n" + b"\x00broken" * 50, ParseError.UNREADABLE),
    ],
)
async def test_unreadable_files_fail_with_a_message(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
    data: bytes,
    error: ParseError,
) -> None:
    resume_id = await upload_resume(api, alice, data)
    await run_jobs(queue, store, scanner, parser)
    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "failed"
    assert state["message"] == MESSAGES[error]
    assert parser.texts == []


async def test_parser_giving_bad_output_fails(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    parser.error = ParseFailed()
    resume_id = await upload_resume(api, alice)
    await run_jobs(queue, store, scanner, parser)
    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "failed"
    assert state["message"] == MESSAGES[ParseError.PARSE_FAILED]


async def test_an_unexpected_error_fails_the_parse_without_logging_it(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    parser.error = RuntimeError("Quoted resume text: Nimbus Analytics")
    resume_id = await upload_resume(api, alice)
    await run_jobs(queue, store, scanner, parser)
    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "failed"
    assert state["message"] == MESSAGES[ParseError.PARSE_FAILED]
    crashed = [r for r in caplog.records if r.getMessage() == "resume_parse_crashed"]
    assert [r.__dict__["error"] for r in crashed] == ["RuntimeError"]
    assert "Nimbus" not in caplog.text


@pytest.mark.parametrize("down", ["parser", "scanner", "store", "no_parser"])
async def test_a_service_being_down_retries_then_fails(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
    down: str,
) -> None:
    resume_id = await upload_resume(api, alice)
    parser.error = ParserUnavailable() if down == "parser" else None
    scanner.down = down == "scanner"
    store.fail = down == "store"
    job_parser = None if down == "no_parser" else parser

    jobs = list(queue.jobs)
    with pytest.raises(RetryLater):
        await run_jobs(queue, store, scanner, job_parser, final_attempt=False)
    assert (await parse_state(api, alice, resume_id))["status"] == "pending"

    queue.jobs = jobs
    await run_jobs(queue, store, scanner, job_parser, final_attempt=True)
    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "failed"
    assert state["message"] == TRY_AGAIN


async def test_queue_down_at_upload_keeps_the_file_and_can_be_retried(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    queue.down = True
    resume_id = await upload_resume(api, alice)
    state = await parse_state(api, alice, resume_id)
    assert (state["status"], state["message"]) == ("failed", TRY_AGAIN)

    queue.down = False
    retry = await api.post(f"/resumes/{resume_id}/parse", headers=alice)
    assert retry.status_code == 202
    assert retry.json()["status"] == "pending"
    await run_jobs(queue, store, scanner, parser)
    assert (await parse_state(api, alice, resume_id))["status"] == "done"


async def test_restart_doesnt_requeue_a_parse_in_progress_or_done(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    resume_id = await upload_resume(api, alice)
    assert len(queue.jobs) == 1
    await api.post(f"/resumes/{resume_id}/parse", headers=alice)
    assert len(queue.jobs) == 1

    await run_jobs(queue, store, scanner, parser)
    again = await api.post(f"/resumes/{resume_id}/parse", headers=alice)
    assert again.json()["status"] == "done"
    assert queue.jobs == []


async def test_a_stalled_parse_reads_as_failed_and_can_be_restarted(
    api: AsyncClient, alice: dict[str, str], queue: FakeQueue, db: AsyncSession
) -> None:
    resume_id = await upload_resume(api, alice)
    queue.jobs = []
    await db.execute(
        update(ResumeParse)
        .where(ResumeParse.resume_id == uuid.UUID(resume_id))
        .values(status=ParseStatus.RUNNING, updated_at=datetime.now(UTC) - timedelta(hours=1))
    )
    await db.commit()

    state = await parse_state(api, alice, resume_id)
    assert state["status"] == "failed"
    assert state["message"] == TRY_AGAIN
    retry = await api.post(f"/resumes/{resume_id}/parse", headers=alice)
    assert retry.json()["status"] == "pending"
    assert len(queue.jobs) == 1


async def test_a_job_finished_twice_does_nothing_the_second_time(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    await upload_resume(api, alice)
    jobs = list(queue.jobs)
    await run_jobs(queue, store, scanner, parser)
    queue.jobs = jobs
    await run_jobs(queue, store, scanner, parser)
    assert len(parser.texts) == 1


async def test_another_user_cannot_see_or_restart_your_parse(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    resume_id = await upload_resume(api, alice)
    await run_jobs(queue, store, scanner, parser)
    assert (await api.get(f"/resumes/{resume_id}/parse", headers=bob)).status_code == 404
    assert (await api.post(f"/resumes/{resume_id}/parse", headers=bob)).status_code == 404
    assert queue.jobs == []


async def test_a_job_with_the_wrong_user_touches_nothing(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    resume_id = await upload_resume(api, alice)
    bob_id = uuid.UUID((await api.get("/me", headers=bob)).json()["id"])
    [(parse_id, _alice_id)] = queue.jobs
    await run_parse(
        get_sessionmaker(),
        store=store,
        scanner=scanner,
        parser=parser,
        parse_id=parse_id,
        user_id=bob_id,
        final_attempt=True,
    )
    assert parser.texts == []
    assert (await parse_state(api, alice, resume_id))["status"] == "pending"


async def test_pending_scan_resume_is_never_read(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
    db: AsyncSession,
) -> None:
    resume_id = await upload_resume(api, alice)
    await db.execute(
        update(Resume).where(Resume.id == uuid.UUID(resume_id)).values(scan_status="pending")
    )
    await db.commit()
    await run_jobs(queue, store, scanner, parser)
    assert parser.texts == []
    state = await parse_state(api, alice, resume_id)
    assert state["message"] == MESSAGES[ParseError.NOT_SCANNED]
    assert (await api.post(f"/resumes/{resume_id}/parse", headers=alice)).status_code == 409


async def test_no_parse_yet_is_404(
    api: AsyncClient, alice: dict[str, str], db: AsyncSession
) -> None:
    resume_id = await upload_resume(api, alice)
    parse = await db.scalar(
        select(ResumeParse).where(ResumeParse.resume_id == uuid.UUID(resume_id))
    )
    assert parse is not None
    await db.delete(parse)
    await db.commit()
    assert (await api.get(f"/resumes/{resume_id}/parse", headers=alice)).status_code == 404


async def test_resume_text_and_draft_are_not_logged(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    caplog.set_level(logging.DEBUG)
    resume_id = await upload_resume(api, alice)
    await run_jobs(queue, store, scanner, parser)
    await parse_state(api, alice, resume_id)
    assert "Nimbus" not in caplog.text
    assert "Avery" not in caplog.text
    assert "resume_parsed" in caplog.text


async def test_output_outside_the_schema_is_parse_invalid_and_not_stored(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
    db: AsyncSession,
) -> None:
    parser.output = {"profile": {"basics": {"name": "Hacked", "password": "x"}}, "confidence": []}
    resume_id = await upload_resume(api, alice, text_pdf(resume_text("sensitive-and-injection")))
    await run_jobs(queue, store, scanner, parser)
    stored = await db.scalar(
        select(ResumeParse).where(ResumeParse.resume_id == uuid.UUID(resume_id))
    )
    assert stored is not None
    assert (stored.status, stored.error_code, stored.result) == ("failed", "parse_invalid", None)


async def test_only_one_resume_is_read_at_a_time(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    first = await upload_resume(api, alice)
    second = await upload_resume(api, alice)
    assert len(queue.jobs) == 1
    state = await parse_state(api, alice, second)
    assert (state["status"], state["message"]) == ("failed", MESSAGES[ParseError.BUSY])
    refused = await api.post(f"/resumes/{second}/parse", headers=alice)
    assert refused.status_code == 429

    await run_jobs(queue, store, scanner, parser)
    assert (await parse_state(api, alice, first))["status"] == "done"
    retry = await api.post(f"/resumes/{second}/parse", headers=alice)
    assert retry.status_code == 202
    assert len(queue.jobs) == 1


async def test_daily_parse_limit(
    api: AsyncClient,
    alice: dict[str, str],
    queue: FakeQueue,
    store: MemoryStore,
    scanner: FakeScanner,
    parser: FakeParser,
) -> None:
    for _ in range(DAILY_PARSE_LIMIT):
        await upload_resume(api, alice)
        await run_jobs(queue, store, scanner, parser)
    over = await upload_resume(api, alice)
    assert queue.jobs == []
    state = await parse_state(api, alice, over)
    assert state["message"] == MESSAGES[ParseError.DAILY_LIMIT]
    assert (await api.post(f"/resumes/{over}/parse", headers=alice)).status_code == 429


async def test_limits_are_per_user(
    api: AsyncClient,
    alice: dict[str, str],
    bob: dict[str, str],
    queue: FakeQueue,
) -> None:
    await upload_resume(api, alice)
    bobs = await upload_resume(api, bob)
    assert len(queue.jobs) == 2
    assert (await parse_state(api, bob, bobs))["status"] == "pending"


async def test_usage_events_are_append_only_for_the_app(
    api: AsyncClient, alice: dict[str, str], app_db: AsyncSession
) -> None:
    from sqlalchemy import delete
    from sqlalchemy.exc import DBAPIError

    from clew.db.session import bind_user
    from clew.models import UsageEvent

    await upload_resume(api, alice)
    alice_id = uuid.UUID((await api.get("/me", headers=alice)).json()["id"])
    for statement in (
        delete(UsageEvent).where(UsageEvent.user_id == alice_id),
        update(UsageEvent).where(UsageEvent.user_id == alice_id).values(kind="x"),
        delete(ResumeParse).where(ResumeParse.user_id == alice_id),
    ):
        await bind_user(app_db, alice_id)
        with pytest.raises(DBAPIError, match="permission denied"):
            await app_db.execute(statement)
        await app_db.rollback()
