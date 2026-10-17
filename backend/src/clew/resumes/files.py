"""Checks on uploaded resume files. The file's content decides its type, never its name."""

import io
import re
import zipfile
from pathlib import PurePosixPath

MAX_RESUME_BYTES = 10 * 1024 * 1024

PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

EXTENSIONS = {PDF: ".pdf", DOCX: ".docx"}


def detect_resume_type(data: bytes) -> str | None:
    """PDF or DOCX by content (magic bytes and package layout), or None for anything else."""
    if data.startswith(b"%PDF-"):
        return PDF
    if data.startswith(b"PK\x03\x04") and _is_plain_docx(data):
        return DOCX
    return None


def _is_plain_docx(data: bytes) -> bool:
    # Reads only the zip's table of contents; nothing is decompressed, so a zip bomb
    # costs nothing here. The 10 MB cap bounds the table itself.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            names = set(package.namelist())
    except (zipfile.BadZipFile, ValueError, EOFError):
        return False
    is_word = "[Content_Types].xml" in names and "word/document.xml" in names
    # Macro-enabled documents (.docm renamed to .docx) carry a VBA project.
    has_macros = any(name.lower().endswith("vbaproject.bin") for name in names)
    return is_word and not has_macros


_UNSAFE = re.compile(r"[^A-Za-z0-9 ._()-]")


def safe_filename(original: str | None, content_type: str) -> str:
    """A display name safe for a Content-Disposition header, with the extension set by type."""
    stem = PurePosixPath((original or "").replace("\\", "/")).stem
    stem = _UNSAFE.sub("", stem).strip(" .")[:100].strip(" .")
    return f"{stem or 'resume'}{EXTENSIONS[content_type]}"
