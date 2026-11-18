import { useEffect, useState } from "react";

import type { components } from "../api/schema";
import { useApi } from "../auth/useApi";
import { useSignOut } from "../auth/useSignOut";
import { AppHeader } from "../components/AppHeader";
import { PageBand } from "../components/PageBand";

type SiteStatus = components["schemas"]["SiteStatus"];
type State =
  | { status: "loading" }
  | { status: "error"; unavailable: boolean }
  | { status: "ready"; sites: SiteStatus[] };

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function stateLabel(site: SiteStatus): string {
  if (site.state === "not_set_up") return "Not set up yet";
  if (site.state === "up_to_date") return "Up to date";
  const n = site.behind.length;
  return `${n} ${n === 1 ? "change" : "changes"} behind`;
}

function SiteCard({ site }: { site: SiteStatus }) {
  const titleId = `sync-${site.site}`;
  return (
    <section className={`sync-card sync-${site.state.replaceAll("_", "-")}`} aria-labelledby={titleId}>
      <div className="sync-card-head">
        <h2 id={titleId}>{site.name}</h2>
        <p className="sync-state">{stateLabel(site)}</p>
      </div>
      {site.last_filled_at && <p className="sync-when">Last filled from Clew {when(site.last_filled_at)}</p>}
      {site.state === "not_set_up" && (
        <p className="sync-hint">Clew hasn&apos;t filled anything on {site.name} yet.</p>
      )}
      {site.behind.length > 0 && (
        <>
          <h3 className="sync-changed-title">Changed in your Clew profile since then</h3>
          <ul className="sync-changed" aria-label={`Changed fields for ${site.name}`}>
            {site.behind.map((field) => (
              <li key={field.key}>{field.label}</li>
            ))}
          </ul>
        </>
      )}
      <a className="button button-secondary sync-open" href={site.profile_url} target="_blank" rel="noopener noreferrer">
        Open your {site.name} profile
        <span className="clew-sr-only"> (opens in a new tab)</span>
      </a>
    </section>
  );
}

/** Sync Center (#130 step 2): how far each job site is behind your Clew profile. */
export function SyncPage() {
  const api = useApi();
  const signOut = useSignOut();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    document.title = "Sync · Clew";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/sync/status")
      .then(({ data, response }) => {
        if (cancelled) return;
        if (data) setState({ status: "ready", sites: data.sites });
        else setState({ status: "error", unavailable: response.status === 503 });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", unavailable: false });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <>
      <AppHeader email={null} onSignOut={() => void signOut()} />
      <main id="main" className="sync-page">
        <div className="page-intro sync-intro">
          <PageBand kind="profile" />
          <h1>Sync Center</h1>
          <p className="sync-lede">
            How far each job site is behind your Clew profile. The Clew extension fills only the fields you tick, and you
            press Save on the site yourself.
          </p>
        </div>
        {state.status === "loading" && <p role="status">Loading your sites…</p>}
        {state.status === "error" && (
          <p role="alert" className="sync-error">
            {state.unavailable
              ? "The Sync Center isn't available yet."
              : "We couldn't load your sites. Check your connection and refresh the page."}
          </p>
        )}
        {state.status === "ready" && (
          <>
            <div className="sync-cards">
              {state.sites.map((site) => (
                <SiteCard key={site.site} site={site} />
              ))}
            </div>
            <p className="sync-note">
              Clew only knows what it filled. Edits you make directly on a site aren&apos;t seen here.
            </p>
          </>
        )}
      </main>
    </>
  );
}
