import { useClerk } from "@clerk/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useApi } from "../auth/useApi";
import { AppHeader } from "../components/AppHeader";
import { useMediaQuery } from "../components/useMediaQuery";
import { AddApplicationDialog } from "./AddApplicationDialog";
import { ApplicationDetail } from "./ApplicationDetail";
import {
  byNewest,
  cardLine,
  closedLabel,
  columnLabel,
  columnOf,
  COLUMNS,
  STATUS_CHOICES,
  stepText,
  type Application,
  type Column,
  type Status,
} from "./model";

type BoardState =
  | { status: "loading"; attempt: number }
  | { status: "error"; attempt: number }
  | { status: "ready"; attempt: number; apps: Application[] };

/** The Applications board (TRK-01 to TRK-08): five columns on wide screens, status tabs on
 *  phones. Every card has a Status select, so moving one never needs dragging. */
export function ApplicationsPage() {
  const api = useApi();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const { applicationId } = useParams();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setBoard] = useState<BoardState>({ status: "loading", attempt: 0 });
  const board = useMemo<BoardState>(
    () => (loaded.attempt === attempt ? loaded : { status: "loading", attempt }),
    [loaded, attempt],
  );
  const [tab, setTab] = useState<Column>("saved");
  // Matches the CSS breakpoint where the board turns into one column with tabs.
  const tabMode = useMediaQuery("(max-width: 47.99rem)");
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const selects = useRef(new Map<string, HTMLSelectElement>());
  const tabs = useRef(new Map<Column, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  // The card whose Status select takes focus once the board has re-rendered. A moved card
  // is a new element in its new column, so focus can only move after React commits it.
  const focusCard = useRef<string | null>(null);

  useEffect(() => {
    document.title = "Applications · Clew";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/applications")
      .then(({ data }) => {
        if (cancelled) return;
        setBoard(data ? { status: "ready", attempt, apps: data.applications } : { status: "error", attempt });
      })
      .catch(() => {
        if (!cancelled) setBoard({ status: "error", attempt });
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  useEffect(() => {
    const id = focusCard.current;
    if (!id) return;
    focusCard.current = null;
    selects.current.get(id)?.focus();
  }, [board, tab]);

  const apps = useMemo(() => (board.status === "ready" ? board.apps : []), [board]);
  const byColumn = useMemo(() => {
    const groups = new Map<Column, Application[]>(COLUMNS.map((c) => [c.id, []]));
    for (const app of [...apps].sort(byNewest)) groups.get(columnOf(app.status))?.push(app);
    return groups;
  }, [apps]);

  const replace = (next: Application) =>
    setBoard((current) =>
      current.status === "ready"
        ? { ...current, apps: [next, ...current.apps.filter((a) => a.id !== next.id)] }
        : current,
    );

  const move = async (app: Application, to: Status) => {
    const { data } = await api
      .PATCH("/applications/{application_id}/status", {
        params: { path: { application_id: app.id } },
        body: { status: to },
      })
      .catch(() => ({ data: undefined }));
    if (!data) return setAnnouncement(`We couldn't move ${app.title}. Try again.`);
    const column = columnOf(data.status);
    // Focus stays on the card's Status select, now in its new column.
    focusCard.current = data.id;
    replace(data);
    setTab(column);
    setAnnouncement(`${data.title} moved to ${columnLabel(column)}.`);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = COLUMNS.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % COLUMNS.length
        : event.key === "ArrowLeft"
          ? (index + last) % COLUMNS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = COLUMNS[target]?.id ?? "saved";
    setTab(next);
    tabs.current.get(next)?.focus();
  };

  const header = <AppHeader email={null} onSignOut={() => void signOut({ redirectUrl: "/sign-in" })} />;
  const live = (
    <p className="clew-sr-only" role="status" aria-live="polite">
      {announcement}
    </p>
  );

  if (applicationId) {
    return (
      <>
        {header}
        <main id="main" className="apps-page">
          <ApplicationDetail
            key={applicationId}
            applicationId={applicationId}
            onChange={replace}
            onAnnounce={setAnnouncement}
            onDeleted={(app) => {
              setBoard((current) =>
                current.status === "ready"
                  ? { ...current, apps: current.apps.filter((a) => a.id !== app.id) }
                  : current,
              );
              setAnnouncement(`Deleted ${app.title}.`);
              void navigate("/applications");
              requestAnimationFrame(() => document.getElementById("apps-heading")?.focus());
            }}
          />
          {live}
        </main>
      </>
    );
  }

  return (
    <>
      {header}
      <main id="main" className="apps-page">
        <div className="apps-head">
          <h1 id="apps-heading" tabIndex={-1}>
            Applications
          </h1>
          <button ref={addButton} type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Add an application
          </button>
        </div>

        {board.status === "loading" && (
          <p role="status" aria-busy="true">
            Loading your applications
          </p>
        )}

        {board.status === "error" && (
          <div className="jobs-empty" role="alert">
            <h2>We couldn&apos;t load your applications</h2>
            <p>Check your connection and try again.</p>
            <button type="button" className="button button-secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}

        {board.status === "ready" && apps.length === 0 && (
          <div className="jobs-empty">
            <h2>No applications yet</h2>
            <p>Save or apply to a job from your feed and it shows up here.</p>
            <Link to="/jobs" className="button button-primary">
              Go to your jobs
            </Link>
          </div>
        )}

        {board.status === "ready" && apps.length > 0 && (
          <>
            <div className="apps-tabs" role="tablist" aria-label="Status">
              {COLUMNS.map((column, index) => (
                <button
                  key={column.id}
                  ref={(el) => {
                    if (el) tabs.current.set(column.id, el);
                    else tabs.current.delete(column.id);
                  }}
                  type="button"
                  role="tab"
                  id={`apps-tab-${column.id}`}
                  aria-selected={tab === column.id}
                  aria-controls={`apps-col-${column.id}`}
                  tabIndex={tab === column.id ? 0 : -1}
                  className="apps-tab"
                  onClick={() => setTab(column.id)}
                  onKeyDown={(event) => onTabKey(event, index)}
                >
                  {column.label} {byColumn.get(column.id)?.length ?? 0}
                </button>
              ))}
            </div>
            <div className="apps-board">
              {COLUMNS.map((column) => {
                const cards = byColumn.get(column.id) ?? [];
                return (
                  <section
                    key={column.id}
                    id={`apps-col-${column.id}`}
                    // Columns are tab panels only while the tabs show; side by side they're sections.
                    role={tabMode ? "tabpanel" : undefined}
                    className={`apps-column${tab === column.id ? " apps-column-current" : ""}`}
                    aria-labelledby={
                      tabMode ? `apps-tab-${column.id}` : `apps-col-${column.id}-heading`
                    }
                  >
                    <h2 id={`apps-col-${column.id}-heading`} className="apps-column-title">
                      {column.label} <span className="apps-column-count">({cards.length})</span>
                    </h2>
                    {cards.length === 0 ? (
                      <p className="apps-column-empty">{column.empty}</p>
                    ) : (
                      <ul className="apps-cards">
                        {cards.map((app) => (
                          <li key={app.id}>
                            <AppCard
                              app={app}
                              selectRef={(el) => {
                                if (el) selects.current.set(app.id, el);
                                else selects.current.delete(app.id);
                              }}
                              onMove={(to) => void move(app, to)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}

        {adding && (
          <AddApplicationDialog
            onClose={() => {
              setAdding(false);
              requestAnimationFrame(() => addButton.current?.focus());
            }}
            onAdded={(app) => {
              setAdding(false);
              // Focus goes to the new card's Status select.
              focusCard.current = app.id;
              replace(app);
              const column = columnOf(app.status);
              setTab(column);
              setAnnouncement(`Added ${app.title} to ${columnLabel(column)}.`);
            }}
          />
        )}
        {live}
      </main>
    </>
  );
}

function AppCard({
  app,
  selectRef,
  onMove,
}: {
  app: Application;
  selectRef: (el: HTMLSelectElement | null) => void;
  onMove: (to: Status) => void;
}) {
  const pill = closedLabel(app.status);
  const line = cardLine(app);
  const selectId = `app-status-${app.id}`;
  return (
    <article className="app-card" aria-labelledby={`app-title-${app.id}`}>
      <h3 id={`app-title-${app.id}`} className="app-card-title">
        <Link to={`/applications/${app.id}`}>{app.title}</Link>
      </h3>
      <p className="app-card-company">{app.company}</p>
      <p className="app-card-meta">
        {stepText(app)}
        {pill && <span className="pill pill-neutral">{pill}</span>}
        {app.job_status === "closed" && <span className="pill pill-neutral">Posting closed</span>}
      </p>
      {line && <p className="app-card-line">{line}</p>}
      <div className="app-card-status">
        <label className="clew-sr-only" htmlFor={selectId}>
          Status of {app.title}
        </label>
        <select
          id={selectId}
          ref={selectRef}
          className="field-input"
          value={app.status}
          onChange={(e) => onMove(e.target.value as Status)}
        >
          {STATUS_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}
