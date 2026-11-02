"""Text extraction from resume files (#12), against the made-up fixture resumes."""

import io
import random
import zipfile

import pytest
from pypdf import PdfWriter

from clew.resumes.files import DOCX, PDF
from clew.resumes.isolation import CHILD_ENV_KEEP, run_isolated
from clew.resumes.text import (
    MAX_CHARS,
    MAX_DOCX_XML_BYTES,
    MAX_PAGES,
    ExtractError,
    ExtractionFailed,
    extract_text,
)
from tests.file_helpers import FAKE_PDF, text_docx, text_pdf
from tests.resume_fixtures import NAMES, resume_text


def lines(text: str) -> list[str]:
    return [" ".join(line.split()) for line in text.splitlines() if line.strip()]


def test_there_are_at_least_five_fixture_resumes() -> None:
    assert len(NAMES) >= 5


@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize(("build", "content_type"), [(text_pdf, PDF), (text_docx, DOCX)])
def test_fixture_text_comes_out_intact(name: str, build: object, content_type: str) -> None:
    source = resume_text(name)
    assert callable(build)
    text = extract_text(build(source), content_type)
    assert lines(text) == lines(source)


def test_only_the_first_pages_are_read() -> None:
    writer = PdfWriter()
    for _ in range(MAX_PAGES + 5):
        writer.add_blank_page(612, 792)
    buffer = io.BytesIO()
    writer.write(buffer)
    # Blank pages: no text at all, so this also shows the cap doesn't crash on empty pages.
    with pytest.raises(ExtractionFailed) as caught:
        extract_text(buffer.getvalue(), PDF)
    assert caught.value.code is ExtractError.NO_TEXT


def test_text_is_capped() -> None:
    # Varied words, so the file compresses like a real one and not like a zip bomb.
    rng = random.Random(7)  # noqa: S311 - test data, not security
    words = " ".join(f"w{rng.randrange(10**6)}" for _ in range(MAX_CHARS // 4))
    text = extract_text(text_docx(words), DOCX)
    assert len(text) == MAX_CHARS


def test_password_protected_pdf() -> None:
    writer = PdfWriter()
    writer.add_blank_page(612, 792)
    writer.encrypt(user_password="made-up-password")  # noqa: S106 - test file only
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(ExtractionFailed) as caught:
        extract_text(buffer.getvalue(), PDF)
    assert caught.value.code is ExtractError.ENCRYPTED


@pytest.mark.parametrize(
    "data",
    [FAKE_PDF, b"%PDF-1.7\n" + b"\x00garbage" * 100, b"%PDF-"],
)
def test_broken_pdfs_fail_cleanly(data: bytes) -> None:
    with pytest.raises(ExtractionFailed) as caught:
        extract_text(data, PDF)
    assert caught.value.code in (ExtractError.UNREADABLE, ExtractError.NO_TEXT)


def test_docx_with_huge_document_xml_is_refused() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        # Compresses to almost nothing: the shape of a zip bomb.
        package.writestr("word/document.xml", "<a>" + " " * (MAX_DOCX_XML_BYTES + 10) + "</a>")
    assert len(buffer.getvalue()) < 100_000
    with pytest.raises(ExtractionFailed) as caught:
        extract_text(buffer.getvalue(), DOCX)
    assert caught.value.code is ExtractError.TOO_LARGE


def test_docx_entity_expansion_is_refused() -> None:
    bomb = (
        '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">'
        '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>'
        "<w:document>&lol2;</w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("word/document.xml", bomb)
    with pytest.raises(ExtractionFailed) as caught:
        extract_text(buffer.getvalue(), DOCX)
    assert caught.value.code is ExtractError.UNREADABLE


def test_docx_without_document_is_unreadable() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("[Content_Types].xml", "<Types/>")
    with pytest.raises(ExtractionFailed):
        extract_text(buffer.getvalue(), DOCX)


def test_control_characters_are_dropped() -> None:
    text = extract_text(text_pdf("Avery\x07 Quinlan\x1b, made-up engineer resume"), PDF)
    assert text == "Avery Quinlan, made-up engineer resume"


def test_docx_compressing_over_100_to_1_is_refused() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        # Under the 5 MB cap, but squeezes about 1000:1.
        package.writestr("word/document.xml", "<a>" + " " * (2 * 1024 * 1024) + "</a>")
    with pytest.raises(ExtractionFailed) as caught:
        extract_text(buffer.getvalue(), DOCX)
    assert caught.value.code is ExtractError.TOO_LARGE


def thousand_page_pdf() -> bytes:
    writer = PdfWriter()
    writer.append(io.BytesIO(text_pdf("Avery Quinlan\nSenior Software Engineer, made-up")))
    for _ in range(999):
        writer.add_blank_page(612, 792)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


async def test_thousand_page_pdf_reads_only_the_first_pages() -> None:
    import time

    data = thousand_page_pdf()
    started = time.monotonic()
    text = await run_isolated(extract_text, data, PDF)
    assert text == "Avery Quinlan\nSenior Software Engineer, made-up"
    assert time.monotonic() - started < 15


# Stand-ins for a hostile file's effect on the parser. Top level, so the child can import them.


def hang_forever(_: bytes, __: str) -> str:
    import time

    while True:
        time.sleep(1)


def spin_forever(_: bytes, __: str) -> str:
    while True:
        pass


def eat_memory(_: bytes, __: str) -> str:
    hoard = []
    while True:
        hoard.append(bytearray(64 * 1024 * 1024))


def crash(_: bytes, __: str) -> str:
    import os

    os._exit(3)


async def test_a_hanging_extractor_is_killed() -> None:
    import time

    started = time.monotonic()
    with pytest.raises(ExtractionFailed) as caught:
        await run_isolated(hang_forever, b"", PDF, wall_seconds=1)
    assert caught.value.code is ExtractError.EXTRACT_FAILED
    assert time.monotonic() - started < 10


async def test_a_spinning_extractor_is_killed() -> None:
    with pytest.raises(ExtractionFailed) as caught:
        await run_isolated(spin_forever, b"", PDF, wall_seconds=2)
    assert caught.value.code is ExtractError.EXTRACT_FAILED


async def test_memory_is_capped() -> None:
    with pytest.raises(ExtractionFailed) as caught:
        await run_isolated(eat_memory, b"", PDF)
    assert caught.value.code is ExtractError.EXTRACT_FAILED


async def test_a_crashing_extractor_fails_cleanly() -> None:
    with pytest.raises(ExtractionFailed) as caught:
        await run_isolated(crash, b"", PDF)
    assert caught.value.code is ExtractError.EXTRACT_FAILED


async def test_extraction_errors_come_back_from_the_child() -> None:
    with pytest.raises(ExtractionFailed) as caught:
        await run_isolated(extract_text, text_pdf(""), PDF)
    assert caught.value.code is ExtractError.NO_TEXT


def report_environment(_: bytes, __: str) -> str:
    import os

    return ",".join(sorted(os.environ))


async def test_the_extractor_gets_no_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    import os

    monkeypatch.setenv("CLEW_ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setenv("CLEW_DATABASE_URL", "postgresql://example.test/clew")
    monkeypatch.setenv("HOME_SECRET_FOR_TEST", "placeholder")
    names = (await run_isolated(report_environment, b"", PDF)).split(",")
    assert not [name for name in names if name.startswith("CLEW_")]
    assert "HOME_SECRET_FOR_TEST" not in names
    # Anything else is what the child's own interpreter sets up (locale, terminal size).
    assert set(names) - {*CHILD_ENV_KEEP, ""} <= {"LC_CTYPE", "COLUMNS", "LINES"}
    # The worker's own environment is back as it was.
    assert os.environ["CLEW_ANTHROPIC_API_KEY"] == "test-key-not-real"
