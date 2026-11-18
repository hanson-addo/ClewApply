import { useId, useState, type FormEvent } from "react";

import { POSTED_WITHIN, SOURCES, sourceName, type Filters, type Source, type WorkType } from "./model";

type Draft = { work: string; minSalary: string; postedWithin: string; source: string };

function toDraft(filters: Filters): Draft {
  return {
    work: filters.work ?? "",
    minSalary: filters.minSalary ? String(filters.minSalary) : "",
    postedWithin: filters.postedWithin ? String(filters.postedWithin) : "",
    source: filters.source ?? "",
  };
}

/** The panel's fields over the current filters; What and Where come from the band and stay. */
function fromDraft(draft: Draft, current: Filters): Filters {
  const filters: Filters = {};
  if (current.what) filters.what = current.what;
  if (current.region) filters.region = current.region;
  if (draft.work === "remote" || draft.work === "not-remote") filters.work = draft.work as WorkType;
  const salary = Number(draft.minSalary.replace(/[$,\s]/g, ""));
  if (Number.isInteger(salary) && salary > 0) filters.minSalary = Math.min(salary, 2_000_000);
  const days = POSTED_WITHIN.find((d) => String(d) === draft.postedWithin);
  if (days) filters.postedWithin = days;
  const source = SOURCES.find((s) => s === draft.source);
  if (source) filters.source = source as Source;
  return filters;
}

/**
 * The quieter feed filters, folded behind "More filters" (or "More filters, 2 on") under the
 * search in the band. Applying writes them to the address, so they survive reload (FEED-07).
 * Give it a `key` from the address, so it starts over when the filters change elsewhere.
 */
export function FilterPanel({
  filters,
  count,
  onApply,
}: {
  filters: Filters;
  count: number;
  onApply: (filters: Filters) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => toDraft(filters));
  const [open, setOpen] = useState(false);

  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(fromDraft(draft, filters));
    setOpen(false);
  };

  return (
    <aside className={`jobs-filters${open ? " jobs-filters-open" : ""}`} aria-label="More filters">
      <button
        type="button"
        className="jobs-filters-toggle"
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => setOpen((o) => !o)}
      >
        {count > 0 ? `More filters, ${count} on` : "More filters"}
      </button>
      <form id={`${id}-form`} className="jobs-filters-form" onSubmit={submit}>
        <h2 className="jobs-filters-title">More filters</h2>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-work`}>
            Work type
          </label>
          <select id={`${id}-work`} className="field-input" value={draft.work} onChange={(e) => set("work")(e.target.value)}>
            <option value="">Any</option>
            <option value="remote">Remote</option>
            <option value="not-remote">On-site or hybrid</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-pay`}>
            Minimum yearly pay
          </label>
          <input
            id={`${id}-pay`}
            className="field-input"
            inputMode="numeric"
            value={draft.minSalary}
            placeholder="90000"
            onChange={(e) => set("minSalary")(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-posted`}>
            Posted within
          </label>
          <select
            id={`${id}-posted`}
            className="field-input"
            value={draft.postedWithin}
            onChange={(e) => set("postedWithin")(e.target.value)}
          >
            <option value="">Any time</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-source`}>
            Source
          </label>
          <select id={`${id}-source`} className="field-input" value={draft.source} onChange={(e) => set("source")(e.target.value)}>
            <option value="">All sources</option>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {sourceName(source)}
              </option>
            ))}
          </select>
        </div>
        <div className="jobs-filters-actions">
          <button type="submit" className="button button-primary">
            Apply filters
          </button>
          {count > 0 && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                onApply({ what: filters.what, region: filters.region });
                setOpen(false);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
