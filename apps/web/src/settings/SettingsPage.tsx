import { useClerk } from "@clerk/react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useApi } from "../auth/useApi";
import { useSignOut } from "../auth/useSignOut";
import { AppHeader } from "../components/AppHeader";
import { PageBand } from "../components/PageBand";
import { isCancelled, useAccountRequest } from "./accountRequest";
import { ExtensionCard } from "./ExtensionCard";

/** How long a prepared download stays offered before the file is dropped from memory. */
const DOWNLOAD_MINUTES = 15;

type Account = { email: string; plan: string };
type Prepared = { url: string; size: number };
type ExportState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "ready"; file: Prepared }
  | { status: "failed"; message: string };

const EXPORT_FAILED = "We couldn't prepare your file. Try again in a few minutes.";
const DELETE_FAILED = "Your account wasn't deleted. Some resume files may already be removed. Try again, or contact us.";

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadCard() {
  const requestExport = useAccountRequest("POST", "/me/export");
  const [state, setState] = useState<ExportState>({ status: "idle" });

  // Drop the prepared file when it expires, and when the page goes away.
  useEffect(() => {
    if (state.status !== "ready") return;
    const url = state.file.url;
    const expire = window.setTimeout(() => setState({ status: "idle" }), DOWNLOAD_MINUTES * 60_000);
    return () => {
      window.clearTimeout(expire);
      URL.revokeObjectURL(url);
    };
  }, [state]);

  async function prepare() {
    setState({ status: "preparing" });
    try {
      const result = await requestExport();
      if (!(result instanceof Response) || !result.ok) {
        const tooMany = result instanceof Response && result.status === 429;
        setState({
          status: "failed",
          message: tooMany ? "You've downloaded your data several times this hour. Try again later." : EXPORT_FAILED,
        });
        return;
      }
      const blob = await result.blob();
      setState({ status: "ready", file: { url: URL.createObjectURL(blob), size: blob.size } });
    } catch (error) {
      setState(isCancelled(error) ? { status: "idle" } : { status: "failed", message: EXPORT_FAILED });
    }
  }

  return (
    <section className="settings-card" aria-labelledby="download-title">
      <h2 id="download-title">Download your data</h2>
      <p>
        A zip with your profile, every version, your applications, your settings, your consent
        history, your resume drafts and your uploaded resume files.
      </p>
      {state.status === "ready" ? (
        <a className="button button-primary settings-action" href={state.file.url} download="clew-data.zip">
          Download (expires in {DOWNLOAD_MINUTES} minutes) · {sizeLabel(state.file.size)}
        </a>
      ) : (
        <button
          type="button"
          className="button button-secondary settings-action"
          disabled={state.status === "preparing"}
          onClick={() => void prepare()}
        >
          Prepare download
        </button>
      )}
      <p role="status" className="settings-status">
        {state.status === "preparing" && "Preparing your file."}
      </p>
      {state.status === "failed" && (
        <p role="alert" className="settings-error">
          {state.message}
        </p>
      )}
    </section>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const requestDelete = useAccountRequest("DELETE", "/me");
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toUpperCase() === "DELETE";

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Cancel is the default focus, so Enter never deletes by accident.
    cancel.current?.focus();
  }, []);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const result = await requestDelete();
      if (result instanceof Response && result.status === 204) {
        // The account is gone. Clerk may already have ended the session, so signing out can
        // fail; that changes nothing for the user, who goes to the "deleted" page either way.
        try {
          await signOut({ redirectUrl: "/account-deleted" });
        } catch {
          navigate("/account-deleted", { replace: true });
        }
        return;
      }
      setError(DELETE_FAILED);
    } catch (problem) {
      if (!isCancelled(problem)) setError(DELETE_FAILED);
    }
    setDeleting(false);
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onClose();
      }}
    >
      <h2 id="delete-title" className="dialog-title">
        Delete your account?
      </h2>
      <div className="dialog-body">
        <p>
          This deletes your profile, every version, your resumes, your applications, your settings
          and your sign-in. It can&apos;t be undone.
        </p>
        <label htmlFor={fieldId} className="settings-confirm-label">
          Type DELETE to confirm
        </label>
        <input
          id={fieldId}
          className="field-input"
          autoComplete="off"
          value={typed}
          disabled={deleting}
          onChange={(event) => setTyped(event.target.value)}
        />
        {error && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button ref={cancel} type="button" className="button button-secondary" disabled={deleting} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={!confirmed || deleting}
          onClick={() => void remove()}
        >
          {deleting ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </dialog>
  );
}

function DeleteCard() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <section className="settings-card settings-danger" aria-labelledby="delete-card-title">
      <h2 id="delete-card-title">Delete account</h2>
      <p>
        This deletes your profile, every version, your resumes, your applications, your settings
        and your sign-in. It can&apos;t be undone.
      </p>
      <button ref={opener} type="button" className="button button-danger settings-action" onClick={() => setOpen(true)}>
        Delete my account
      </button>
      {open && (
        <DeleteDialog
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </section>
  );
}

/** Settings: the account, a copy of your data, and deleting the account (#31). */
export function SettingsPage() {
  const api = useApi();
  const signOut = useSignOut();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    document.title = "Settings · Clew";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/me")
      .then(({ data }) => {
        if (!cancelled && data) setAccount({ email: data.email, plan: data.plan });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <>
      <AppHeader
        email={account?.email ?? null}
        onSignOut={() => void signOut()}
      />
      <main id="main" className="settings-page">
        <div className="page-intro settings-intro">
          <PageBand kind="profile" />
          <h1>Settings</h1>
        </div>
        <section className="settings-card" aria-labelledby="account-title">
          <h2 id="account-title">Account</h2>
          <dl className="settings-facts">
            <dt>Email</dt>
            <dd>{account?.email ?? "…"}</dd>
            <dt>Plan</dt>
            <dd>{account ? (account.plan === "free" ? "Free" : account.plan) : "…"}</dd>
          </dl>
          <p className="settings-hint">Change your email in your sign-in settings.</p>
        </section>
        <ExtensionCard />
        <DownloadCard />
        <DeleteCard />
      </main>
    </>
  );
}

/** Public page after deleting: the user is already signed out. */
export function AccountDeletedPage() {
  useEffect(() => {
    document.title = "Account deleted · Clew";
  }, []);
  return (
    <main id="main" className="settings-page settings-deleted">
      <h1>Your account is deleted</h1>
      <p>
        <a href="/">Go to the home page</a>
      </p>
    </main>
  );
}
