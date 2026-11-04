import { useClerk } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, useBlocker, useNavigate, useParams } from "react-router";

import { useApi } from "../auth/useApi";
import { AppHeader } from "../components/AppHeader";
import { ErrorSummary } from "../components/ErrorSummary";
import { useQuestion } from "../components/QuestionDialog";
import {
  SECTIONS,
  cleanProfile,
  emptyProfile,
  errorsFromApi,
  inputId,
  labelOf,
  sameProfile,
  sectionBySlug,
  sectionOf,
  validateProfile,
  type FieldErrors,
  type ProfileData,
  type ProfileVersion,
  type SectionId,
  type VersionSummary,
} from "./model";
import { SectionEditor } from "./SectionEditor";
import { VersionHistory, VersionView } from "./VersionHistory";

type Loaded = {
  email: string | null;
  /** The current saved version; null before the first save. */
  saved: ProfileVersion | null;
  versions: VersionSummary[];
};

type SaveOutcome = "saved" | "unchanged" | "failed";

const VERSION_LIMIT = 100;

/** "Edited Basics and Experience", from the sections that differ. */
function changeSummary(before: ProfileData, after: ProfileData): string | null {
  const changed = SECTIONS.filter(
    ({ id }) =>
      JSON.stringify(cleanProfile({ ...emptyProfile(), [id]: before[id] })[id]) !==
      JSON.stringify(cleanProfile({ ...emptyProfile(), [id]: after[id] })[id]),
  ).map((s) => s.title);
  if (changed.length === 0) return null;
  const list =
    changed.length === 1
      ? changed[0]
      : `${changed.slice(0, -1).join(", ")} and ${changed[changed.length - 1]}`;
  return `Edited ${list}`;
}

function errorDetail(error: unknown): unknown {
  return typeof error === "object" && error !== null && "detail" in error
    ? (error as { detail: unknown }).detail
    : undefined;
}

async function fetchProfile(api: ReturnType<typeof useApi>): Promise<Loaded> {
  const [me, profile, versions] = await Promise.all([
    api.GET("/me"),
    api.GET("/profile"),
    api.GET("/profile/versions", { params: { query: { limit: VERSION_LIMIT } } }),
  ]);
  if (!versions.data || (!profile.data && profile.response.status !== 404)) {
    throw new Error("load failed");
  }
  return { email: me.data?.email ?? null, saved: profile.data ?? null, versions: versions.data };
}

/** The master profile editor (issue #15; screen spec in docs/design/screens.md). */
export function ProfilePage() {
  const { section: slug } = useParams();
  const current = sectionBySlug(slug);
  return current ? <ProfileEditor section={current.id} title={current.title} /> : <Navigate to="/profile/basics" replace />;
}

function ProfileEditor({ section, title }: { section: SectionId; title: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const [ask, questionDialog] = useQuestion();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<ProfileData>(emptyProfile);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<{ section: SectionId; index: number } | null>(null);
  const [viewing, setViewing] = useState<ProfileVersion | null>(null);
  // An element to focus after the next render; the tick makes sure that render happens.
  const focusTarget = useRef<string | null>(null);
  const [, setFocusTick] = useState(0);
  const setFocusId = useCallback((id: string) => {
    focusTarget.current = id;
    setFocusTick((n) => n + 1);
  }, []);
  const heading = useRef<HTMLHeadingElement>(null);

  const savedData = loaded?.saved?.data ?? emptyProfile();
  const dirty = loaded !== null && !sameProfile(draft, savedData);

  // --- Loading -----------------------------------------------------------------------------

  const apply = (next: Loaded) => {
    setLoaded(next);
    setDraft(next.saved?.data ?? emptyProfile());
  };

  useEffect(() => {
    let cancelled = false;
    fetchProfile(api)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // --- Page title and focus ----------------------------------------------------------------

  useEffect(() => {
    document.title = `${title} · Profile · Clew`;
    heading.current?.focus();
  }, [title]);

  // Runs after every render. A section switch can render in a later pass (router transitions),
  // so the target waits until its element exists.
  useEffect(() => {
    if (!focusTarget.current) return;
    const element = document.getElementById(focusTarget.current);
    if (!element) return;
    element.focus();
    focusTarget.current = null;
  });

  // --- Leaving with unsaved changes --------------------------------------------------------

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // --- Saving ------------------------------------------------------------------------------

  const save = async (data: ProfileData, summary: string | null): Promise<SaveOutcome> => {
    if (!loaded) return "failed";
    setSaving(true);
    setFormError(null);
    try {
      const { data: version, error, response } = await api.PUT("/profile", {
        body: { data, base_version_id: loaded.saved?.id ?? null, change_summary: summary },
      });
      if (version) {
        const unchanged = version.id === loaded.saved?.id;
        const versions = unchanged
          ? loaded.versions
          : [
              { ...version, is_current: true },
              ...loaded.versions.map((v) => ({ ...v, is_current: false })),
            ];
        setLoaded({ ...loaded, saved: version, versions });
        setDraft(version.data);
        setErrors({});
        setConflict(false);
        return unchanged ? "unchanged" : "saved";
      }
      if (response.status === 409) {
        setConflict(true);
      } else if (response.status === 413) {
        setFormError("Your profile is too long to save. Shorten some descriptions.");
      } else if (response.status === 422) {
        const fromApi = errorsFromApi(errorDetail(error));
        if (Object.keys(fromApi).length) {
          setErrors(fromApi);
          setAttempt((n) => n + 1);
        } else {
          setFormError("Something in your profile can't be saved. Check your entries and try again.");
        }
      } else if (response.status === 401) {
        setFormError("You've been signed out. Sign in again to save your changes.");
      } else {
        setFormError("We couldn't save your profile. Try again in a moment.");
      }
    } catch {
      setFormError("We couldn't save your profile. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
    return "failed";
  };

  /** Checks the draft, then saves it. */
  const saveDraft = async (): Promise<SaveOutcome> => {
    const found = validateProfile(draft);
    if (Object.keys(found).length) {
      setErrors(found);
      setAttempt((n) => n + 1);
      return "failed";
    }
    // Blank entries disappear now, so any field errors the server returns line up with the form.
    const cleaned = cleanProfile(draft);
    setDraft(cleaned);
    const outcome = await save(cleaned, changeSummary(savedData, cleaned));
    if (outcome === "saved") setStatus("Saved. Clew kept your previous version in History.");
    if (outcome === "unchanged") setStatus("No changes to save.");
    return outcome;
  };

  /** Asks before leaving with unsaved changes; true when it's fine to go. */
  const readyToLeave = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await ask({
      title: "Save your changes?",
      body: <p>You changed your profile but haven&apos;t saved it.</p>,
      choices: [
        { value: "keep", label: "Keep editing" },
        { value: "discard", label: "Discard" },
        { value: "save", label: "Save", primary: true },
      ],
    });
    if (choice === "discard") return true;
    if (choice === "save") return (await saveDraft()) !== "failed";
    return false;
    // saveDraft changes every render; dirty is what decides whether to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, ask, draft, loaded]);

  // Any navigation out of the profile asks first: header links, the browser's Back and
  // Forward buttons, and redirects. Moving between profile sections keeps the draft.
  const dirtyNow = useRef(dirty);
  const leaving = useRef(false);
  useEffect(() => {
    dirtyNow.current = dirty;
  });
  const blocker = useBlocker(
    useCallback(
      ({ nextLocation }: { nextLocation: { pathname: string } }) =>
        dirtyNow.current && !leaving.current && !nextLocation.pathname.startsWith("/profile"),
      [],
    ),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    // Asked from a callback, not the effect body: the question dialog sets state.
    void Promise.resolve()
      .then(readyToLeave)
      .then((ok) => {
        if (ok) {
          leaving.current = true;
          blocker.proceed();
        } else {
          blocker.reset();
        }
      });
    // Ask once each time a navigation is blocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // --- Actions -----------------------------------------------------------------------------

  const discard = async () => {
    const choice = await ask({
      title: "Discard your changes?",
      body: <p>Your profile goes back to the last version you saved.</p>,
      choices: [
        { value: "keep", label: "Keep editing" },
        { value: "discard", label: "Discard changes", primary: true },
      ],
    });
    if (choice !== "discard") return;
    setDraft(savedData);
    setErrors({});
    setFormError(null);
    setOpen(null);
    setStatus("Changes discarded.");
    setFocusId("profile-page-title");
  };

  const reloadLatest = async () => {
    try {
      apply(await fetchProfile(api));
      setConflict(false);
      setErrors({});
      setOpen(null);
      setStatus("Loaded the latest version of your profile.");
      setFocusId("profile-page-title");
    } catch {
      setFormError("We couldn't load the latest version. Check your connection and try again.");
    }
  };

  const view = async (id: string) => {
    try {
      const { data } = await api.GET("/profile/versions/{version_id}", {
        params: { path: { version_id: id } },
      });
      if (data) setViewing(data);
      else setStatus("We couldn't open that version. Try again in a moment.");
    } catch {
      setStatus("We couldn't open that version. Check your connection and try again.");
    }
  };

  const restore = async (version: ProfileVersion) => {
    if (!loaded) return;
    const number = version.number;
    setViewing(null);
    const choice = await ask({
      title: `Restore version ${number}?`,
      body: (
        <p>
          Your current profile stays in history.
          {dirty && " Your unsaved changes will be lost."}
        </p>
      ),
      choices: [
        { value: "cancel", label: "Cancel" },
        { value: "restore", label: `Restore version ${number}`, primary: true },
      ],
    });
    if (choice !== "restore") return;
    const outcome = await save(version.data, `Restored version ${number}`);
    if (outcome !== "failed") {
      setOpen(null);
      setStatus(`Restored version ${number}. It's now your current profile.`);
      setFocusId("profile-page-title");
    }
  };

  const signOutSafely = async () => {
    if (!(await readyToLeave())) return;
    leaving.current = true;
    // If signing out fails, the user stays here and later edits still ask before leaving.
    signOut({ redirectUrl: "/sign-in" }).catch(() => {
      leaving.current = false;
    });
  };

  const goToError = (id: string) => {
    const target = sectionOf(id);
    const slugFor = SECTIONS.find((s) => s.id === target)?.slug ?? "basics";
    const index = Number(id.split(".")[1]);
    if (target !== "basics" && Number.isInteger(index)) setOpen({ section: target, index });
    if (target !== section) void navigate(`/profile/${slugFor}`);
    setFocusId(inputId(id));
  };

  const editDraft = (next: ProfileData, changedFieldId?: string) => {
    setDraft(next);
    if (changedFieldId && errors[changedFieldId]) {
      setErrors(Object.fromEntries(Object.entries(errors).filter(([id]) => id !== changedFieldId)));
    }
  };

  // --- Render ------------------------------------------------------------------------------

  const errorList = Object.entries(errors).map(([id, message]) => ({
    id: inputId(id),
    fieldId: id,
    label: labelOf(id),
    message,
  }));

  return (
    <>
      <AppHeader email={loaded?.email ?? null} onSignOut={() => void signOutSafely()} />
      <main id="main" className="profile-page">
        <div className="profile-head">
          <p className="profile-eyebrow">Your profile</p>
          <h1 id="profile-page-title" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p className="profile-lede">
            Edit here once. Each save keeps the previous version in History.
          </p>
        </div>

        <p role="status" className="profile-status">
          {status}
        </p>

        {!loaded && !loadFailed && <p className="profile-loading">Loading your profile…</p>}
        {loadFailed && (
          <p role="alert" className="home-error">
            We couldn&apos;t load your profile. Check your connection and refresh the page.
          </p>
        )}

        {loaded && (
          <div className="profile-layout">
            <nav aria-label="Profile sections" className="profile-nav">
              <ul>
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <NavLink to={`/profile/${s.slug}`} className="profile-nav-link">
                      {s.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="profile-select field">
              <label htmlFor="profile-section-select" className="field-label">
                Section
              </label>
              <select
                id="profile-section-select"
                className="field-input"
                value={SECTIONS.find((s) => s.id === section)?.slug}
                onChange={(event) => void navigate(`/profile/${event.target.value}`)}
              >
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>

            <form
              className="profile-form"
              noValidate
              aria-labelledby="profile-page-title"
              onSubmit={(event) => {
                event.preventDefault();
                void saveDraft();
              }}
            >
              {conflict && (
                <div role="alert" className="profile-conflict">
                  <p>
                    <strong>Your profile changed somewhere else.</strong> Reload it to see the
                    latest version. Your edits are kept below until you reload, so you can copy
                    them.
                  </p>
                  <div className="profile-conflict-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void reloadLatest()}
                    >
                      Reload latest
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setConflict(false)}
                    >
                      Keep my edits for now
                    </button>
                  </div>
                </div>
              )}
              {errorList.length > 0 && (
                <ErrorSummary
                  errors={errorList}
                  attempt={attempt}
                  onSelect={(id) => {
                    const item = errorList.find((e) => e.id === id);
                    if (item) goToError(item.fieldId);
                  }}
                />
              )}
              {formError && (
                <p role="alert" className="home-error">
                  {formError}
                </p>
              )}

              <SectionEditor
                key={section}
                section={section}
                profile={draft}
                errors={errors}
                openEntry={open?.section === section ? open.index : null}
                onOpenEntry={(index) => setOpen(index === null ? null : { section, index })}
                onChange={editDraft}
                onFocus={setFocusId}
                onAnnounce={setStatus}
              />

              <div className="profile-savebar">
                <span className="profile-savebar-state">
                  {dirty ? "You have unsaved changes." : "All changes saved."}
                </span>
                {dirty && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void discard()}
                  >
                    Discard
                  </button>
                )}
                <button
                  type="submit"
                  className="button button-primary"
                  aria-busy={saving || undefined}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>

            <aside className="profile-aside" aria-label="Profile history">
              <VersionHistory versions={loaded.versions} onView={(id) => void view(id)} />
            </aside>
          </div>
        )}
        {viewing && loaded && (
          <VersionView
            version={viewing}
            number={viewing.number}
            onClose={() => setViewing(null)}
            onRestore={() => void restore(viewing)}
          />
        )}
        {questionDialog}
      </main>
    </>
  );
}
