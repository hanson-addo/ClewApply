import { useEffect, useRef } from "react";

export type SummaryError = { id: string; label: string; message: string };

/** Shown above a form after a failed save. It takes focus so screen readers read it, and each
 *  link takes the person to the field (design: ErrorSummary). */
export function ErrorSummary({
  errors,
  onSelect,
  attempt,
}: {
  errors: SummaryError[];
  onSelect: (id: string) => void;
  /** Changes on every failed save, so focus returns here each time. */
  attempt: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [attempt]);

  const count = errors.length;
  return (
    <div ref={ref} className="error-summary" tabIndex={-1} aria-labelledby="error-summary-title">
      <h2 id="error-summary-title" className="error-summary-title">
        Fix {count} {count === 1 ? "thing" : "things"} to continue
      </h2>
      <ul>
        {errors.map((error) => (
          <li key={error.id}>
            <a
              href={`#${error.id}`}
              onClick={(event) => {
                event.preventDefault();
                onSelect(error.id);
              }}
            >
              {error.label}: {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
