import type { CSSProperties } from "react";
import { Link } from "react-router";

import { COLUMNS } from "../applications/model";
import { PageBand } from "../components/PageBand";
import { FitScore } from "../jobs/FitScore";
import {
  activeCount,
  firstName,
  greetingFor,
  payText,
  pipelineCounts,
  setupProgress,
  statusLine,
  type FeedJob,
  type Progress,
} from "./model";
import { YarnArt } from "./BrandArt";
import { MapStage } from "./MapStage";
import { useCountUp } from "./useCountUp";
import type { Dashboard } from "./useDashboard";
import type { JobMapState } from "./useJobMap";

/** A ring that shows how many setup steps are done. The text carries the meaning. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    // --ring-full lets the fill animate in from empty (CSS; off under reduced motion).
    <div className="ring" style={{ "--ring-full": `${circumference}` } as CSSProperties}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={radius} className="ring-track" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          className="ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - done / total)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="ring-label">
        {done}/{total}
      </span>
    </div>
  );
}

function Hero({ data, progress, hour }: { data: Dashboard; progress: Progress; hour: number }) {
  const counts = pipelineCounts(data.apps ?? []);
  const name = firstName(data.name);
  return (
    <section className="home-hero page-intro clew-inverse" aria-labelledby="home-title">
      <PageBand kind="home" />
      <div className="home-hero-copy">
        <p className="home-eyebrow">{greetingFor(hour)}</p>
        <h1 id="home-title" className="home-title">
          {name
            ? `Welcome back, ${name}.`
            : data.hasProfile === false
              ? "Let's get you hired."
              : "Welcome back."}
        </h1>
        <p className="home-hero-lede">
          {data.hasProfile === null
            ? "We couldn't load your profile just now. Reload the page to try again."
            : statusLine(data.hasProfile, counts, data.jobs?.total ?? 0)}
        </p>
        {data.hasProfile !== false ? (
          <div className="home-hero-actions">
            <Link to="/jobs" className="button button-primary button-lg">
              See your matches
            </Link>
            <Link to="/profile" className="button button-inverse-outline button-lg">
              Edit profile
            </Link>
          </div>
        ) : (
          <Link to="/onboarding/upload" className="home-dropzone">
            <span className="home-dropzone-icon" aria-hidden="true">
              ↑
            </span>
            <span className="home-dropzone-text">
              <span className="home-dropzone-title">Add your resume</span>
              <span className="home-dropzone-hint">PDF or Word, up to 10 MB. About a minute.</span>
            </span>
            <span className="button button-primary button-lg home-dropzone-cta" aria-hidden="true">
              Start
            </span>
          </Link>
        )}
      </div>
      {data.hasProfile !== null && !progress.complete && (
        <div className="home-hero-progress">
          <ProgressRing done={progress.doneCount} total={progress.steps.length} />
          <p>
            <strong>Setup</strong>
            <span>{progress.doneCount === 0 ? "Not started" : `${progress.doneCount} of ${progress.steps.length} done`}</span>
          </p>
        </div>
      )}
    </section>
  );
}

function Tile({ value, label, to }: { value: number; label: string; to: string }) {
  const shown = useCountUp(value);
  return (
    // The counting number is for the eye; screen readers get the final value from the label.
    <Link to={to} className="stat-tile" aria-label={`${value} ${label}`}>
      <span className="stat-value" aria-hidden="true">
        {shown}
      </span>
      <span className="stat-label" aria-hidden="true">
        {label}
      </span>
    </Link>
  );
}

function Stats({ data }: { data: Dashboard }) {
  const counts = pipelineCounts(data.apps ?? []);
  return (
    <section aria-label="Your numbers" className="stat-row">
      {data.jobs && <Tile value={data.jobs.total} label="Jobs matching you" to="/jobs" />}
      {data.apps && (
        <>
          <Tile value={counts.saved} label="Saved" to="/applications" />
          <Tile value={activeCount(counts) - counts.saved} label="In progress" to="/applications" />
          <Tile value={counts.interview} label="Interviews" to="/applications" />
        </>
      )}
    </section>
  );
}

function JobRow({ job }: { job: FeedJob }) {
  const pay = payText(job);
  const meta = [job.company, job.location ?? (job.remote_type === "remote" ? "Remote" : null), pay]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link to={`/jobs/${job.id}`} className="match-row">
        <FitScore score={job.fit_score} />
        <span className="match-text">
          <span className="match-title">{job.title}</span>
          <span className="match-meta">{meta}</span>
        </span>
        <span className="match-arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}

function TopMatches({ jobs }: { jobs: NonNullable<Dashboard["jobs"]> }) {
  return (
    <section className="home-card" aria-labelledby="matches-title">
      <div className="home-card-head">
        <h2 id="matches-title">Top matches</h2>
        {jobs.total > 0 && (
          <Link to="/jobs" className="home-card-link">
            See all {jobs.total}
          </Link>
        )}
      </div>
      {jobs.items.length === 0 ? (
        <div className="home-empty-art">
          <YarnArt />
          <p className="home-empty">No matches yet. New jobs come in every hour, so check back soon.</p>
        </div>
      ) : (
        <ul className="match-list">
          {jobs.items.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Checklist({ progress }: { progress: Progress }) {
  return (
    <section className="home-card" aria-labelledby="setup-title">
      <div className="home-card-head">
        <h2 id="setup-title">Finish setting up</h2>
      </div>
      <ol className="check-list">
        {progress.steps.map((step) => (
          <li key={step.id} className={step.done ? "check-done" : undefined}>
            <span className="check-mark" aria-hidden="true">
              {step.done ? "✓" : ""}
            </span>
            <span className="check-text">
              {step.done ? (
                <span className="check-title">
                  {step.title}
                  <span className="clew-sr-only">, done</span>
                </span>
              ) : (
                <Link to={step.to} className="check-title check-link">
                  {step.title}
                </Link>
              )}
              <span className="check-hint">{step.hint}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Pipeline({ apps }: { apps: NonNullable<Dashboard["apps"]> }) {
  const counts = pipelineCounts(apps);
  const total = apps.length;
  return (
    <section className="home-card" aria-labelledby="pipeline-title">
      <div className="home-card-head">
        <h2 id="pipeline-title">Your pipeline</h2>
        <Link to="/applications" className="home-card-link">
          Open tracker
        </Link>
      </div>
      {total === 0 ? (
        <div className="home-empty-art">
          <YarnArt />
          <p className="home-empty">Save a job from your feed and it shows up here.</p>
        </div>
      ) : (
        <ul className="pipe-list">
          {COLUMNS.map((col) => (
            <li key={col.id}>
              <span className="pipe-label">{col.label}</span>
              <span className="pipe-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((counts[col.id] / total) * 100)}%` }} />
              </span>
              <span className="pipe-count">{counts[col.id]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The signed-in home: a hero and setup beside the jobs map, then your numbers, top matches and pipeline. */
export function HomeDashboard({
  data,
  map,
  hour = new Date().getHours(),
}: {
  data: Dashboard;
  map: JobMapState;
  hour?: number;
}) {
  const progress = setupProgress(data.hasProfile === true, data.prefs, data.apps?.length ?? null);
  return (
    <div className="home-grid">
      {/* The greeting and setup, then a wide map of jobs near the user. */}
      <MapStage
        state={map}
        intro={
          <>
            <Hero data={data} progress={progress} hour={hour} />
            {/* Unknown profile state: no checklist, so it never says "Add your resume" by mistake. */}
            {data.hasProfile !== null && !progress.complete && <Checklist progress={progress} />}
          </>
        }
      />
      {data.hasProfile && <Stats data={data} />}
      {data.hasProfile && (
        <div className="home-columns">
          <div className="home-col">
            {data.jobs ? (
              <TopMatches jobs={data.jobs} />
            ) : (
              <p role="status" className="home-note">
                We couldn&apos;t load your matches just now. Open Jobs to try again.
              </p>
            )}
          </div>
          <div className="home-col">{data.apps && <Pipeline apps={data.apps} />}</div>
        </div>
      )}
    </div>
  );
}
