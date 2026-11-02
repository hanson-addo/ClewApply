// Made-up test files, built in memory at test time. No real resumes (CLAUDE.md).
import { crc32 } from "node:zlib";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const PDF_START = Buffer.from(
  "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n% Ariadne Testuser, made-up resume\n",
);
const PDF_END = Buffer.from("%%EOF\n");

/** A small PDF, padded with PDF comment bytes to exactly `size` bytes when given. */
export function pdf(size?: number): Buffer {
  const base = Buffer.concat([PDF_START, PDF_END]);
  if (size === undefined) return base;
  return Buffer.concat([PDF_START, Buffer.alloc(size - base.length, "%"), PDF_END]);
}

/**
 * A Word document carrying the standard EICAR antivirus test file as an embedded file. Harmless,
 * but every scanner flags it. ClamAV matches EICAR only as a whole file, so pasting the string
 * into a PDF isn't enough; it does unpack the .docx and check each part. The string is built
 * from two halves so this source file itself doesn't trip a scanner.
 */
export function eicarDocx(): Buffer {
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  return zip({ ...DOCX_PARTS, "word/embeddings/oleObject1.bin": eicar });
}

/** The first bytes of a Windows program: what a renamed .exe looks like. */
export function windowsProgram(): Buffer {
  return Buffer.concat([Buffer.from("MZ"), Buffer.alloc(254, 0)]);
}

/** A minimal Word document: a zip with the two parts that make a package a .docx. */
export function docx(): Buffer {
  return zip(DOCX_PARTS);
}

const DOCX_PARTS = {
  "[Content_Types].xml":
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  "word/document.xml":
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ariadne Testuser</w:t></w:r></w:p></w:body></w:document>',
};

/** A zip with uncompressed entries, enough for the server's package check. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * A real one-page PDF with a text layer, so the server can read `lines` back out. Pass no
 * lines for a page with no text at all, like a scanned image. `encrypted` adds an /Encrypt
 * entry, which is how a password-protected PDF announces itself.
 */
export function textPdf(lines: string[], { encrypted = false } = {}): Buffer {
  const escape = (line: string) => line.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = lines.length
    ? `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${escape(l)}) '`).join(" ")} ET`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (encrypted) {
    // Standard security handler, 40-bit RC4. The keys are made up: the file is only refused.
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /O <${"28bf4e5e".repeat(8)}> /U <${"0a1b2c3d".repeat(8)}> /P -44 >>`,
    );
  }
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  const encrypt = encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<${"ab".repeat(16)}> <${"ab".repeat(16)}>]` : "";
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** A Word document whose text part is bigger than the server will read (over 5 MB). */
export function oversizedDocx(): Buffer {
  const paragraph = "<w:p><w:r><w:t>Ariadne Testuser wound the thread.</w:t></w:r></w:p>";
  const count = Math.ceil((5 * 1024 * 1024) / paragraph.length) + 1;
  return zip({
    ...DOCX_PARTS,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph.repeat(count)}</w:body></w:document>`,
  });
}
