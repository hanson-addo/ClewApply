/**
 * The fill panel shown on a job site's profile page after the user presses Fill in the popup.
 *
 * - It lives in a closed shadow root, so the page's scripts and styles can't reach into it.
 * - Every checkbox starts unticked. Only ticked fields are filled, and only on a real click
 *   (`isTrusted`); a click a page script makes up does nothing.
 * - Text is set with textContent only.
 * - It never clicks Save, Submit or Apply, never navigates, never reads what the user typed,
 *   never holds the token and never calls the API. After filling it tells the service worker
 *   which field keys were filled (no values).
 */

import type { FieldsMessage, FillField } from "../messages";
import { openForm, type FormSpec, type PartSpec } from "./linkedinForms";

export type PanelDeps = {
  /** Sends the filled keys to the service worker. */
  report: (keys: string[]) => Promise<unknown>;
  /** Overridable in tests, where clicks can't be trusted. */
  trusted?: (event: Event) => boolean;
};

const HOST_ID = "clew-fill-panel";
const SITE_NAME = "LinkedIn";

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  box-sizing: border-box; width: 340px; max-height: 70vh; overflow: auto;
  padding: 16px; border: 1px solid #101935; border-radius: 12px;
  background: #f4f2ff; color: #101935; box-shadow: 0 8px 24px rgba(16, 25, 53, 0.25);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; }
h2 { margin: 0; font-size: 16px; font-weight: 700; }
p { margin: 0 0 8px; }
.muted { color: #4a4f6a; font-size: 13px; }
ul { list-style: none; margin: 0 0 12px; padding: 0; }
li { margin: 0 0 8px; }
label.field { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: start; cursor: pointer; }
.name { font-weight: 600; }
.value { grid-column: 2; color: #4a4f6a; font-size: 13px; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.badge { grid-column: 2; font-size: 12px; color: #b23a1e; }
.badge.same { color: #4a4f6a; }
label.entry { display: block; margin: 0 0 12px; font-weight: 600; }
select { display: block; width: 100%; margin-top: 4px; padding: 6px; font: inherit; border: 1px solid #101935; border-radius: 6px; background: #fff; color: #101935; }
button { font: inherit; border-radius: 8px; cursor: pointer; padding: 8px 12px; border: 1px solid #101935; background: #fff; color: #101935; }
button.primary { width: 100%; background: #ff6b4a; border-color: #ff6b4a; color: #101935; font-weight: 700; }
button.quiet { padding: 4px 8px; }
button:disabled { opacity: 0.6; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #b23a1e; outline-offset: 2px; }
.done { font-weight: 700; }
`;

// Events stopped at the panel, so the site doesn't treat clicks and typing in the panel as
// clicks outside its own dialog.
const CONTAINED = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "focusin", "focusout", "input", "change"];

type Entry = { id: string; name: string; fields: FillField[] };

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

/** Jobs or schools in the order Clew lists them, from keys like "work.3f9a01bc.title". */
export function entriesOf(fields: FillField[], section: "work" | "education"): Entry[] {
  const entries = new Map<string, Entry>();
  for (const field of fields) {
    const [head, id, part] = field.key.split(".");
    if (head !== section || !id || !part) continue;
    const entry = entries.get(id) ?? { id, name: "", fields: [] };
    entry.fields.push(field);
    entries.set(id, entry);
  }
  const noun = section === "work" ? "Job" : "School";
  return [...entries.values()].map((entry, i) => {
    const value = (part: string) => entry.fields.find((f) => f.key.endsWith(`.${part}`))?.value;
    const title = value("title");
    const company = value("company");
    const school = value("school");
    const name =
      section === "work" ? [title, company].filter(Boolean).join(" at ") : (school ?? "");
    return { ...entry, name: name || `${noun} ${i + 1}` };
  });
}

function partOf(field: FillField): string {
  return field.key.split(".").at(-1) ?? field.key;
}

/** Opens (or reopens) the panel with these values. Returns the shadow root, for tests. */
export function showPanel(doc: Document, data: FieldsMessage, deps: PanelDeps): ShadowRoot {
  const trusted = deps.trusted ?? ((event: Event) => event.isTrusted);
  doc.getElementById(HOST_ID)?.remove();
  const host = el(doc, "div");
  host.id = HOST_ID;
  for (const type of CONTAINED) host.addEventListener(type, (event) => event.stopPropagation());
  const shadow = host.attachShadow({ mode: "closed" });
  const style = el(doc, "style", CSS);
  const panel = el(doc, "section", undefined, "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Fill from Clew");
  shadow.append(style, panel);
  doc.documentElement.append(host);

  const onClick = (button: HTMLButtonElement, act: () => void) =>
    button.addEventListener("click", (event) => {
      if (trusted(event)) act();
    });

  const header = (): HTMLElement => {
    const head = el(doc, "div", undefined, "head");
    const close = el(doc, "button", "Close", "quiet");
    close.type = "button";
    onClick(close, () => host.remove());
    head.append(el(doc, "h2", "Fill from Clew"), close);
    return head;
  };

  const showNoForm = () => {
    const again = el(doc, "button", "Check again");
    again.type = "button";
    onClick(again, render);
    panel.replaceChildren(
      header(),
      el(doc, "p", `Open one of your profile's edit forms on ${SITE_NAME} (press a pencil, or Add), then press Check again.`),
      el(doc, "p", "Clew fills your intro, about, experience and education.", "muted"),
      again,
    );
  };

  const showFields = (spec: FormSpec, fields: FillField[], entries: Entry[] | null, chosen: string | null) => {
    const parts = new Map(spec.parts.map((p) => [p.part, p]));
    const nodes: HTMLElement[] = [header(), el(doc, "p", `${spec.title} form on ${SITE_NAME}.`, "muted")];

    if (entries) {
      const noun = spec.section === "work" ? "job" : "school";
      if (entries.length === 0) {
        panel.replaceChildren(...nodes, el(doc, "p", `Your Clew profile has no ${noun} to fill.`));
        return;
      }
      const label = el(doc, "label", `Which ${noun} is this form for?`, "entry");
      const picker = el(doc, "select");
      const none = el(doc, "option", "Choose one");
      none.value = "";
      picker.append(none);
      for (const entry of entries) {
        const option = el(doc, "option", entry.name);
        option.value = entry.id;
        option.selected = entry.id === chosen;
        picker.append(option);
      }
      picker.addEventListener("change", (event) => {
        if (trusted(event)) showFields(spec, fields, entries, picker.value || null);
      });
      label.append(picker);
      nodes.push(label);
      if (!chosen) {
        panel.replaceChildren(...nodes);
        return;
      }
    }

    const candidates = entries
      ? (entries.find((e) => e.id === chosen)?.fields ?? [])
      : fields.filter((f) => !f.key.includes("."));
    const shown = candidates.filter((f) => parts.has(partOf(f)));
    if (shown.length === 0) {
      panel.replaceChildren(...nodes, el(doc, "p", "Your Clew profile has nothing to fill on this form."));
      return;
    }
    const list = el(doc, "ul");
    const boxes: [HTMLInputElement, FillField][] = [];
    for (const field of shown) {
      const row = el(doc, "label", undefined, "field");
      const box = el(doc, "input");
      box.type = "checkbox";
      box.checked = false;
      boxes.push([box, field]);
      row.append(
        box,
        el(doc, "span", field.label, "name"),
        el(doc, "span", field.value, "value"),
        el(doc, "span", field.behind ? "Changed since the last fill" : "Same as the last fill", field.behind ? "badge" : "badge same"),
      );
      const item = el(doc, "li");
      item.append(row);
      list.append(item);
    }
    const fill = el(doc, "button", "Fill ticked fields", "primary");
    fill.type = "button";
    onClick(fill, () => {
      const ticked = boxes.filter(([box]) => box.checked).map(([, field]) => field);
      if (ticked.length === 0) return;
      void fillTicked(spec, ticked, parts);
    });
    panel.replaceChildren(...nodes, el(doc, "p", "Tick what you want filled."), list, fill);
  };

  const fillTicked = async (spec: FormSpec, ticked: FillField[], parts: Map<string, PartSpec>) => {
    const open = openForm(doc);
    if (open?.spec.kind !== spec.kind) {
      render();
      return;
    }
    const results = el(doc, "ul");
    const notes = new Set<string>();
    const filled: string[] = [];
    for (const field of ticked) {
      const part = parts.get(partOf(field));
      const ok = part?.fill(open.form, field.value) ?? false;
      if (ok) {
        filled.push(field.key);
        const note = part?.note?.(field.value);
        if (note) notes.add(note);
      }
      results.append(el(doc, "li", `${field.label}: ${ok ? "filled" : "not found on this form"}`));
    }
    const done = el(doc, "button", "Close");
    done.type = "button";
    onClick(done, () => host.remove());
    panel.replaceChildren(
      header(),
      results,
      ...[...notes].map((note) => el(doc, "p", note)),
      el(doc, "p", filled.length ? `Check the fields, then press Save on ${SITE_NAME}.` : "Nothing was filled.", "done"),
      done,
    );
    if (filled.length) await deps.report(filled).catch(() => undefined);
  };

  function render() {
    const open = openForm(doc);
    if (!open) {
      showNoForm();
      return;
    }
    const { spec } = open;
    if (spec.section === "basics") {
      showFields(spec, data.fields, null, null);
      return;
    }
    const entries = entriesOf(data.fields, spec.section);
    showFields(spec, data.fields, entries, entries.length === 1 ? (entries[0]?.id ?? null) : null);
  }

  render();
  return shadow;
}
