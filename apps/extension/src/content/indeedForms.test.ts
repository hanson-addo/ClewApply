// @vitest-environment jsdom
import type { FieldsMessage } from "../messages";
import { openForm } from "./forms";
import { INDEED } from "./indeedForms";
import { showPanel } from "./panel";

// Made-up pages shaped like Indeed's profile edit forms: a page heading and labelled boxes.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateGroup = (name: string) => `
  <fieldset><legend>${name}</legend>
    <select aria-label="Month"><option value="">Month</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
    <select aria-label="Year"><option value="">Year</option><option>2022</option><option>2021</option><option>2020</option></select>
  </fieldset>`;

const EXPERIENCE = `
  <main>
    <h1>Add work experience</h1>
    <form>
      <label for="title">Job title</label><input id="title" type="text">
      <label for="company">Company</label><input id="company" type="text">
      ${dateGroup("From")}
      ${dateGroup("To")}
      <label for="desc">Description</label><textarea id="desc"></textarea>
      <button id="save" type="submit">Save</button>
    </form>
  </main>`;

const EDUCATION = `
  <main>
    <h1>Edit education</h1>
    <form>
      <label for="level">Level of education</label>
      <select id="level"><option value="">Select an option</option><option value="hs">High school or equivalent</option>
        <option value="ba">Bachelor's</option><option value="ma">Master's</option></select>
      <label for="field">Field of study</label><input id="field" type="text">
      <label for="school">School</label><input id="school" type="text">
    </form>
  </main>`;

const DATA: FieldsMessage = {
  type: "clew/fields",
  site: "indeed",
  profileVersion: 4,
  fields: [
    { key: "headline", label: "Headline", value: "Thread Analyst", behind: true },
    { key: "work.aaaa1111.title", label: "Job 1: title", value: "Thread Analyst", behind: true },
    { key: "work.aaaa1111.company", label: "Job 1: company", value: "Labyrinth Logistics", behind: true },
    { key: "work.aaaa1111.dates", label: "Job 1: dates", value: "2021-03 to 2022-01", behind: true },
    { key: "work.aaaa1111.duties", label: "Job 1: duties", value: "Followed the thread.", behind: true },
    { key: "education.cccc3333.school", label: "School 1: name", value: "Knossos College", behind: true },
    { key: "education.cccc3333.degree", label: "School 1: degree", value: "B.S.", behind: true },
    { key: "education.cccc3333.field", label: "School 1: field of study", value: "Geometry", behind: true },
  ],
};

const REAL = "clew-test-real";
const trusted = (event: Event) => event instanceof CustomEvent && event.detail === REAL;
const realClick = (element: HTMLElement) => element.dispatchEvent(new CustomEvent("click", { bubbles: true, detail: REAL }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(html: string): void {
  document.getElementById("clew-fill-panel")?.remove();
  document.body.replaceChildren(document.createRange().createContextualFragment(html));
}

function value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;
}

/** Opens the panel, ticks every field it offers and fills them. */
async function fillAll() {
  const report = vi.fn(async () => undefined);
  const shadow = showPanel(document, DATA, INDEED, { report, trusted });
  for (const box of shadow.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) box.checked = true;
  const fill = [...shadow.querySelectorAll("button")].find((b) => b.textContent === "Fill ticked fields");
  if (!fill) throw new Error("no Fill button");
  realClick(fill);
  await settle();
  return { shadow, report };
}

it("finds Indeed's forms on their own pages, not other pages", () => {
  page(EXPERIENCE);
  expect(openForm(document, INDEED.forms)?.spec.kind).toBe("experience");
  page("<main><h1>Find jobs</h1></main>");
  expect(openForm(document, INDEED.forms)).toBeNull();
});

it("fills a work experience form, without saving", async () => {
  page(EXPERIENCE);
  let saved = false;
  document.querySelector("form")?.addEventListener("submit", () => (saved = true));
  const { shadow, report } = await fillAll();
  expect(value("title")).toBe("Thread Analyst");
  expect(value("company")).toBe("Labyrinth Logistics");
  expect(value("desc")).toBe("Followed the thread.");
  const selects = [...document.querySelectorAll("select")].map((s) => s.value);
  expect(selects).toEqual(["3", "2021", "1", "2022"]);
  expect(shadow.textContent).toContain("press Save on Indeed");
  expect(report).toHaveBeenCalledWith([
    "work.aaaa1111.title",
    "work.aaaa1111.company",
    "work.aaaa1111.dates",
    "work.aaaa1111.duties",
  ]);
  expect(saved).toBe(false);
});

it("picks the level of education from a short form like B.S.", async () => {
  page(EDUCATION);
  await fillAll();
  expect(value("level")).toBe("ba");
  expect(value("field")).toBe("Geometry");
  expect(value("school")).toBe("Knossos College");
});

it("leaves the level alone when nothing in the list matches", async () => {
  page(EDUCATION);
  const data = { ...DATA, fields: DATA.fields.map((f) => (f.key.endsWith(".degree") ? { ...f, value: "Certificate" } : f)) };
  const shadow = showPanel(document, data, INDEED, { report: async () => undefined, trusted });
  const row = [...shadow.querySelectorAll("label.field")].find((l) => l.textContent?.includes("School 1: degree"));
  const box = row?.querySelector("input");
  const fill = [...shadow.querySelectorAll("button")].find((b) => b.textContent === "Fill ticked fields");
  if (!box || !fill) throw new Error("panel is missing the degree row");
  box.checked = true;
  realClick(fill);
  await settle();
  expect(value("level")).toBe("");
  expect(shadow.textContent).toContain("School 1: degree: not found on this form");
});
