"""Made-up resume files for tests. No real person's data."""

import io
import zipfile

FAKE_PDF = (
    b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n% Jordan Example, made-up resume\n%%EOF\n"
)


def pdf_of_size(size: int) -> bytes:
    return FAKE_PDF + b"%" * (size - len(FAKE_PDF))


def docx(*, extra_parts: tuple[str, ...] = ()) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("word/document.xml", "<w:document>Jordan Example</w:document>")
        for name in extra_parts:
            package.writestr(name, "x")
    return buffer.getvalue()


def plain_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("notes.txt", "not a resume")
    return buffer.getvalue()


# The standard EICAR antivirus test string: harmless, but every scanner reports it. Built at
# runtime so the source file itself doesn't set off antivirus on a developer's machine.
EICAR = ("X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*").encode()


def infected_docx() -> bytes:
    """A Word file carrying EICAR as one of its parts. Real ClamAV unpacks the zip and flags
    it; EICAR pasted into a PDF's bytes is not flagged (QA found this in #89)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("word/document.xml", "<w:document>Jordan Example</w:document>")
        package.writestr("word/media/eicar.com", EICAR)
    return buffer.getvalue()


def clamav_would_flag(data: bytes) -> bool:
    """What real ClamAV 1.4 does with EICAR: it matches the whole file, or a whole member of
    a zip (which a .docx is). EICAR anywhere else in the bytes is not a match."""
    if data == EICAR:
        return True
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            return any(package.read(name) == EICAR for name in package.namelist())
    except zipfile.BadZipFile:
        return False


def text_pdf(text: str) -> bytes:
    """A real one-page PDF whose text layer is `text` (Helvetica, WinAnsi encoding)."""
    lines = text.splitlines() or [""]
    ops = [b"BT /F1 9 Tf 40 800 Td 11 TL"]
    for line in lines:
        escaped = (
            line.encode("cp1252")
            .replace(b"\\", b"\\\\")
            .replace(b"(", b"\\(")
            .replace(b")", b"\\)")
        )
        ops.append(b"(" + escaped + b") Tj T*")
    ops.append(b"ET")
    stream = b"\n".join(ops)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.7\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode()
    out += f"startxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def text_docx(text: str) -> bytes:
    """A minimal real Word document with one paragraph per line of `text`."""
    from xml.sax.saxutils import escape

    paragraphs = "".join(
        f'<w:p><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>'
        for line in text.splitlines()
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{paragraphs}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("word/document.xml", document)
    return buffer.getvalue()
