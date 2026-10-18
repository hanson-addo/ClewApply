"""Plain text from a resume file, with hard limits so a hostile file can't exhaust the worker.

Only files that passed the virus scan reach here. The text is resume content: never log it.
"""

import io
import logging
import re
import zipfile
from enum import StrEnum

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from pypdf import PdfReader

from clew.resumes.files import DOCX, PDF

MAX_PAGES = 10
MAX_CHARS = 50_000
# Uncompressed size of word/document.xml. A real two-page resume is well under 1 MB.
MAX_DOCX_XML_BYTES = 5 * 1024 * 1024
# Real document.xml files compress about 5-10:1. Far more than that is a zip bomb.
MAX_COMPRESSION_RATIO = 100

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# pypdf logs warnings about malformed files; those can quote file content.
logging.getLogger("pypdf").setLevel(logging.ERROR)


class ExtractError(StrEnum):
    ENCRYPTED = "encrypted"
    UNREADABLE = "unreadable"
    NO_TEXT = "no_text"
    TOO_LARGE = "too_large"
    # Crashed, ran out of memory or CPU, or took too long (see clew.resumes.isolation).
    EXTRACT_FAILED = "extract_failed"


class ExtractionFailed(Exception):
    def __init__(self, code: ExtractError) -> None:
        super().__init__(code.value)
        self.code = code


def extract_text(data: bytes, content_type: str) -> str:
    if content_type == PDF:
        text = _pdf_text(data)
    elif content_type == DOCX:
        text = _docx_text(data)
    else:
        raise ExtractionFailed(ExtractError.UNREADABLE)
    text = _tidy(text)[:MAX_CHARS]
    # Scanned (image-only) PDFs have no text layer; reading them needs OCR, which we don't do.
    if len(text) < 20:
        raise ExtractionFailed(ExtractError.NO_TEXT)
    return text


def _pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        # Not even an empty-password decrypt: encrypted files aren't read at all.
        if reader.is_encrypted:
            raise ExtractionFailed(ExtractError.ENCRYPTED)
        parts: list[str] = []
        size = 0
        page_count = min(len(reader.pages), MAX_PAGES)
        for index in range(page_count):
            page = reader.pages[index]
            part = page.extract_text() or ""
            parts.append(part)
            size += len(part)
            if size >= MAX_CHARS:
                break
        return "\n".join(parts)
    except ExtractionFailed:
        raise
    except Exception:  # pypdf raises all kinds of errors on malformed files
        raise ExtractionFailed(ExtractError.UNREADABLE) from None


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            info = package.getinfo("word/document.xml")
            with package.open(info) as f:
                # Read with a cap: the sizes in the zip's table of contents can lie.
                xml = f.read(MAX_DOCX_XML_BYTES + 1)
    except Exception:  # zipfile and zlib raise many kinds of errors
        raise ExtractionFailed(ExtractError.UNREADABLE) from None
    if len(xml) > MAX_DOCX_XML_BYTES:
        raise ExtractionFailed(ExtractError.TOO_LARGE)
    if len(xml) > MAX_COMPRESSION_RATIO * max(info.compress_size, 1):
        raise ExtractionFailed(ExtractError.TOO_LARGE)
    try:
        root = ElementTree.fromstring(xml)
    except (ElementTree.ParseError, DefusedXmlException):
        raise ExtractionFailed(ExtractError.UNREADABLE) from None

    paragraphs: list[str] = []
    for paragraph in root.iter(f"{W}p"):
        pieces: list[str] = []
        for node in paragraph.iter():
            if node.tag == f"{W}t" and node.text:
                pieces.append(node.text)
            elif node.tag == f"{W}tab":
                pieces.append("\t")
            elif node.tag in (f"{W}br", f"{W}cr"):
                pieces.append("\n")
        paragraphs.append("".join(pieces))
    return "\n".join(paragraphs)


_SPACES = re.compile(r"[ \t\u00a0]+")
_BLANK_LINES = re.compile(r"\n{3,}")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _tidy(text: str) -> str:
    text = _CONTROL.sub("", text)
    lines = (_SPACES.sub(" ", line).strip() for line in text.splitlines())
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()
