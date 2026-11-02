import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL, hasClerk, hasParsing, realParserKey } from "../env";
import { bearer, signInForApi, uploadResume } from "./api-as";
import { oversizedDocx, textPdf } from "./files";

// Reading an uploaded resume into a draft profile (#71, test plan §3.4), through the real
// stack: Clerk, storage, ClamAV, Redis and the arq worker. Unless CLEW_E2E_ANTHROPIC_API_KEY
// is set, the worker's AI calls go to a local stand-in (fake-anthropic.mjs), never to
// Anthropic. Every resume is made up and built at test time.
test.skip(!hasClerk, "Clerk development keys are not set");
test.skip(!hasParsing, "Storage, the virus scanner or Redis is not set up");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

type Parse = {
  status: "pending" | "running" | "done" | "failed";
  message: string | null;
  result: {
    profile: { basics?: { name?: string; label?: string } };
    confidence: Record<string, number>;
    check: string[];
  } | null;
};

// The messages the API shows (api/resume_parse.py).
const ENCRYPTED = "This file is password-protected. Remove the password and upload it again.";
const NO_TEXT =
  "We couldn't find any text in this file. If it's a scanned image, upload the original " +
  "document instead.";
const UNREADABLE =
  "We couldn't read this resume. Save it again as a PDF or Word file and upload that.";
const BUSY = "We're still reading your other resume. Try this one again when it's done.";
const DAILY_LIMIT = "You've reached today's limit for reading resumes. Try again tomorrow.";

const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const RESUME = ["Ariadne Testuser", "Thread engineer at Labyrinth Logistics, 2021 to now"];
// The stand-in AI holds its answer for a while when it sees this, so a parse stays running.
const SLOW = [...RESUME, "SLOW-STUB"];

async function upload(page: Page, request: APIRequestContext, file: Buffer, type = PDF_TYPE) {
  const name = type === PDF_TYPE ? "resume.pdf" : "resume.docx";
  const response = await uploadResume(page, request, name, file, type);
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function getParse(page: Page, request: APIRequestContext, id: string) {
  return request.get(`${API_URL}/resumes/${id}/parse`, { headers: await bearer(page) });
}

async function restart(page: Page, request: APIRequestContext, id: string) {
  return request.post(`${API_URL}/resumes/${id}/parse`, { headers: await bearer(page) });
}

/** Polls the parse until `done` says it's finished, and returns it. */
async function waitFor(
  page: Page,
  request: APIRequestContext,
  id: string,
  done: (parse: Parse) => boolean,
  timeout = 60_000,
): Promise<Parse> {
  let last: Parse | undefined;
  await expect
    .poll(
      async () => {
        const response = await getParse(page, request, id);
        expect(response.status()).toBe(200);
        last = (await response.json()) as Parse;
        return done(last);
      },
      { timeout, intervals: [500, 1000] },
    )
    .toBe(true);
  return last as Parse;
}

const finished = (parse: Parse) => parse.status === "done" || parse.status === "failed";

test.describe("with the stand-in AI", () => {
  test.skip(Boolean(realParserKey), "These check the stand-in's fixed answers");

  test("an upload is read in the background into a draft profile with fields to check", async ({
    page,
    request,
  }) => {
    await signInForApi(page, request, "parse-happy");
    const id = await upload(page, request, textPdf(SLOW));

    const first = (await (await getParse(page, request, id)).json()) as Parse;
    expect(["pending", "running"]).toContain(first.status);
    await waitFor(page, request, id, (parse) => parse.status === "running");

    const parse = await waitFor(page, request, id, finished);
    expect(parse.status, parse.message ?? "").toBe("done");
    expect(parse.message).toBeNull();
    // The stand-in echoes the first line of the text it was sent: the server read the PDF.
    expect(parse.result?.profile.basics?.name).toBe("Ariadne Testuser");
    expect(parse.result?.confidence["basics.name"]).toBeCloseTo(0.97);
    // Low confidence, or none given, means "check this".
    expect(parse.result?.check).toContain("basics.label");
    expect(parse.result?.check).not.toContain("basics.name");

    // Asking again for a finished read returns it as it is, without starting another.
    const again = await restart(page, request, id);
    expect(again.status()).toBe(202);
    expect(((await again.json()) as Parse).status).toBe("done");
  });

  test("only one resume is read at a time; a second waits its turn (429)", async ({
    page,
    request,
  }) => {
    await signInForApi(page, request, "parse-busy");
    const first = await upload(page, request, textPdf(SLOW));
    await waitFor(page, request, first, (parse) => parse.status === "running");

    const second = await upload(page, request, textPdf(RESUME));
    const refused = (await (await getParse(page, request, second)).json()) as Parse;
    expect(refused).toMatchObject({ status: "failed", message: BUSY });
    const retry = await restart(page, request, second);
    expect(retry.status()).toBe(429);
    expect(((await retry.json()) as { detail: string }).detail).toBe(BUSY);

    // Once the first is done, the second can be read.
    expect((await waitFor(page, request, first, finished)).status).toBe("done");
    expect((await restart(page, request, second)).status()).toBe(202);
    expect((await waitFor(page, request, second, finished)).status).toBe("done");
  });
});

// Failures found before the AI is called: they show a message and need no AI at all.
for (const [label, file, type, message] of [
  ["a password-protected PDF", textPdf(RESUME, { encrypted: true }), PDF_TYPE, ENCRYPTED],
  ["a scanned PDF with no text", textPdf([]), PDF_TYPE, NO_TEXT],
  ["a Word file too big to read", oversizedDocx(), DOCX_TYPE, UNREADABLE],
] as const) {
  test(`${label} fails with a message saying what to do`, async ({ page, request }) => {
    await signInForApi(page, request, "parse-fail");
    const id = await upload(page, request, file, type);
    const parse = await waitFor(page, request, id, finished);
    expect(parse).toMatchObject({ status: "failed", message, result: null });
  });
}

test("a failed read can be started again", async ({ page, request }) => {
  await signInForApi(page, request, "parse-restart");
  const id = await upload(page, request, textPdf(RESUME, { encrypted: true }));
  expect((await waitFor(page, request, id, finished)).status).toBe("failed");

  const response = await restart(page, request, id);
  expect(response.status()).toBe(202);
  const restarted = (await response.json()) as Parse;
  expect(["pending", "running"]).toContain(restarted.status);
  expect(restarted.message).toBeNull();
  expect(await waitFor(page, request, id, finished)).toMatchObject({
    status: "failed",
    message: ENCRYPTED,
  });
});

test("reading is capped at 10 starts a day (429)", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInForApi(page, request, "parse-daily");
  // The upload is the first start. A file that fails fast keeps each round short.
  const id = await upload(page, request, textPdf(RESUME, { encrypted: true }));
  await waitFor(page, request, id, finished);
  for (let start = 2; start <= 10; start++) {
    expect((await restart(page, request, id)).status(), `start ${start}`).toBe(202);
    await waitFor(page, request, id, finished);
  }
  const refused = await restart(page, request, id);
  expect(refused.status()).toBe(429);
  expect(((await refused.json()) as { detail: string }).detail).toBe(DAILY_LIMIT);
});

test("another user can't see or start reading your resume", async ({ browser, request }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    await setupClerkTestingToken({ page: alice });
    await setupClerkTestingToken({ page: bob });
    await signInForApi(alice, request, "parse-alice");
    await signInForApi(bob, request, "parse-bob");

    const id = await upload(alice, request, textPdf(RESUME));
    expect((await getParse(bob, request, id)).status()).toBe(404);
    expect((await restart(bob, request, id)).status()).toBe(404);
    expect((await getParse(alice, request, id)).status()).toBe(200);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("reading routes refuse requests without a session", async ({ request }) => {
  const id = "00000000-0000-4000-8000-000000000000";
  expect((await request.get(`${API_URL}/resumes/${id}/parse`)).status()).toBe(401);
  expect((await request.post(`${API_URL}/resumes/${id}/parse`)).status()).toBe(401);
});

test("the real AI reads a made-up resume into a draft profile", async ({ page, request }) => {
  test.skip(!realParserKey, "Set CLEW_E2E_ANTHROPIC_API_KEY to call the real AI");
  test.setTimeout(150_000);
  await signInForApi(page, request, "parse-real");
  const id = await upload(page, request, textPdf(RESUME));
  const parse = await waitFor(page, request, id, finished, 120_000);
  expect(parse.status, parse.message ?? "").toBe("done");
  expect(parse.result?.profile.basics?.name).toBe("Ariadne Testuser");
});
