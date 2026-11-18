import { useId, useState, type FormEvent } from "react";

import { MAX_WHAT, type Filters } from "./model";

/**
 * What and Where, in the Jobs band. What looks for words in the job title or company; Where is
 * a US state. Searching keeps the other filters. Give it a `key` from the address, so it starts
 * over when the filters change elsewhere.
 */
export function JobSearch({ filters, onApply }: { filters: Filters; onApply: (filters: Filters) => void }) {
  const id = useId();
  const [what, setWhat] = useState(filters.what ?? "");
  const [where, setWhere] = useState(filters.region ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Filters = { ...filters, what: undefined, region: undefined };
    const words = what.trim().replace(/\s+/g, " ");
    if (words) next.what = words.slice(0, MAX_WHAT);
    if (where.trim()) next.region = where.trim();
    onApply(next);
  };

  return (
    <form role="search" aria-label="Jobs" className="job-search" onSubmit={submit}>
      <div className="job-search-field">
        <label htmlFor={`${id}-what`}>What</label>
        <input
          id={`${id}-what`}
          type="search"
          value={what}
          maxLength={MAX_WHAT}
          placeholder="Title or company"
          onChange={(e) => setWhat(e.target.value)}
        />
      </div>
      <div className="job-search-field">
        <label htmlFor={`${id}-where`}>Where</label>
        <input
          id={`${id}-where`}
          value={where}
          maxLength={40}
          placeholder="State, like TX"
          onChange={(e) => setWhere(e.target.value)}
        />
      </div>
      <button type="submit" className="button job-search-button">
        Search
      </button>
    </form>
  );
}
