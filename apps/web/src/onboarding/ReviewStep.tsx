import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { useApi } from "../auth/useApi";
import { ErrorSummary } from "../components/ErrorSummary";
import {
  SECTIONS,
  cleanProfile,
  emptyProfile,
  errorsFromApi,
  inputId,
  labelOf,
  validateProfile,
  type FieldErrors,
  type ProfileData,
  type SectionId,
} from "../profile/model";
import { SectionEditor } from "../profile/SectionEditor";
import { OnboardingLayout } from "./Layout";
import {
  checkFieldId,
  fieldPlace,
  fillBlanks,
  linkable,
  readFailure,
  rememberedResume,
  type Parse,
} from "./model";
import { usePollParse } from "./useParse";

type Read =
  | { kind: "none" }
  | { kind: "waiting"; status: "pending" | "running" }
  | { kind: "done"; draft: ProfileData; check: string[] }
  | { kind: "failed"; message: string };

type Existing = { status: "loading" } | { status: "error" } | { status: "ready"; baseId: string | null };

/** Onboarding step 2: the draft from the resume, as an editable profile form (docs/design/
 *  screens.md, "Review parsed resume"). Nothing is saved until "Looks good, continue". */
export function ReviewStep() {
  const api = useApi();
  const navigate = useNavigate();
  const id = useId();
  const [params] = useSearchParams();
  const resumeId = params.get("resume") ?? rememberedResume();
  const manual = params.get("manual") === "1";

  const [existing, setExisting] = useState<Existing>({ status: "loading" });
  const [read, setRead] = useState<Read>(
    resumeId && !manual ? { kind: "waiting", status: "pending" } : { kind: "none" },
  );
  // True once the user starts typing, or chose to enter details by hand.
  const [byHand, setByHand] = useState(manual || !resumeId);
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [offerFill, setOfferFill] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<Partial<Record<SectionId, number | null>>>({});
  const [retryWait, setRetryWait] = useState(0);
  const focusNext = useRef<string | null>(null);
  const [, setTick] = useState(0);
  const focus = useCallback((elementId: string) => {
    focusNext.current = elementId;
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    document.title = "Review your profile · Clew";
  }, []);

  useEffect(() => {
    if (!focusNext.current) return;
    const element = document.getElementById(focusNext.current);
    if (element) {
      element.focus();
      focusNext.current = null;
    }
  });

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/profile")
      .then(({ data, response }) => {
        if (cancelled) return;
        if (data) setExisting({ status: "ready", baseId: data.id });
        else if (response.status === 404) setExisting({ status: "ready", baseId: null });
        else setExisting({ status: "error" });
      })
      .catch(() => {
        if (!cancelled) setExisting({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (retryWait <= 0) return;
    const timer = setTimeout(() => setRetryWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryWait]);

  const onParse = (parse: Parse | null) => {
    if (parse === null) {
      setRead({ kind: "none" });
      return;
    }
    if (parse.status === "pending" || parse.status === "running") {
      if (read.kind !== "waiting" || read.status !== parse.status) {
        setRead({ kind: "waiting", status: parse.status });
        setStatus(parse.status === "running" ? "Reading your resume." : "Waiting to read your resume.");
      }
      return;
    }
    if (parse.status === "done" && parse.result) {
      const check = parse.result.check.map(checkFieldId).filter(linkable);
      setRead({ kind: "done", draft: parse.result.profile, check });
      if (byHand) {
        setOfferFill(true);
        setStatus("Your resume is ready. Fill in the blanks from it?");
      } else {
        setProfile(parse.result.profile);
        setStatus(
          check.length
            ? `Done. ${check.length} ${check.length === 1 ? "field needs" : "fields need"} a look.`
            : "Done. Check your profile, then continue.",
        );
      }
      return;
    }
    setRead({ kind: "failed", message: parse.message ?? "" });
    setStatus("");
    focus(`${id}-failure-action`);
  };

  const polling = read.kind === "waiting";
  usePollParse(api, resumeId, polling, onParse);

  const goToField = (fieldId: string) => {
    const { section, index } = fieldPlace(fieldId);
    if (index !== null) setOpen((current) => ({ ...current, [section]: index }));
    focus(inputId(fieldId));
  };

  const tryAgain = async () => {
    if (!resumeId) return;
    try {
      const { data, error, response } = await api.POST("/resumes/{resume_id}/parse", {
        params: { path: { resume_id: resumeId } },
      });
      if (data) {
        onParse(data);
        if (data.status === "pending" || data.status === "running") setRead({ kind: "waiting", status: data.status });
        return;
      }
      const detail =
        typeof error === "object" && error !== null && "detail" in error ? String(error.detail) : "";
      setRead({ kind: "failed", message: detail });
      if (response.status === 429 && detail.includes("still reading")) setRetryWait(30);
    } catch {
      setRead({ kind: "failed", message: "Reading resumes is unavailable right now. Try again in a few minutes." });
    }
  };

  const save = async () => {
    if (existing.status !== "ready") return;
    const found = validateProfile(profile);
    if (Object.keys(found).length) {
      setErrors(found);
      setAttempt((n) => n + 1);
      return;
    }
    const cleaned = cleanProfile(profile);
    setProfile(cleaned);
    setSaving(true);
    setFormError(null);
    try {
      const { data, error, response } = await api.PUT("/profile", {
        body: {
          data: cleaned,
          base_version_id: existing.baseId,
          change_summary: byHand ? "Entered during setup" : "From your resume upload",
        },
      });
      if (data) {
        void navigate("/onboarding/preferences");
        return;
      }
      if (response.status === 409) {
        setFormError(
          "Your profile was changed somewhere else. Open your profile to see the latest version.",
        );
      } else if (response.status === 422) {
        const fromApi = errorsFromApi((error as { detail?: unknown } | undefined)?.detail);
        if (Object.keys(fromApi).length) {
          setErrors(fromApi);
          setAttempt((n) => n + 1);
        } else {
          setFormError("Something in your profile can't be saved. Check your entries and try again.");
        }
      } else if (response.status === 413) {
        setFormError("Your profile is too long to save. Shorten some descriptions.");
      } else if (response.status === 429) {
        setFormError("You're saving very quickly. Try again in a few minutes.");
      } else {
        setFormError("We couldn't save your profile. Try again in a moment.");
      }
    } catch {
      setFormError("We couldn't save your profile. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const replacing = existing.status === "ready" && existing.baseId !== null;
  const waiting = read.kind === "waiting" && !byHand;
  const failure = read.kind === "failed" ? readFailure(read.message) : null;
  const checks = read.kind === "done" && !byHand ? read.check : [];
  const errorList = Object.entries(errors).map(([fieldId, message]) => ({
    id: fieldId,
    label: labelOf(fieldId),
    message,
  }));

  return (
    <OnboardingLayout step={1}>
      <div className="review-layout">
        <div className="review-main">
          <h1 id="review-heading" tabIndex={-1}>
            Review your profile
          </h1>
          {read.kind === "none" && (
            <p className="home-lede">
              Add your details below. You can let Clew&apos;s AI read your resume later from
              Settings.
            </p>
          )}
          {read.kind === "done" && !byHand && (
            <p className="home-lede">
              This is what we found in your resume. Fix anything that&apos;s wrong, then continue.
            </p>
          )}
          {replacing && (
            <p className="field-hint">
              This replaces your current profile. Your old one stays in History.
            </p>
          )}

          {failure && read.kind === "failed" && (
            <div className="upload-problem" role="alert">
              <h2>{failure.title}</h2>
              <p>{read.message}</p>
              <div className="upload-actions">
                {failure.upload && (
                  <Link id={`${id}-failure-action`} to="/onboarding/upload" className="button button-secondary">
                    Upload another file
                  </Link>
                )}
                {failure.consent && (
                  <Link id={`${id}-failure-action`} to="/onboarding/upload" className="button button-secondary">
                    Turn on AI reading
                  </Link>
                )}
                {failure.retry && (
                  <button
                    id={failure.upload ? undefined : `${id}-failure-action`}
                    type="button"
                    className="button button-secondary"
                    disabled={retryWait > 0}
                    onClick={() => void tryAgain()}
                  >
                    {retryWait > 0 ? `Try again in ${retryWait}s` : "Try again"}
                  </button>
                )}
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setByHand(true);
                    focus(inputId("basics.name"));
                  }}
                >
                  Enter by hand
                </button>
              </div>
            </div>
          )}

          {waiting ? (
            <div className="review-waiting" aria-busy="true">
              <p>
                {read.status === "running"
                  ? "Reading your resume. This usually takes under a minute."
                  : "Waiting to read your resume."}
              </p>
              <div className="review-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setByHand(true);
                  focus(inputId("basics.name"));
                }}
              >
                Enter by hand instead
              </button>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {offerFill && read.kind === "done" && (
                <div className="review-offer">
                  <p>Your resume is ready. Fill in the blanks from it?</p>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setProfile((mine) => fillBlanks(mine, read.draft));
                      setOfferFill(false);
                      setStatus("Filled the empty fields from your resume.");
                    }}
                  >
                    Fill in the blanks
                  </button>
                </div>
              )}
              {errorList.length > 0 && (
                <ErrorSummary errors={errorList} attempt={attempt} onSelect={goToField} />
              )}
              {formError && (
                <p className="field-error" role="alert">
                  {formError}
                </p>
              )}
              {SECTIONS.map((section) => (
                <section key={section.id} className="review-section" aria-labelledby={`${id}-${section.id}`}>
                  <h2 id={`${id}-${section.id}`}>{section.title}</h2>
                  <SectionEditor
                    section={section.id}
                    profile={profile}
                    errors={errors}
                    openEntry={open[section.id] ?? null}
                    onOpenEntry={(index) => setOpen((current) => ({ ...current, [section.id]: index }))}
                    onChange={(next, changed) => {
                      setProfile(next);
                      if (changed && errors[changed]) {
                        setErrors(
                          Object.fromEntries(Object.entries(errors).filter(([key]) => key !== changed)),
                        );
                      }
                    }}
                    onFocus={focus}
                    onAnnounce={setStatus}
                  />
                </section>
              ))}
              <div className="review-actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={saving || existing.status !== "ready"}
                >
                  {replacing ? "Replace my profile" : "Looks good, continue"}
                </button>
                {existing.status === "error" && (
                  <p className="field-error" role="alert">
                    We couldn&apos;t check your current profile. Refresh the page to try again.
                  </p>
                )}
              </div>
            </form>
          )}
        </div>

        {checks.length > 0 && (
          <aside className="review-checks" aria-labelledby={`${id}-checks`}>
            <h2 id={`${id}-checks`}>
              {checks.length} {checks.length === 1 ? "field needs" : "fields need"} a look
            </h2>
            <ul>
              {checks.map((fieldId) => (
                <li key={fieldId}>
                  <a
                    href={`#${inputId(fieldId)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      goToField(fieldId);
                    }}
                  >
                    Check this: {labelOf(fieldId)}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      <p className="clew-sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </OnboardingLayout>
  );
}
