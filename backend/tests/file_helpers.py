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
