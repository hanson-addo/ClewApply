import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type Common = { id: string; label: string; hint?: string; error?: string; className?: string };

/** Ids of the hint and error, joined for aria-describedby. */
function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function Extras({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </>
  );
}

/** Labelled input with its hint and error linked for screen readers (design: TextField). */
export function TextField({
  id,
  label,
  hint,
  error,
  className,
  ...input
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "id">) {
  return (
    <div className={`field${error ? " field-invalid" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <Extras id={id} hint={hint} error={error} />
      <input
        id={id}
        className="field-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...input}
      />
    </div>
  );
}

/** The multi-line version of TextField. */
export function TextAreaField({
  id,
  label,
  hint,
  error,
  className,
  ...textarea
}: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  return (
    <div className={`field${error ? " field-invalid" : ""}${className ? ` ${className}` : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <Extras id={id} hint={hint} error={error} />
      <textarea
        id={id}
        className="field-input field-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...textarea}
      />
    </div>
  );
}
