import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL, hasClerk, hasUploadServices } from "../env";
import { bearer, signInForApi } from "./api-as";
import { docx, eicarDocx, MAX_RESUME_BYTES, pdf, windowsProgram } from "./files";

// Resume upload through the real stack (test plan §3.2): a real Clerk session, real ClamAV
// and S3-compatible storage (MinIO in CI), and the API as clew_app. There is no upload screen
// yet, so these call the API the way the web app will. Every file is made up at test time.
test.skip(!hasClerk, "Clerk development keys are not set");
test.skip(!hasUploadServices, "File storage and the virus scanner are not set up");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

type Resume = { id: string; filename: string; content_type: string; size_bytes: number };
type Link = { url: string; expires_at: string };

const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function upload(
  page: Page,
  request: APIRequestContext,
  name: string,
  buffer: Buffer,
  mimeType = "application/octet-stream",
) {
  return request.post(`${API_URL}/resumes`, {
    headers: await bearer(page),
    multipart: { file: { name, mimeType, buffer } },
    timeout: 60_000,
  });
}

async function downloadLink(page: Page, request: APIRequestContext, id: string) {
  return request.get(`${API_URL}/resumes/${id}/download`, { headers: await bearer(page) });
}

test("a PDF is scanned, stored and downloads only through a 5-minute link (UP-01, UP-10)", async ({
  page,
  request,
}) => {
  await signInForApi(page, request, "upload-pdf");
  const file = pdf();
  const response = await upload(page, request, "Ariadne Testuser resume.pdf", file, PDF_TYPE);
  expect(response.status(), await response.text()).toBe(201);
  const resume: Resume = await response.json();
  expect(resume).toMatchObject({ content_type: PDF_TYPE, size_bytes: file.length });

  const linkResponse = await downloadLink(page, request, resume.id);
  expect(linkResponse.status()).toBe(200);
  const link: Link = await linkResponse.json();
  const url = new URL(link.url);
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  const expiresIn = (Date.parse(link.expires_at) - Date.now()) / 1000;
  expect(expiresIn).toBeGreaterThan(240);
  expect(expiresIn).toBeLessThanOrEqual(300);

  // The signed link returns the exact bytes, as a download.
  const file_ = await request.get(link.url);
  expect(file_.status()).toBe(200);
  expect(Buffer.from(await file_.body()).equals(file)).toBe(true);
  expect(file_.headers()["content-disposition"]).toMatch(/^attachment/);

  // The file itself is private: without the signature, storage refuses it.
  const unsigned = await request.get(`${url.origin}${url.pathname}`);
  expect(unsigned.status()).toBe(403);
  // A tampered signature is refused too.
  url.searchParams.set("X-Amz-Signature", "0".repeat(64));
  expect((await request.get(url.toString())).status()).toBe(403);
});

test("a Word document is accepted (UP-02)", async ({ page, request }) => {
  await signInForApi(page, request, "upload-docx");
  const response = await upload(page, request, "resume.docx", docx(), DOCX_TYPE);
  expect(response.status(), await response.text()).toBe(201);
  expect((await response.json()).content_type).toBe(DOCX_TYPE);
});

test("a file of exactly 10 MB is accepted and one byte more is refused (UP-05b)", async ({
  page,
  request,
}) => {
  await signInForApi(page, request, "upload-10mb");
  const exact = await upload(page, request, "exactly-10mb.pdf", pdf(MAX_RESUME_BYTES), PDF_TYPE);
  expect(exact.status(), await exact.text()).toBe(201);

  const over = await upload(page, request, "10mb-plus-1.pdf", pdf(MAX_RESUME_BYTES + 1), PDF_TYPE);
  expect(over.status()).toBe(413);
  expect((await over.json()).detail).toBe("Files must be 10 MB or smaller.");
});

test("a program renamed to .pdf is refused by its content, not its name (UP-06)", async ({
  page,
  request,
}) => {
  await signInForApi(page, request, "upload-renamed");
  const response = await upload(page, request, "resume.pdf", windowsProgram(), PDF_TYPE);
  expect(response.status()).toBe(415);
});

test("text and image files are refused (UP-13)", async ({ page, request }) => {
  await signInForApi(page, request, "upload-wrong-type");
  const files: [string, Buffer, string][] = [
    ["resume.txt", Buffer.from("Ariadne Testuser\nThread engineer\n"), "text/plain"],
    ["resume.rtf", Buffer.from("{\\rtf1\\ansi Ariadne Testuser}"), "application/rtf"],
    ["resume.png", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), "image/png"],
  ];
  for (const [name, buffer, type] of files) {
    const response = await upload(page, request, name, buffer, type);
    expect(response.status(), name).toBe(415);
  }
});

test("the virus check flags the EICAR test file and nothing is kept (UP-07)", async ({
  page,
  request,
}) => {
  await signInForApi(page, request, "upload-eicar");
  const response = await upload(page, request, "resume.docx", eicarDocx(), DOCX_TYPE);
  expect(response.status(), await response.text()).toBe(422);
  // FastAPI also answers 422 for a malformed request, so check it was the scanner.
  expect((await response.json()).detail).toBe(
    "We couldn't accept this file. Please try a different copy.",
  );
  // The audit log entry the test plan asks for has no API to read it yet; the backend tests
  // check that the file isn't stored.
});

test("another user can't get a link to your resume (UP-10)", async ({ browser, request }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    await setupClerkTestingToken({ page: alice });
    await setupClerkTestingToken({ page: bob });
    await signInForApi(alice, request, "upload-alice");
    await signInForApi(bob, request, "upload-bob");

    const response = await upload(alice, request, "resume.pdf", pdf(), PDF_TYPE);
    expect(response.status()).toBe(201);
    const resume: Resume = await response.json();

    expect((await downloadLink(bob, request, resume.id)).status()).toBe(404);
    expect((await downloadLink(alice, request, resume.id)).status()).toBe(200);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("upload and download refuse requests without a session", async ({ request }) => {
  const response = await request.post(`${API_URL}/resumes`, {
    multipart: { file: { name: "resume.pdf", mimeType: PDF_TYPE, buffer: pdf() } },
  });
  expect(response.status()).toBe(401);
  const id = "00000000-0000-4000-8000-000000000000";
  expect((await request.get(`${API_URL}/resumes/${id}/download`)).status()).toBe(401);
});
