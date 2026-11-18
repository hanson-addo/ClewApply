// @vitest-environment jsdom
import type { FieldsMessage } from "../messages";
import { parseDates } from "./fill";
import { entriesOf, showPanel } from "./panel";

// Made-up forms shaped like LinkedIn's edit dialogs: a heading and labelled boxes.
const INTRO = `
  <div role="dialog" aria-labelledby="h">
    <h2 id="h">Edit intro</h2>
    <form>
      <label for="headline">Headline*</label><input id="headline" type="text">
      <label for="city">City</label><input id="city" type="text">
      <button id="save" type="submit">Save</button>
    </form>
  </div>`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateGroup = (name: string) => `
  <fieldset><legend>${name}</legend>
    <select aria-label="Month"><option value="">Month</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
    <select aria-label="Year"><option value="">Year</option><option>2022</option><option>2021</option><option>2020</option></select>
  </fieldset>`;

const POSITION = `
  <div role="dialog">
    <h2>Add experience</h2>
    <form>
      <label for="title">Title*</label><input id="title" type="text">
      <label for="company">Company name*</label><input id="company" type="text">
      ${dateGroup("Start date")}
      ${dateGroup("End date")}
      <button id="save" type="submit">Save</button>
    </form>
  </div>`;

const DATA: FieldsMessage = {
  type: "clew/fields",
  site: "linkedin",
  profileVersion: 4,
  fields: [
    { key: "headline", label: "Headline", value: "Thread Analyst", behind: true },
    { key: "about", label: "About", value: "I find the way out of mazes.", behind: true },
    { key: "location", label: "Location", value: "Austin, TX", behind: false },
    { key: "work.aaaa1111.title", label: "Job 1: title", value: "Thread Analyst", behind: true },
    { key: "work.aaaa1111.company", label: "Job 1: company", value: "Labyrinth Logistics", behind: true },
    { key: "work.aaaa1111.dates", label: "Job 1: dates", value: "2021-03 to present", behind: true },
    { key: "work.bbbb2222.title", label: "Job 2: title", value: "Knot Tier", behind: true },
    { key: "work.bbbb2222.dates", label: "Job 2: dates", value: "2020-01 to 2021-02", behind: true },
  ],
};

const REAL = "clew-test-real";
const trusted = (event: Event) => event instanceof CustomEvent && event.detail === REAL;

function page(html: string): void {
  document.body.replaceChildren(document.createRange().createContextualFragment(html));
  document.getElementById("clew-fill-panel")?.remove();
}

function open(report = vi.fn(async () => undefined)) {
  const shadow = showPanel(document, DATA, { report, trusted });
  return { shadow, report };
}

function button(shadow: ShadowRoot, text: string): HTMLButtonElement {
  const found = [...shadow.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

function box(shadow: ShadowRoot, label: string): HTMLInputElement {
  const row = [...shadow.querySelectorAll("label.field")].find((l) => l.querySelector(".name")?.textContent === label);
  const input = row?.querySelector("input");
  if (!input) throw new Error(`no checkbox "${label}"`);
  return input;
}

function input(id: string): HTMLInputElement | HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error(`no #${id}`);
  return element;
}

const realClick = (element: HTMLElement) => element.dispatchEvent(new CustomEvent("click", { bubbles: true, composed: true, detail: REAL }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("lives in a closed shadow root the page can't reach", () => {
  page(INTRO);
  open();
  const host = document.getElementById("clew-fill-panel");
  expect(host).not.toBeNull();
  expect(host?.shadowRoot).toBeNull();
});

it("asks for an edit form when none is open", () => {
  page("<main><h1>Riley Testperson</h1></main>");
  const { shadow } = open();
  expect(shadow.textContent).toContain("Open one of your profile's edit forms on LinkedIn");
  expect(button(shadow, "Check again")).toBeTruthy();
});

it("lists the intro's fields unticked, with what changed", () => {
  page(INTRO);
  const { shadow } = open();
  const names = [...shadow.querySelectorAll(".name")].map((n) => n.textContent);
  expect(names).toEqual(["Headline", "Location"]);
  expect(box(shadow, "Headline").checked).toBe(false);
  expect(box(shadow, "Location").checked).toBe(false);
  expect(shadow.textContent).toContain("Changed since the last fill");
  expect(shadow.textContent).toContain("Same as the last fill");
});

it("fills only ticked fields, on a real click, and never presses Save", async () => {
  page(INTRO);
  const save = vi.fn((event: Event) => event.preventDefault());
  document.getElementById("save")?.addEventListener("click", save);
  document.querySelector("form")?.addEventListener("submit", save);
  const typed = vi.fn();
  input("headline").addEventListener("input", typed);
  const { shadow, report } = open();

  box(shadow, "Headline").checked = true;
  // A click a page script makes up does nothing.
  button(shadow, "Fill ticked fields").click();
  expect(input("headline").value).toBe("");

  realClick(button(shadow, "Fill ticked fields"));
  await settle();
  expect(input("headline").value).toBe("Thread Analyst");
  expect(typed).toHaveBeenCalled();
  expect(input("city").value).toBe("");
  expect(save).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith(["headline"]);
  expect(shadow.textContent).toContain("Headline: filled");
  expect(shadow.textContent).toContain("Check the fields, then press Save on LinkedIn.");
});

it("does nothing when nothing is ticked", async () => {
  page(INTRO);
  const { shadow, report } = open();
  realClick(button(shadow, "Fill ticked fields"));
  await settle();
  expect(report).not.toHaveBeenCalled();
  expect(input("headline").value).toBe("");
});

it("says when a box isn't on the form, and doesn't report it", async () => {
  page(INTRO.replace("City", "Town"));
  const { shadow, report } = open();
  box(shadow, "Location").checked = true;
  realClick(button(shadow, "Fill ticked fields"));
  await settle();
  expect(shadow.textContent).toContain("Location: not found on this form");
  expect(shadow.textContent).toContain("Nothing was filled.");
  expect(report).not.toHaveBeenCalled();
});

it("asks which job an experience form is for, then fills its title and dates", async () => {
  page(POSITION);
  const { shadow, report } = open();
  const picker = shadow.querySelector("select");
  if (!picker) throw new Error("no picker");
  expect([...picker.options].map((o) => o.textContent)).toEqual([
    "Choose one",
    "Thread Analyst at Labyrinth Logistics",
    "Knot Tier",
  ]);
  expect(shadow.querySelector("label.field")).toBeNull();

  picker.value = "bbbb2222";
  picker.dispatchEvent(new CustomEvent("change", { detail: REAL }));
  expect([...shadow.querySelectorAll(".name")].map((n) => n.textContent)).toEqual(["Job 2: title", "Job 2: dates"]);

  box(shadow, "Job 2: title").checked = true;
  box(shadow, "Job 2: dates").checked = true;
  realClick(button(shadow, "Fill ticked fields"));
  await settle();

  expect(input("title").value).toBe("Knot Tier");
  expect(input("company").value).toBe("");
  const [startMonth, startYear, endMonth, endYear] = [...document.querySelectorAll("select")];
  expect(startMonth?.value).toBe("1");
  expect(startYear?.value).toBe("2020");
  expect(endMonth?.value).toBe("2");
  expect(endYear?.value).toBe("2021");
  expect(report).toHaveBeenCalledWith(["work.bbbb2222.title", "work.bbbb2222.dates"]);
});

it("leaves the end date alone for a current job and says what to tick", async () => {
  page(POSITION);
  const { shadow } = open();
  const picker = shadow.querySelector("select");
  if (!picker) throw new Error("no picker");
  picker.value = "aaaa1111";
  picker.dispatchEvent(new CustomEvent("change", { detail: REAL }));
  box(shadow, "Job 1: dates").checked = true;
  realClick(button(shadow, "Fill ticked fields"));
  await settle();
  const [startMonth, startYear, endMonth, endYear] = [...document.querySelectorAll("select")];
  expect(startMonth?.value).toBe("3");
  expect(startYear?.value).toBe("2021");
  expect(endMonth?.value).toBe("");
  expect(endYear?.value).toBe("");
  expect(shadow.textContent).toContain('Tick "I am currently working in this role"');
});

it("shows values as text, never as markup", () => {
  page(INTRO);
  const hostile: FieldsMessage = {
    ...DATA,
    fields: [{ key: "headline", label: "Headline", value: '<img src=x onerror="alert(1)">', behind: true }],
  };
  const shadow = showPanel(document, hostile, { report: async () => undefined, trusted });
  expect(shadow.querySelector("img")).toBeNull();
  expect(shadow.textContent).toContain('<img src=x onerror="alert(1)">');
});

it("keeps clicks in the panel from reaching the page", () => {
  page(INTRO);
  const outside = vi.fn();
  document.addEventListener("click", outside);
  const { shadow } = open();
  realClick(button(shadow, "Close"));
  document.removeEventListener("click", outside);
  expect(outside).not.toHaveBeenCalled();
  expect(document.getElementById("clew-fill-panel")).toBeNull();
});

it("groups jobs by their id, in Clew's order", () => {
  expect(entriesOf(DATA.fields, "work").map((e) => [e.id, e.name])).toEqual([
    ["aaaa1111", "Thread Analyst at Labyrinth Logistics"],
    ["bbbb2222", "Knot Tier"],
  ]);
  expect(entriesOf(DATA.fields, "education")).toEqual([]);
});

it("reads Clew's date ranges", () => {
  expect(parseDates("2021-03 to present")).toEqual({ start: { year: "2021", month: 3 }, end: "present" });
  expect(parseDates("2019 to 2020-06-15")).toEqual({ start: { year: "2019", month: null }, end: { year: "2020", month: 6 } });
  expect(parseDates("to 2020")).toEqual({ start: null, end: { year: "2020", month: null } });
  expect(parseDates("whenever")).toBeNull();
});
