import { useClerk } from "@clerk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useApi } from "../auth/useApi";
import { AppHeader } from "../components/AppHeader";
import { PageBand } from "../components/PageBand";
import { FitScore } from "./FitScore";
import { JobDetailPanel } from "./JobDetailPanel";
import {
  cardName,
  countFilters,
  countMoreFilters,
  feedQuery,
  placeText,
  readFilters,
  salaryText,
  sourceName,
  writeFilters,
  type FeedJob,
  type Filters,
  type Toast,
} from "./model";
import { FilterPanel } from "./FilterPanel";
import { JobSearch } from "./JobSearch";

type ListState =
  | { status: "loading" }
  | { status: "error"; key: string }
  | {
      status: "ready";
      key: string;
      jobs: FeedJob[];
      total: number;
      page: number;
      hasMore: boolean;
      loadingMore: boolean;
    };

const TOAST_MS = 10_000;

/** The job feed: filters, the ranked list, and the selected job (FEED-01 to FEED-16). */
export function JobsPage() {
  const api = useApi();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const { jobId } = useParams();
  const [params, setParams] = useSearchParams();
  const query = writeFilters(readFilters(params)).toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(query)), [query]);
  const [attempt, setAttempt] = useState(0);
  // Which filters (and retry) the loaded list belongs to; anything else shows as loading.
  const loadKey = `${query}#${attempt}`;
  const [loaded, setList] = useState<ListState>({ status: "loading" });
  const list = useMemo<ListState>(
    () => (loaded.status !== "loading" && loaded.key === loadKey ? loaded : { status: "loading" }),
    [loaded, loadKey],
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const cardLinks = useRef(new Map<string, HTMLAnchorElement>());
  const focusAfterLoad = useRef<string | null>(null);

  useEffect(() => {
    document.title = "Jobs · Clew";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/feed", { params: { query: feedQuery(filters, 1) } })
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) return setList({ status: "error", key: loadKey });
        setList({
          status: "ready",
          key: loadKey,
          jobs: data.jobs,
          total: data.total,
          page: 1,
          hasMore: data.has_more,
          loadingMore: false,
        });
      })
      .catch(() => {
        if (!cancelled) setList({ status: "error", key: loadKey });
      });
    return () => {
      cancelled = true;
    };
  }, [api, filters, loadKey]);

  // The toast waits while it has keyboard focus or the pointer is over it, so Undo stays reachable.
  const [toastHovered, setToastHovered] = useState(false);
  const [toastFocused, setToastFocused] = useState(false);
  const toastHeld = toastHovered || toastFocused;
  useEffect(() => {
    if (!toast || toastHeld) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, toastHeld]);

  useEffect(() => {
    // After "Show 25 more", focus moves to the first new card (FEED-15).
    const id = focusAfterLoad.current;
    if (id && list.status === "ready") {
      cardLinks.current.get(id)?.focus();
      focusAfterLoad.current = null;
    }
  }, [list]);

  const showMore = useCallback(() => {
    if (list.status !== "ready" || list.loadingMore) return;
    const next = list.page + 1;
    setList({ ...list, loadingMore: true });
    api
      .GET("/feed", { params: { query: feedQuery(filters, next) } })
      .then(({ data }) => {
        setList((current) => {
          if (current.status !== "ready") return current;
          if (!data) return { ...current, loadingMore: false };
          const known = new Set(current.jobs.map((j) => j.id));
          const fresh = data.jobs.filter((j) => !known.has(j.id));
          focusAfterLoad.current = fresh[0]?.id ?? null;
          return {
            ...current,
            jobs: [...current.jobs, ...fresh],
            total: data.total,
            page: next,
            hasMore: data.has_more,
            loadingMore: false,
          };
        });
      })
      .catch(() => setList((current) => (current.status === "ready" ? { ...current, loadingMore: false } : current)));
  }, [api, filters, list]);

  const applyFilters = (next: Filters) => {
    setParams(writeFilters(next));
  };

  const updateJob = useCallback((id: string, change: Partial<FeedJob>) => {
    setList((current) =>
      current.status === "ready"
        ? { ...current, jobs: current.jobs.map((j) => (j.id === id ? { ...j, ...change } : j)) }
        : current,
    );
  }, []);

  /** "Not for me": the job leaves the list, focus moves to the next card, Undo for 10 s. */
  const dismissed = useCallback(
    (job: FeedJob) => {
      if (list.status !== "ready") return;
      const index = list.jobs.findIndex((j) => j.id === job.id);
      const rest = list.jobs.filter((j) => j.id !== job.id);
      const next = rest[index] ?? rest[index - 1];
      setList({ ...list, jobs: rest, total: Math.max(0, list.total - 1) });
      if (jobId === job.id) void navigate({ pathname: next ? `/jobs/${next.id}` : "/jobs", search: query });
      requestAnimationFrame(() => {
        if (next) cardLinks.current.get(next.id)?.focus();
        else document.getElementById("jobs-heading")?.focus();
      });
      setToast({
        message: `Hidden ${job.title}.`,
        undo: () => {
          // A saved job goes back to saved, not just un-hidden.
          const params = { params: { path: { job_id: job.id } } };
          void (job.saved ? api.POST("/jobs/{job_id}/save", params) : api.DELETE("/jobs/{job_id}/feedback", params))
            .then(({ response }) => {
              if (!response.ok) return setToast({ message: "We couldn't undo that. Try again." });
              setList((current) => {
                if (current.status !== "ready") return current;
                const jobs = [...current.jobs];
                jobs.splice(Math.min(index, jobs.length), 0, job);
                return { ...current, jobs, total: current.total + 1 };
              });
              setToast({ message: `${job.title} is back in your jobs.` });
            });
        },
      });
    },
    [api, jobId, list, navigate, query],
  );

  const filterCount = countFilters(filters);
  const moreCount = countMoreFilters(filters);
  const hasDetail = Boolean(jobId);

  return (
    <>
      <AppHeader email={null} onSignOut={() => void signOut({ redirectUrl: "/sign-in" })} />
      <main id="main" className={`jobs-page${hasDetail ? " jobs-has-detail" : ""}`}>
        <div className="page-intro jobs-intro">
          <PageBand kind="jobs" />
          <h1 id="jobs-heading" tabIndex={-1}>
            Jobs for you
          </h1>
          <p className="jobs-count" role="status" aria-live="polite">
            {list.status === "ready" && (
              <>
                Sorted by best fit · <span>{`${list.total} ${list.total === 1 ? "job" : "jobs"}`}</span>
              </>
            )}
            {list.status === "loading" && "Loading jobs"}
          </p>
          <JobSearch key={query} filters={filters} onApply={applyFilters} />
          <FilterPanel key={`more-${query}`} filters={filters} count={moreCount} onApply={applyFilters} />
        </div>

        <section className="jobs-list-col" aria-labelledby="jobs-heading">

          {list.status === "loading" && (
            <ul className="jobs-list" aria-busy="true" aria-label="Loading jobs">
              {[0, 1, 2].map((n) => (
                <li key={n} className="job-card job-card-skeleton" aria-hidden="true" />
              ))}
            </ul>
          )}

          {list.status === "error" && (
            <div className="jobs-empty" role="alert">
              <h2>We couldn&apos;t load your jobs</h2>
              <p>Check your connection and try again.</p>
              <button type="button" className="button button-secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}

          {list.status === "ready" && list.jobs.length === 0 && (
            <div className="jobs-empty">
              {filterCount > 0 ? (
                <>
                  <h2>No matches right now</h2>
                  <p>
                    Try fewer filters, or widen the location or salary. New jobs arrive every few
                    hours.
                  </p>
                  <button type="button" className="button button-secondary" onClick={() => applyFilters({})}>
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <h2>No jobs yet</h2>
                  <p>
                    Clew is gathering jobs from company job boards. New jobs arrive every few hours.
                  </p>
                </>
              )}
            </div>
          )}

          {list.status === "ready" && list.jobs.length > 0 && (
            <>
              <ul className="jobs-list">
                {list.jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard
                      job={job}
                      selected={job.id === jobId}
                      search={query}
                      linkRef={(node) => {
                        if (node) cardLinks.current.set(job.id, node);
                        else cardLinks.current.delete(job.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
              {list.hasMore && (
                <button
                  type="button"
                  className="button button-secondary jobs-more"
                  onClick={showMore}
                  aria-busy={list.loadingMore}
                  disabled={list.loadingMore}
                >
                  {list.loadingMore ? "Loading more jobs" : "Show 25 more"}
                </button>
              )}
            </>
          )}
        </section>

        <section className="jobs-detail-col" aria-label="Job details">
          {jobId ? (
            <JobDetailPanel
              key={jobId}
              jobId={jobId}
              backTo={{ pathname: "/jobs", search: query }}
              onChange={updateJob}
              onDismiss={dismissed}
              onToast={setToast}
            />
          ) : (
            <p className="jobs-detail-hint">Pick a job to see why it fits and where to apply.</p>
          )}
        </section>

        <div
          className="jobs-toast"
          role="status"
          aria-live="polite"
          onFocus={() => setToastFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setToastFocused(false);
          }}
          onMouseEnter={() => setToastHovered(true)}
          onMouseLeave={() => setToastHovered(false)}
        >
          {toast && (
            <p>
              {toast.message}{" "}
              {toast.undo && (
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    const undo = toast.undo;
                    setToast(null);
                    setToastHovered(false);
                    setToastFocused(false);
                    undo?.();
                  }}
                >
                  Undo
                </button>
              )}
            </p>
          )}
        </div>
      </main>
    </>
  );
}

function JobCard({
  job,
  selected,
  search,
  linkRef,
}: {
  job: FeedJob;
  selected: boolean;
  search: string;
  linkRef: (node: HTMLAnchorElement | null) => void;
}) {
  const salary = salaryText(job);
  return (
    <article className={`job-card${selected ? " job-card-selected" : ""}`}>
      <FitScore score={job.fit_score} />
      <div className="job-card-body">
        <h2 className="job-card-title">
          <Link
            ref={linkRef}
            to={{ pathname: `/jobs/${job.id}`, search }}
            aria-label={cardName(job)}
            aria-current={selected ? "true" : undefined}
          >
            {job.title}
          </Link>
        </h2>
        <p className="job-card-company">
          {job.company}
          {job.unverified_board && <span className="pill pill-warning">Unverified board</span>}
        </p>
        <p className="job-card-meta">
          {placeText(job)}
          {salary && ` · ${salary}`}
        </p>
        {job.reasons[0] && <p className="job-card-reason">{job.reasons[0]}</p>}
        <p className="job-card-sources">Seen on {job.seen_on.map(sourceName).join(", ")}</p>
      </div>
    </article>
  );
}
