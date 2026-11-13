"""Reads one uploaded resume into a draft profile: the job the worker runs.

Steps: load the file, scan it again (signatures may be newer than at upload), extract the
text, and send it to the parser. The outcome is stored on the resume's `resume_parses` row.
Nothing here logs resume text or the draft profile.
"""

import logging
import uuid
from enum import StrEnum
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from clew.consent import has_ai_consent
from clew.db.session import bind_user
from clew.models import ParseStatus, Resume, ResumeParse
from clew.resumes.files import MAX_RESUME_BYTES
from clew.resumes.isolation import run_isolated
from clew.resumes.parser import ParseFailed, ParseInvalid, ParserUnavailable, ResumeParser
from clew.resumes.text import ExtractionFailed, extract_text
from clew.scanning import MalwareScanner, ScannerUnavailable, ScanVerdict
from clew.storage import ObjectStore, StorageUnavailable

logger = logging.getLogger(__name__)


class ParseError(StrEnum):
    ENCRYPTED = "encrypted"
    NO_TEXT = "no_text"
    UNREADABLE = "unreadable"
    TOO_LARGE = "too_large"
    PARSE_FAILED = "parse_failed"
    # The LLM answered with something outside the profile schema; it isn't stored.
    PARSE_INVALID = "parse_invalid"
    EXTRACT_FAILED = "extract_failed"
    INFECTED = "infected"
    NOT_SCANNED = "not_scanned"
    UNAVAILABLE = "unavailable"
    # Refused before starting (threat model R26).
    BUSY = "busy"
    DAILY_LIMIT = "daily_limit"
    # The user hasn't agreed to AI reading, or withdrew before the text was sent (#75).
    NO_CONSENT = "no_consent"


class RetryLater(Exception):
    """A service the job needs is down; the queue should run it again later."""


async def run_parse(
    sessions: async_sessionmaker[AsyncSession],
    *,
    store: ObjectStore | None,
    scanner: MalwareScanner | None,
    parser: ResumeParser | None,
    parse_id: uuid.UUID,
    user_id: uuid.UUID,
    final_attempt: bool,
) -> None:
    async with sessions() as session:
        await bind_user(session, user_id)
        parse = await session.scalar(
            select(ResumeParse)
            .where(ResumeParse.id == parse_id, ResumeParse.user_id == user_id)
            .with_for_update()
        )
        if parse is None or parse.status == ParseStatus.DONE:
            return
        resume = await session.scalar(
            select(Resume).where(
                Resume.id == parse.resume_id,
                Resume.user_id == user_id,
                Resume.deleted_at.is_(None),
            )
        )
        if resume is None:
            await _finish(session, parse_id, user_id, error=ParseError.UNREADABLE)
            return
        if resume.scan_status != ScanVerdict.CLEAN:
            await _finish(session, parse_id, user_id, error=ParseError.NOT_SCANNED)
            return
        if not await has_ai_consent(session, user_id):
            await _finish(session, parse_id, user_id, error=ParseError.NO_CONSENT)
            return
        await session.execute(
            update(ResumeParse)
            .where(ResumeParse.id == parse_id, ResumeParse.user_id == user_id)
            .values(status=ParseStatus.RUNNING, updated_at=func.now())
        )
        await session.commit()
        resume_id, file_key, content_type = resume.id, resume.file_key, resume.content_type

    # Outside any transaction: the slow steps hold no locks.
    error: ParseError | None = None
    result: dict[str, Any] | None = None
    try:
        if store is None or scanner is None or parser is None:
            raise RetryLater
        data = await store.get(file_key, MAX_RESUME_BYTES)
        if await scanner.scan(data) is not ScanVerdict.CLEAN:
            error = ParseError.INFECTED
        else:
            text = await run_isolated(extract_text, data, content_type)
            # Checked again right before the text leaves Clew: the user may have withdrawn
            # while the file was fetched and read.
            if await _consented(sessions, user_id):
                result = (await parser.parse(text)).model_dump(mode="json", exclude_none=True)
            else:
                error = ParseError.NO_CONSENT
    except (StorageUnavailable, ScannerUnavailable, ParserUnavailable, RetryLater):
        if not final_attempt:
            async with sessions() as session:
                await bind_user(session, user_id)
                await _set(session, parse_id, user_id, status=ParseStatus.PENDING)
            raise RetryLater from None
        error = ParseError.UNAVAILABLE
    except ExtractionFailed as exc:
        error = ParseError(exc.code.value)
    except ParseInvalid:
        error = ParseError.PARSE_INVALID
    except ParseFailed:
        error = ParseError.PARSE_FAILED
    except Exception as exc:  # Any other bug must still finish the parse.
        # The type only: a message can quote resume text.
        logger.error("resume_parse_crashed", extra={"error": type(exc).__name__})
        error = ParseError.PARSE_FAILED

    async with sessions() as session:
        await bind_user(session, user_id)
        if error is ParseError.INFECTED:
            # Newer signatures caught it: block downloads of this file too.
            await session.execute(
                update(Resume)
                .where(Resume.id == resume_id, Resume.user_id == user_id)
                .values(scan_status=ScanVerdict.INFECTED)
            )
        await _finish(session, parse_id, user_id, error=error, result=result)
    logger.info("resume_parsed", extra={"outcome": error.value if error else "done"})


async def _consented(sessions: async_sessionmaker[AsyncSession], user_id: uuid.UUID) -> bool:
    async with sessions() as session:
        await bind_user(session, user_id)
        return await has_ai_consent(session, user_id)


async def _finish(
    session: AsyncSession,
    parse_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    error: ParseError | None,
    result: dict[str, Any] | None = None,
) -> None:
    await _set(
        session,
        parse_id,
        user_id,
        status=ParseStatus.FAILED if error else ParseStatus.DONE,
        result=None if error else result,
        error_code=error.value if error else None,
    )


async def _set(
    session: AsyncSession, parse_id: uuid.UUID, user_id: uuid.UUID, **values: Any
) -> None:
    await session.execute(
        update(ResumeParse)
        .where(ResumeParse.id == parse_id, ResumeParse.user_id == user_id)
        .values(**values, updated_at=func.now())
    )
    await session.commit()
