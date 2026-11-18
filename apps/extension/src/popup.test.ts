// @vitest-environment jsdom
import { profileLine, start } from "./popup";

const HTML = `
  <p id="status"></p>
  <dl id="facts" hidden><dd id="email"></dd><dd id="profile"></dd></dl>
  <p id="hint" hidden></p>
  <button id="sign-out" hidden>Sign out of the extension</button>`;

beforeEach(() => {
  document.body.replaceChildren();
  document.body.append(document.createRange().createContextualFragment(HTML));
});

function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

it("shows the signed-in email and profile version as text", async () => {
  const ask = vi.fn(async () => ({
    state: "signed-in",
    email: "<b>riley</b>@example.test",
    profileVersion: 3,
    profileSavedAt: "2026-11-18T14:04:00Z",
  }));
  await start(document, ask);
  expect($("status").textContent).toBe("Connected to Clew.");
  expect($("email").textContent).toBe("<b>riley</b>@example.test");
  expect($("email").children).toHaveLength(0);
  expect($("profile").textContent).toMatch(/^Version 3, saved /);
  expect($("sign-out").hidden).toBe(false);
  expect($("hint").hidden).toBe(true);
});

it("explains how to connect when signed out", async () => {
  await start(document, async () => ({ state: "signed-out" }));
  expect($("status").textContent).toBe("Not connected.");
  expect($("hint").textContent).toContain("Settings, then Browser extension");
  expect($("hint").textContent).toContain("app.clewapply.com");
  expect($("sign-out").hidden).toBe(true);
  expect($("facts").hidden).toBe(true);
});

it("says when Clew can't be reached", async () => {
  await start(document, async () => ({ state: "unavailable" }));
  expect($("status").textContent).toBe("Clew can't be reached right now.");
});

it("ignores a sign-out click a script made up", async () => {
  const ask = vi.fn(async () => ({ state: "signed-in", email: "a@example.test", profileVersion: null, profileSavedAt: null }));
  await start(document, ask);
  $("sign-out").dispatchEvent(new MouseEvent("click"));
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask).not.toHaveBeenCalledWith({ type: "clew/sign-out" });
});

it("says when the profile hasn't been saved", () => {
  expect(profileLine(null, null)).toBe("Not saved yet");
  expect(profileLine(2, "2026-11-18T14:04:00Z", "en-US")).toMatch(/^Version 2, saved Nov 18, \d/);
});
