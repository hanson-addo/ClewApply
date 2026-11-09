import { useEffect, useId, useState } from "react";
import { Link } from "react-router";

import { useApi } from "../auth/useApi";
import { TextAreaField } from "../components/TextField";
import { useQuestion } from "../components/QuestionDialog";
import { domainOf, safeUrl } from "../jobs/model";
import { closedLabel, columnLabel, columnOf, sentText, shortDate, STATUS_CHOICES, type Application, type Status } from "./model";

type State = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; app: Application };

/** One application: the posting link, what was sent, notes, status and Delete (TRK-05, TRK-07). */
export function ApplicationDetail({
  applicationId,
  onChange,
  onDeleted,
  onAnnounce,
}: {
  applicationId: string;
  onChange: (app: Application) => void;
  onDeleted: (app: Application) => void;
  onAnnounce: (message: string) => void;
}) {
  const api = useApi();
  const id = useId();
  const [ask, question] = useQuestion();
  const [state, setState] = useState<State>({ status: "loading" });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/applications/{application_id}", { params: { path: { application_id: applicationId } } })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (data) {
          setState({ status: "ready", app: data });
          setNotes(data.notes);
        } else setState({ status: response.status === 404 ? "missing" : "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api, applicationId]);

  const back = (
    <Link to="/applications" className="jobs-back">
      Back to applications
    </Link>
  );

  if (state.status === "loading") {
    return (
      <div className="app-detail" aria-busy="true">
        {back}
        <p role="status">Loading the application</p>
      </div>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="app-detail">
        {back}
        <p role="alert">
          {state.status === "missing"
            ? "That application isn't here anymore."
            : "We couldn't load this application. Check your connection and try again."}
        </p>
      </div>
    );
  }

  const { app } = state;
  const posting = app.url ? safeUrl(app.url) : null;
  const pill = closedLabel(app.status);
  const sent = sentText(app);
  const path = { params: { path: { application_id: app.id } } };

  const updated = (next: Application, message: string) => {
    setState({ status: "ready", app: next });
    onChange(next);
    onAnnounce(message);
  };

  const changeStatus = async (to: Status) => {
    setBusy(true);
    const { data } = await api.PATCH("/applications/{application_id}/status", { ...path, body: { status: to } });
    setBusy(false);
    if (!data) return onAnnounce("We couldn't move that. Try again.");
    updated(data, `${data.title} moved to ${columnLabel(columnOf(data.status))}.`);
  };

  const saveNotes = async () => {
    setBusy(true);
    const { data } = await api.PATCH("/applications/{application_id}", { ...path, body: { notes } });
    setBusy(false);
    if (!data) return onAnnounce("We couldn't save your notes. Try again.");
    updated(data, "Notes saved.");
  };

  const download = async () => {
    if (!app.resume_id) return;
    const { data } = await api.GET("/resumes/{resume_id}/download", {
      params: { path: { resume_id: app.resume_id } },
    });
    const link = data ? safeUrl(data.url) : null;
    if (!link) return onAnnounce("We couldn't get that file. Try again.");
    window.location.assign(link.href);
  };

  const remove = async () => {
    const answer = await ask({
      title: "Delete this application? This can't be undone.",
      choices: [
        { value: "keep", label: "Keep it" },
        { value: "delete", label: "Delete application", primary: true },
      ],
    });
    if (answer !== "delete") return;
    setBusy(true);
    const { response } = await api.DELETE("/applications/{application_id}", path);
    setBusy(false);
    if (!response.ok) return onAnnounce("We couldn't delete that. Try again.");
    onDeleted(app);
  };

  return (
    <article className="app-detail" aria-labelledby={`${id}-title`}>
      {back}
      <h1 id={`${id}-title`} tabIndex={-1}>
        {app.title}
      </h1>
      <p className="app-detail-company">
        {app.company}
        {pill && <span className="pill pill-neutral">{pill}</span>}
        {app.job_status === "closed" && <span className="pill pill-neutral">Posting closed</span>}
      </p>

      <div className="field app-detail-status">
        <label className="field-label" htmlFor={`${id}-status`}>
          Status
        </label>
        <select
          id={`${id}-status`}
          className="field-input"
          value={app.status}
          disabled={busy}
          onChange={(e) => void changeStatus(e.target.value as Status)}
        >
          {STATUS_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>

      <dl className="app-detail-facts">
        <dt>Added</dt>
        <dd>{shortDate(app.created_at)}</dd>
        {app.applied_at && app.status !== "saved" && (
          <>
            <dt>Applied</dt>
            <dd>{shortDate(app.applied_at)}</dd>
          </>
        )}
        <dt>Posting</dt>
        <dd>
          {posting ? (
            <>
              <a href={posting.href} target="_blank" rel="noopener noreferrer">
                {domainOf(posting)} <span className="clew-sr-only">(opens in a new tab)</span>
              </a>
            </>
          ) : (
            "No link saved"
          )}
        </dd>
        <dt>Resume sent</dt>
        <dd>
          {sent ? sent.replace(/^Sent: /, "") : "Not recorded"}
          {app.resume_id && !app.resume_deleted && (
            <>
              {" "}
              <button type="button" className="button button-ghost" onClick={() => void download()}>
                Download this version
              </button>
            </>
          )}
        </dd>
      </dl>

      <section aria-labelledby={`${id}-notes-heading`}>
        <h2 id={`${id}-notes-heading`}>Notes</h2>
        <TextAreaField
          id={`${id}-notes`}
          label="Notes"
          className="app-detail-notes"
          value={notes}
          maxLength={5000}
          rows={5}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || notes === app.notes}
          onClick={() => void saveNotes()}
        >
          Save notes
        </button>
      </section>

      <div className="app-detail-danger">
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void remove()}>
          Delete application
        </button>
      </div>
      {question}
    </article>
  );
}
