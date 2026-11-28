import { Component, type ErrorInfo, type ReactNode } from "react";

import { Logo } from "../components/Logo";

/**
 * Shown when Clerk's sign-in script can't load, so the app never sits on "Loading…". A div,
 * not main: the routes beside it may render their own main landmark.
 */
export function SignInUnavailablePage() {
  return (
    <div className="setup-needed" role="alert">
      <Logo variant="onLight" />
      <h1>Sign-in couldn&apos;t load</h1>
      <p>
        Check your internet connection, then reload. If it keeps happening, check that{" "}
        <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env</code> is the publishable key from
        your Clerk dashboard (it starts with <code>pk_test_</code>), then restart{" "}
        <code>docker compose up</code>.
      </p>
    </div>
  );
}

/** Catches a crash while rendering, so a problem shows a message instead of a blank page. */
export class StartupErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only place this goes; it never leaves the device.
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="setup-needed" role="alert">
        <Logo variant="onLight" />
        <h1>Clew couldn&apos;t start</h1>
        <p>
          Refresh the page to try again. If it keeps happening, the browser console (F12, then
          Console) says what went wrong.
        </p>
      </main>
    );
  }
}
