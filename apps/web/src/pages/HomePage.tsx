import { useClerk } from "@clerk/react";
import { useEffect, useState } from "react";

import { useApi } from "../auth/useApi";
import { AppHeader } from "../components/AppHeader";

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
  const { signOut } = useClerk();
  const [state, setState] = useState<State>({ status: "loading" });

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
        onSignOut={() => void signOut({ redirectUrl: "/sign-in" })}
      />
      <main id="main" className="home">
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
        {state.status === "ready" && (
          <>
            <h1>You&apos;re in.</h1>
            <p className="home-lede">
              Next you&apos;ll add your resume, and Clew will build your profile from it. That
              step is coming soon.
            </p>
          </>
        )}
      </main>
    </>
  );
}
