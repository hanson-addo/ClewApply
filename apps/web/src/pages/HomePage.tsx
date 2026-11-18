import { useEffect, useState } from "react";

import { useApi } from "../auth/useApi";
import { AppHeader } from "../components/AppHeader";
import { HomeDashboard } from "../home/HomeDashboard";
import { useDashboard } from "../home/useDashboard";
import { useJobMap } from "../home/useJobMap";
import { useSignOut } from "../auth/useSignOut";

type Me = { id: string; email: string; plan: string };
type State =
  | { status: "loading" }
  | { status: "ready"; me: Me }
  | { status: "email-required" }
  | { status: "unavailable" }
  | { status: "error" };

/** The API's error body is `{ detail: string }`; match on it, not just the status code. */
function errorDetail(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "detail" in error) {
    const { detail } = error as { detail: unknown };
    return typeof detail === "string" ? detail : undefined;
  }
  return undefined;
}

/** Signed-in landing page. The first visit also creates the Clew account (GET /me). */
export function HomePage() {
  const api = useApi();
  const signOut = useSignOut();
  const [state, setState] = useState<State>({ status: "loading" });
  const dashboard = useDashboard(state.status === "ready");
  const jobMap = useJobMap(state.status === "ready");

  useEffect(() => {
    document.title = "Home · Clew";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/me")
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setState({ status: "ready", me: data });
        else if (response.status === 403 && errorDetail(error) === "email_required")
          setState({ status: "email-required" });
        else if (response.status === 503) setState({ status: "unavailable" });
        else setState({ status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <>
      <AppHeader
        email={state.status === "ready" ? state.me.email : null}
        onSignOut={() => void signOut()}
      />
      <main id="main" className={state.status === "ready" ? "home home-wide" : "home"}>
        {state.status === "loading" && <p role="status">Loading your account…</p>}
        {state.status === "error" && (
          <p role="alert" className="home-error">
            We couldn&apos;t load your account. Check your connection and refresh the page.
          </p>
        )}
        {state.status === "unavailable" && (
          <p role="alert" className="home-error">
            Sign-in is temporarily unavailable. Please try again in a few minutes.
          </p>
        )}
        {state.status === "email-required" && (
          <p role="alert" className="home-error">
            Clew needs an email address on your account. Sign out, then sign in with email, Google
            or LinkedIn.
          </p>
        )}
        {state.status === "ready" && dashboard.status === "loading" && (
          <p role="status" className="home-loading">
            Loading your home…
          </p>
        )}
        {state.status === "ready" && dashboard.status === "ready" && (
          <HomeDashboard data={dashboard} map={jobMap} />
        )}
      </main>
    </>
  );
}
