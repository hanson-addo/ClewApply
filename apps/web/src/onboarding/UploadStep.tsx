import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router";

import { useApi } from "../auth/useApi";
import { shortDate } from "../applications/model";
import { OnboardingLayout } from "./Layout";
import {
  checkFile,
  NETWORK,
  rememberResume,
  sectionsFound,
  uploadProblem,
  type Consent,
  type UploadProblem,
} from "./model";
import { usePollParse } from "./useParse";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; name: string; size: string; reading: boolean }
  | { kind: "reading"; name: string; size: string; resumeId: string }
  | { kind: "saved"; name: string; size: string; resumeId: string }
  | { kind: "done"; name: string; size: string; resumeId: string; sections: number }
  | { kind: "error"; problem: UploadProblem };

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Onboarding step 1: the consent box, then the resume upload (docs/design/screens.md,
 *  "Resume upload"). Reading with AI happens only after the box is ticked (#75). */
export function UploadStep() {
  const api = useApi();
  const navigate = useNavigate();
  const id = useId();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);
  // An element to focus once the next render has put it on the page.
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    document.title = "Upload your resume · Clew";
  }, []);

  useEffect(() => {
    if (!focusNext.current) return;
    const element = document.getElementById(focusNext.current);
    if (element) {
      element.focus();
      focusNext.current = null;
    }
  });

  const [consentLoad, setConsentLoad] = useState<"loading" | "failed" | "ready">("loading");
  const [consentTry, setConsentTry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/me/ai-consent")
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setConsent(data);
        setConsentLoad(data ? "ready" : "failed");
      })
      .catch(() => {
        if (!cancelled) setConsentLoad("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [api, consentTry]);

  const agreed = consent?.agreed ?? false;

  usePollParse(api, phase.kind === "reading" ? phase.resumeId : null, phase.kind === "reading", (parse) => {
    if (phase.kind !== "reading") return;
    if (parse?.status === "done" && parse.result) {
      const sections = sectionsFound(parse.result.profile);
      setPhase({ ...phase, kind: "done", sections });
      setStatus(`Done. We found ${sections} ${sections === 1 ? "section" : "sections"} in your resume.`);
      focusNext.current = `${id}-review`;
    } else if (parse === null || parse.status === "failed" || parse.status === "done") {
      // The review step shows what went wrong and what to do next.
      void navigate(`/onboarding/review?resume=${phase.resumeId}`);
    }
  });

  const setAgreement = async (agree: boolean) => {
    setConsentBusy(true);
    setConsentError(null);
    try {
      const { data } = await api.PUT("/me/ai-consent", {
        body: { agreed: agree, policy_version: consent?.policy_version ?? "" },
      });
      if (data) setConsent(data);
      else setConsentError("We couldn't save that. Try again.");
    } catch {
      setConsentError("We couldn't save that. Check your connection and try again.");
    } finally {
      setConsentBusy(false);
    }
  };

  const send = async (file: File) => {
    lastFile.current = file;
    const early = checkFile(file);
    if (early) return fail(early);
    const name = file.name;
    const size = sizeText(file.size);
    setPhase({ kind: "sending", name, size, reading: agreed });
    setStatus("Uploading and checking for viruses. This usually takes under 30 seconds.");
    try {
      const { data, response } = await api.POST("/resumes", {
        body: { file: file as unknown as string },
        bodySerializer: (body) => {
          const form = new FormData();
          form.append("file", body.file as unknown as Blob, name);
          return form;
        },
      });
      if (!data) return fail(uploadProblem(response.status));
      rememberResume(data.id);
      if (data.reading) {
        setPhase({ kind: "reading", name, size, resumeId: data.id });
        setStatus("Reading your resume. This usually takes under a minute.");
      } else {
        setPhase({ kind: "saved", name, size, resumeId: data.id });
        setStatus("Your resume is saved.");
        focusNext.current = `${id}-consent`;
      }
    } catch {
      fail(NETWORK);
    }
  };

  const fail = (problem: UploadProblem) => {
    setPhase({ kind: "error", problem });
    setStatus("");
    focusNext.current = `${id}-error-action`;
  };

  const readNow = async (resumeId: string, name: string, size: string) => {
    try {
      const { data, error } = await api.POST("/resumes/{resume_id}/parse", {
        params: { path: { resume_id: resumeId } },
      });
      if (data) {
        setReadError(null);
        setPhase({ kind: "reading", name, size, resumeId });
        setStatus("Reading your resume. This usually takes under a minute.");
        return;
      }
      // 409 (not checked for viruses yet) and 429 (busy or daily limit) carry a message
      // written for the user.
      const detail = (error as { detail?: unknown } | undefined)?.detail;
      setReadError(typeof detail === "string" && detail ? detail : "We couldn't start reading it. Try again.");
    } catch {
      setReadError("We couldn't start reading it. Check your connection and try again.");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && phase.kind !== "sending" && phase.kind !== "reading") void send(file);
  };

  const busy = phase.kind === "sending" || phase.kind === "reading";
  const reads = phase.kind === "sending" ? phase.reading : phase.kind !== "saved";

  const consentBox = (
    <div className="upload-consent">
      <label className="field-check" htmlFor={`${id}-consent`}>
        <input
          id={`${id}-consent`}
          type="checkbox"
          checked={agreed}
          disabled={consentBusy || busy || consent === null}
          aria-describedby={`${id}-consent-text`}
          onChange={(event) => void setAgreement(event.target.checked)}
        />
        Let Clew&apos;s AI read my resume and fill in my profile.
      </label>
      <p id={`${id}-consent-text`} className="field-hint upload-consent-text">
        Clew uses Anthropic&apos;s AI to read your resume and fill in your profile. Anthropic
        doesn&apos;t use it to train its models and deletes it within 30 days, unless it&apos;s
        flagged under Anthropic&apos;s usage policies or the law requires keeping it longer.{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          Privacy policy<span className="clew-sr-only">, opens in a new tab</span>
        </a>
      </p>
      {consent?.agreed && consent.agreed_at && (
        <p className="field-hint">
          You agreed on {shortDate(consent.agreed_at)}. Unticking stops future reads. A resume
          already sent to the AI can&apos;t be recalled.
        </p>
      )}
      {consent && !consent.agreed && consent.agreed_policy_version && (
        <p className="field-hint">Our privacy policy changed. Please read it and tick again.</p>
      )}
      {consentLoad === "failed" && (
        <p className="field-error" role="alert">
          We couldn&apos;t load this setting.{" "}
          <button type="button" className="button button-ghost" onClick={() => {
              setConsentLoad("loading");
              setConsentTry((n) => n + 1);
            }}>
            Try again
          </button>
        </p>
      )}
      {consentError && (
        <p className="field-error" role="alert">
          {consentError}
        </p>
      )}
    </div>
  );

  return (
    <OnboardingLayout step={0}>
      <div className="upload-layout">
        <div className="upload-intro">
          <h1>Add your resume</h1>
          <p className="home-lede">
            Clew builds your profile from it, so you don&apos;t type it all again.
          </p>
          <ul className="upload-points">
            <li>Every file is checked for viruses before we keep it.</li>
            <li>Only you can open it. Download links expire after 5 minutes.</li>
            <li>
              If you agree, Anthropic&apos;s AI reads it to draft your profile. Nothing is read
              until you tick the box.
            </li>
          </ul>
        </div>

        <section className="upload-card" aria-labelledby={`${id}-card-title`}>
          <h2 id={`${id}-card-title`} className="clew-sr-only">
            Upload
          </h2>
          {consentBox}

          {(phase.kind === "idle" || phase.kind === "error") && (
            <div
              className={`upload-drop${dragging ? " upload-drop-active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <p className="upload-drop-text" aria-hidden="true">
                Drag your resume here
              </p>
              <label htmlFor={`${id}-file`} className="button button-primary upload-choose">
                {phase.kind === "error" ? "Choose another file" : "Choose a file"}
              </label>
              <input
                ref={fileInput}
                id={`${id}-file`}
                className="clew-sr-only"
                type="file"
                accept=".pdf,.docx"
                aria-describedby={`${id}-file-hint`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void send(file);
                }}
              />
              <p id={`${id}-file-hint`} className="field-hint">
                PDF or Word (.docx), up to 10 MB
              </p>
            </div>
          )}

          {phase.kind === "error" && (
            <div className="upload-problem" role="alert">
              <h3>{phase.problem.title}</h3>
              <p>{phase.problem.body}</p>
              <div className="upload-actions">
                {phase.problem.action === "retry" ? (
                  <button
                    id={`${id}-error-action`}
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      const file = lastFile.current;
                      if (file) void send(file);
                      else setPhase({ kind: "idle" });
                    }}
                  >
                    Try again
                  </button>
                ) : (
                  <button
                    id={`${id}-error-action`}
                    type="button"
                    className="button button-secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose another file
                  </button>
                )}
                {phase.problem.byHand && (
                  <Link to="/onboarding/review?manual=1" className="button button-ghost">
                    Enter it by hand
                  </Link>
                )}
              </div>
            </div>
          )}

          {phase.kind !== "idle" && phase.kind !== "error" && (
            <div className="upload-progress">
              <p className="upload-file">
                {phase.name} <span className="field-hint">({phase.size})</span>
              </p>
              <ol aria-label="Upload progress" className="upload-steps">
                <UploadStepItem label="Uploading" done={phase.kind !== "sending"} current={phase.kind === "sending"} />
                <UploadStepItem label="Checking for viruses" done={phase.kind !== "sending"} current={false} />
                {reads && (
                  <UploadStepItem
                    label="Reading your resume"
                    done={phase.kind === "done"}
                    current={phase.kind === "reading"}
                  />
                )}
              </ol>
            </div>
          )}

          {phase.kind === "done" && (
            <div className="upload-actions">
              <p>
                Done. We found {phase.sections} {phase.sections === 1 ? "section" : "sections"} in
                your resume.
              </p>
              <Link
                id={`${id}-review`}
                to={`/onboarding/review?resume=${phase.resumeId}`}
                className="button button-primary"
              >
                Review what we found
              </Link>
            </div>
          )}

          {phase.kind === "saved" && (
            <div className="upload-actions">
              <p>Your resume is saved.</p>
              <button
                type="button"
                className="button button-primary"
                disabled={!agreed}
                onClick={() => void readNow(phase.resumeId, phase.name, phase.size)}
              >
                Read my resume
              </button>
              {readError && (
                <p className="field-error" role="alert">
                  {readError}
                </p>
              )}
              <Link to={`/onboarding/review?resume=${phase.resumeId}&manual=1`} className="button button-secondary">
                Enter my details by hand
              </Link>
            </div>
          )}

          {phase.kind === "idle" && (
            <p className="upload-byhand">
              <Link to="/onboarding/review?manual=1">Enter your details by hand</Link>
            </p>
          )}

          <p className="clew-sr-only" role="status" aria-live="polite">
            {status}
          </p>
        </section>
      </div>
    </OnboardingLayout>
  );
}

function UploadStepItem({ label, done, current }: { label: string; done: boolean; current: boolean }) {
  return (
    <li
      className={`upload-step${done ? " upload-step-done" : ""}${current ? " upload-step-current" : ""}`}
      aria-current={current ? "step" : undefined}
    >
      <span className="upload-step-mark" aria-hidden="true">
        {done ? "✓" : current ? "" : "•"}
      </span>
      {label}
      {done && <span className="clew-sr-only">, done</span>}
    </li>
  );
}
