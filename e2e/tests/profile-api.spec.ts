import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL, hasClerk } from "../env";
import { signInAsNewUser } from "./clerk-helpers";

// Master profile through the real stack (test plan §3.3): a real Clerk session token, the API
// running as the restricted clew_app role, and Postgres row-level security. There is no
// profile screen yet, so these drive the API the way the web app will. All data is made up.
test.skip(!hasClerk, "Clerk development keys are not set");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

type Version = {
  id: string;
  data: { basics: { label?: string | null; email?: string | null }; work: Work[] };
  change_summary: string | null;
  is_current: boolean;
};
type Work = { name?: string | null; position?: string | null; startDate?: string | null };
type Summary = { id: string; change_summary: string | null; is_current: boolean };

/** Calls the API as the user signed in on `page`, with a fresh Clerk session token each time. */
class ApiAs {
  constructor(
    private readonly page: Page,
    private readonly request: APIRequestContext,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.page.evaluate(async () => {
      const clerk = (window as unknown as {
        Clerk?: { session?: { getToken(): Promise<string | null> } };
      }).Clerk;
      return (await clerk?.session?.getToken()) ?? null;
    });
    expect(token, "the page should have a Clerk session").toBeTruthy();
    return { Authorization: `Bearer ${token}` };
  }

  async get(path: string) {
    return this.request.get(`${API_URL}${path}`, { headers: await this.headers() });
  }

  async put(path: string, body: unknown) {
    return this.request.put(`${API_URL}${path}`, { headers: await this.headers(), data: body });
  }

  async save(body: unknown): Promise<Version> {
    const response = await this.put("/profile", body);
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  }

  async versions(): Promise<Summary[]> {
    const response = await this.get("/profile/versions");
    expect(response.status()).toBe(200);
    return response.json();
  }
}

async function signedIn(page: Page, request: APIRequestContext, label: string): Promise<ApiAs> {
  await signInAsNewUser(page, label);
  // Settle on the app with a live session before reading tokens from it.
  await page.goto("/");
  await page.waitForFunction(
    () => Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
  );
  const api = new ApiAs(page, request);
  // The first signed-in call creates the account.
  expect((await api.get("/me")).status()).toBe(200);
  return api;
}

const firstJob: Work = { name: "Labyrinth Logistics", position: "Thread Engineer", startDate: "2021-03" };
const secondJob: Work = { name: "Minos Maps", position: "Route Planner", startDate: "2018-06" };

test("a new account has no profile and no history yet", async ({ page, request }) => {
  const api = await signedIn(page, request, "profile-empty");
  expect((await api.get("/profile")).status()).toBe(404);
  expect(await api.versions()).toEqual([]);
});

test("editing the headline adds a version and keeps the old one as it was (PRO-01)", async ({
  page,
  request,
}) => {
  const api = await signedIn(page, request, "profile-headline");
  const first = await api.save({
    data: { basics: { label: "Thread engineer" } },
    change_summary: "Added headline",
  });
  const second = await api.save({
    data: { basics: { label: "Senior thread engineer" } },
    change_summary: "Changed headline",
    base_version_id: first.id,
  });

  expect(second.id).not.toBe(first.id);
  expect(second.is_current).toBe(true);
  const current: Version = await (await api.get("/profile")).json();
  expect(current.data.basics.label).toBe("Senior thread engineer");

  const old: Version = await (await api.get(`/profile/versions/${first.id}`)).json();
  expect(old.data.basics.label).toBe("Thread engineer");
  expect(old.is_current).toBe(false);

  const history = await api.versions();
  expect(history.map((v) => v.change_summary)).toEqual(["Changed headline", "Added headline"]);
  expect(history.map((v) => v.is_current)).toEqual([true, false]);
});

test("adding, editing, reordering and deleting a job each add one version (PRO-02)", async ({
  page,
  request,
}) => {
  const api = await signedIn(page, request, "profile-work");
  const steps: { work: Work[]; summary: string }[] = [
    { work: [firstJob], summary: "Added Labyrinth Logistics" },
    { work: [{ ...firstJob, position: "Lead Thread Engineer" }], summary: "Changed position" },
    {
      work: [{ ...firstJob, position: "Lead Thread Engineer" }, secondJob],
      summary: "Added Minos Maps",
    },
    {
      work: [secondJob, { ...firstJob, position: "Lead Thread Engineer" }],
      summary: "Moved Minos Maps up",
    },
    { work: [secondJob], summary: "Deleted Labyrinth Logistics" },
  ];
  let base: string | undefined;
  for (const step of steps) {
    const saved = await api.save({
      data: { work: step.work },
      change_summary: step.summary,
      base_version_id: base,
    });
    expect(saved.data.work.map((w) => w.name)).toEqual(step.work.map((w) => w.name));
    base = saved.id;
  }

  const history = await api.versions();
  expect(history.map((v) => v.change_summary)).toEqual(steps.map((s) => s.summary).reverse());
});

test("saving the same profile again adds no version", async ({ page, request }) => {
  const api = await signedIn(page, request, "profile-same");
  const first = await api.save({ data: { basics: { label: "Thread engineer" } } });
  const again = await api.save({ data: { basics: { label: "Thread engineer" } } });
  expect(again.id).toBe(first.id);
  expect(await api.versions()).toHaveLength(1);
});

test("restoring an old version adds a new version equal to it (PRO-03)", async ({
  page,
  request,
}) => {
  const api = await signedIn(page, request, "profile-restore");
  const original = await api.save({
    data: { basics: { label: "Thread engineer" }, work: [firstJob] },
    change_summary: "First draft",
  });
  const edited = await api.save({
    data: { basics: { label: "Maze runner" }, work: [secondJob] },
    change_summary: "Rewrote everything",
    base_version_id: original.id,
  });

  const old: Version = await (await api.get(`/profile/versions/${original.id}`)).json();
  const restored = await api.save({
    data: old.data,
    change_summary: "Restored First draft",
    base_version_id: edited.id,
  });

  expect(restored.id).not.toBe(original.id);
  expect(restored.data).toEqual(old.data);
  const history = await api.versions();
  expect(history.map((v) => v.id)).toEqual([restored.id, edited.id, original.id]);
  // Nothing was overwritten: the edited version still reads as it was saved.
  const stillEdited: Version = await (await api.get(`/profile/versions/${edited.id}`)).json();
  expect(stillEdited.data.basics.label).toBe("Maze runner");
});

test("a save based on an old version is refused, not silently applied (PRO-10)", async ({
  page,
  request,
}) => {
  const api = await signedIn(page, request, "profile-tabs");
  const start = await api.save({ data: { basics: { label: "Thread engineer" } } });
  // Tab A saves first.
  await api.save({ data: { basics: { label: "Edited in tab A" } }, base_version_id: start.id });
  // Tab B still has the starting version open.
  const response = await api.put("/profile", {
    data: { basics: { label: "Edited in tab B" } },
    base_version_id: start.id,
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).detail).toMatch(/changed somewhere else/i);
  const current: Version = await (await api.get("/profile")).json();
  expect(current.data.basics.label).toBe("Edited in tab A");
});

test("invalid profiles are refused and nothing is saved (PRO-05)", async ({ page, request }) => {
  const api = await signedIn(page, request, "profile-invalid");
  const invalid = [
    { basics: { email: "not-an-email" } },
    { basics: { label: "x".repeat(201) } },
    { basics: { url: "javascript:alert(1)" } },
    { work: [{ name: "Labyrinth Logistics", startDate: "March 2021" }] },
  ];
  for (const data of invalid) {
    const response = await api.put("/profile", { data });
    expect(response.status(), JSON.stringify(data)).toBe(422);
  }
  expect(await api.versions()).toEqual([]);
});

test("sensitive answers can't be stored in the profile (PRO-06)", async ({ page, request }) => {
  const api = await signedIn(page, request, "profile-sensitive");
  for (const data of [
    { basics: { workAuthorization: "Yes" } },
    { veteranStatus: "Not a veteran" },
    { disability: "Prefer not to say" },
  ]) {
    const response = await api.put("/profile", { data });
    expect(response.status(), JSON.stringify(data)).toBe(422);
  }
  expect(await api.versions()).toEqual([]);
});

test("another user can't see your profile or your versions", async ({ browser, request }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();
    await setupClerkTestingToken({ page: alicePage });
    await setupClerkTestingToken({ page: bobPage });
    const alice = await signedIn(alicePage, request, "profile-alice");
    const bob = await signedIn(bobPage, request, "profile-bob");

    const saved = await alice.save({ data: { basics: { label: "Alice's headline" } } });

    expect((await bob.get("/profile")).status()).toBe(404);
    expect(await bob.versions()).toEqual([]);
    expect((await bob.get(`/profile/versions/${saved.id}`)).status()).toBe(404);
    // Bob can't use Alice's version as the base of his own save either.
    const response = await bob.put("/profile", {
      data: { basics: { label: "Bob's headline" } },
      base_version_id: saved.id,
    });
    expect(response.status()).toBe(409);

    const aliceNow: Version = await (await alice.get("/profile")).json();
    expect(aliceNow.data.basics.label).toBe("Alice's headline");
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("profile routes refuse requests without a session", async ({ request }) => {
  for (const path of ["/profile", "/profile/versions"]) {
    expect((await request.get(`${API_URL}${path}`)).status()).toBe(401);
  }
  expect((await request.put(`${API_URL}/profile`, { data: { data: {} } })).status()).toBe(401);
});
