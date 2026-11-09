import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useApi } from "../auth/useApi";
import { TextAreaField, TextField } from "../components/TextField";
import { safeUrl } from "../jobs/model";
import { dateToIso, STATUS_CHOICES, type Application, type Status } from "./model";

type Errors = { title?: string; company?: string; url?: string; form?: string };

/** "Add an application" for a job that isn't in the feed (TRK-06). A native modal dialog:
 *  the browser traps focus, and Escape or Cancel closes it. */
export function AddApplicationDialog({
  onAdded,
  onClose,
}: {
  onAdded: (app: Application) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("applied");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Errors = {};
    if (!title.trim()) found.title = "Enter the job title.";
    if (!company.trim()) found.company = "Enter the company.";
    if (url.trim() && !safeUrl(url.trim())) found.url = "Enter a link that starts with https:// or http://.";
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`${id}-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.POST("/applications", {
        body: {
          title: title.trim(),
          company: company.trim(),
          url: url.trim() || null,
          status,
          applied_at: status === "saved" ? null : (dateToIso(date) ?? null),
          notes,
        },
      });
      if (data) return onAdded(data);
      setErrors({ form: "We couldn't add that. Check the fields and try again." });
    } catch {
      setErrors({ form: "We couldn't add that. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={`${id}-heading`} className="dialog-title">
        Add an application
      </h2>
      <p className="dialog-meta">For a job that isn&apos;t in your feed.</p>
      <form noValidate onSubmit={(event) => void submit(event)}>
        {errors.form && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
        <TextField
          id={`${id}-title`}
          label="Job title"
          value={title}
          maxLength={300}
          required
          error={errors.title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          id={`${id}-company`}
          label="Company"
          value={company}
          maxLength={200}
          required
          error={errors.company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <TextField
          id={`${id}-url`}
          label="Link to the posting (optional)"
          type="url"
          inputMode="url"
          value={url}
          maxLength={2048}
          error={errors.url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="field">
          <label className="field-label" htmlFor={`${id}-status`}>
            Status
          </label>
          <select
            id={`${id}-status`}
            className="field-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
          >
            {STATUS_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        {status !== "saved" && (
          <TextField
            id={`${id}-date`}
            label="Date applied (optional)"
            hint="Leave it empty for today."
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
        <TextAreaField
          id={`${id}-notes`}
          label="Notes (optional)"
          value={notes}
          maxLength={5000}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="dialog-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Add application
          </button>
        </div>
      </form>
    </dialog>
  );
}
