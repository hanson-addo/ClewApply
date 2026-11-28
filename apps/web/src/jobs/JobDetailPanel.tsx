import { useEffect, useState } from "react";
import { Link, type To } from "react-router";

import { useApi } from "../auth/useApi";
import { FitScore } from "./FitScore";
import {
  applyLabel,
  DESCRIPTION_PREVIEW,
  domainOf,
  placeText,
  safeUrl,
  salaryText,
  sourceName,
  type FeedJob,
  type JobDetail,
  type Toast,
} from "./model";

type State = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; job: JobDetail };

/** "Why it fits you": a bar for each part the fit score weighs, then the reasons in words. */
function FitWhy({ job }: { job: JobDetail }) {
  if (job.fit_parts.length === 0 && job.reasons.length === 0) return null;
  return (
    <section className="fit-why" aria-labelledby="fit-why-title">
      <h3 id="fit-why-title" className="fit-why-title">
        Why it fits you
      </h3>
      {job.fit_parts.length > 0 && (
        <ul className="fit-why-bars">
          {job.fit_parts.map((part) => (
            <li key={part.label}>
              <span className="fit-why-label">{part.label}</span>
              {part.value === null ? (
                // Nothing to compare: say so, rather than draw a half-full bar.
                <span className="fit-why-note">{part.note ?? "Not listed"}</span>
              ) : (
                <>
                  <span className="fit-why-track" aria-hidden="true">
                    <span className="fit-why-fill" style={{ width: `${part.value}%` }} />
                  </span>
                  <span className="fit-why-value">
                    {part.value}
                    <span className="clew-sr-only"> out of 100</span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {job.reasons.length > 0 && (
        <ul className="fit-why-reasons">
          {job.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One job in full. A side panel on wide screens, the whole page on phones. */
export function JobDetailPanel({
  jobId,
  backTo,
  onChange,
  onDismiss,
  onToast,
}: {
  jobId: string;
  backTo: To;
  onChange: (id: string, change: Partial<FeedJob>) => void;
  onDismiss: (job: FeedJob) => void;
  onToast: (toast: Toast) => void;
}) {
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });
  const [fullText, setFullText] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/jobs/{job_id}", { params: { path: { job_id: jobId } } })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (data) setState({ status: "ready", job: data });
        else setState({ status: response.status === 404 ? "missing" : "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api, jobId]);

  const back = (
    <Link to={backTo} className="jobs-back">
      Back to jobs
    </Link>
  );

  if (state.status === "loading") {
    return (
      <div className="job-detail" aria-busy="true">
        {back}
        <p role="status">Loading the job</p>
      </div>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="job-detail">
        {back}
        <p role="alert">
          {state.status === "missing"
            ? "That job isn't in your feed anymore."
            : "We couldn't load this job. Check your connection and try again."}
        </p>
      </div>
    );
  }

  const { job } = state;
  const apply = safeUrl(job.apply_url);
  const salary = salaryText(job);
  const description = job.description ?? "";
  const long = description.length > DESCRIPTION_PREVIEW;
  const shown = fullText || !long ? description : `${description.slice(0, DESCRIPTION_PREVIEW).trimEnd()}…`;

  const toggleSave = async () => {
    setBusy(true);
    const { response } = job.saved
      ? await api.DELETE("/jobs/{job_id}/feedback", { params: { path: { job_id: job.id } } })
      : await api.POST("/jobs/{job_id}/save", { params: { path: { job_id: job.id } } });
    setBusy(false);
    if (!response.ok) return onToast({ message: "We couldn't save that. Try again." });
    const saved = !job.saved;
    setState({ status: "ready", job: { ...job, saved, dismissed: false } });
    onChange(job.id, { saved });
    onToast({ message: saved ? "Saved." : "Removed from saved jobs." });
  };

  const dismiss = async () => {
    setBusy(true);
    const { response } = await api.POST("/jobs/{job_id}/dismiss", { params: { path: { job_id: job.id } } });
    setBusy(false);
    if (!response.ok) return onToast({ message: "We couldn't hide that job. Try again." });
    onDismiss(job);
  };

  return (
    <article className="job-detail" aria-labelledby="job-detail-title">
      {back}
      <div className="job-detail-head">
        <FitScore score={job.fit_score} />
        <div>
          <p className="job-detail-fit">
            Fit score {job.fit_score} of 100
          </p>
          <h2 id="job-detail-title">{job.title}</h2>
          <p className="job-detail-company">
            {job.company}
            {job.unverified_board && <span className="pill pill-warning">Unverified board</span>}
          </p>
          <p className="job-detail-meta">
            {placeText(job)} · {salary ?? "Salary not posted"}
          </p>
        </div>
      </div>

      {job.unverified_board && (
        <p className="job-detail-warning">
          Someone added this company&apos;s job board, and Clew hasn&apos;t checked it. Make sure
          it&apos;s the company&apos;s real site before you apply.
        </p>
      )}
      {job.status === "closed" && <p className="job-detail-warning">This posting has closed.</p>}

      <div className="job-detail-actions">
        {apply && job.status === "open" ? (
          <div>
            <a
              className="button button-primary job-detail-apply"
              href={apply.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${applyLabel(job)} (opens in a new tab)`}
            >
              {applyLabel(job)}
            </a>
            <p className="job-detail-domain">{domainOf(apply)}</p>
          </div>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          aria-pressed={job.saved}
          onClick={() => void toggleSave()}
          disabled={busy}
        >
          {job.saved ? "Saved" : "Save"}
        </button>
        <button type="button" className="button button-secondary" onClick={() => void dismiss()} disabled={busy}>
          Not for me
        </button>
      </div>

      <FitWhy job={job} />

      <section aria-labelledby="job-where">
        <h3 id="job-where">Where it&apos;s posted</h3>
        <ul className="job-detail-listings">
          {job.listings.map((listing) => {
            const url = safeUrl(listing.url);
            const name = sourceName(listing.source);
            return (
              <li key={`${listing.source}-${listing.url}`}>
                {url ? (
                  <a href={url.href} target="_blank" rel="noopener noreferrer">
                    {name} <span className="clew-sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  name
                )}
                {listing.is_primary && <span className="job-detail-apply-here"> · Apply here</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {description && (
        <section aria-labelledby="job-about">
          <h3 id="job-about">About the job</h3>
          {/* Plain text only: descriptions are stored as text and never rendered as HTML. */}
          <p className="job-detail-description" id="job-description">
            {shown}
          </p>
          {long && (
            <button
              type="button"
              className="button button-ghost"
              aria-expanded={fullText}
              aria-controls="job-description"
              onClick={() => setFullText((f) => !f)}
            >
              {fullText ? "Show less" : "Read the full description"}
            </button>
          )}
        </section>
      )}
    </article>
  );
}
