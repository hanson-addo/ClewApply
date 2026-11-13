import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { useApi } from "../auth/useApi";
import { TextAreaField, TextField } from "../components/TextField";
import { OnboardingLayout } from "./Layout";
import { listFrom, locationText, parseLocation, rememberResume, type Preferences } from "./model";

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; saved: Preferences };

/** Onboarding step 3: what jobs to show (titles, places, remote, pay floor), then the feed. */
export function PreferencesStep() {
  const api = useApi();
  const navigate = useNavigate();
  const id = useId();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [titles, setTitles] = useState("");
  const [places, setPlaces] = useState("");
  const [remote, setRemote] = useState(true);
  const [pay, setPay] = useState("");
  const [errors, setErrors] = useState<{ pay?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Job preferences · Clew";
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/preferences")
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) return setLoaded({ status: "error" });
        setLoaded({ status: "ready", saved: data });
        setTitles((data.titles ?? []).join("\n"));
        setPlaces((data.locations ?? []).map(locationText).join("\n"));
        setRemote(data.remote_ok ?? true);
        setPay(data.salary_floor ? String(data.salary_floor) : "");
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const finish = () => {
    rememberResume(null);
    void navigate("/jobs");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loaded.status !== "ready") return;
    const digits = pay.replace(/[$,\s]/g, "");
    if (digits && !/^\d{1,7}$/.test(digits)) {
      setErrors({ pay: "Enter a yearly amount in dollars, like 90000." });
      document.getElementById(`${id}-pay`)?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const { data, response } = await api.PUT("/preferences", {
        body: {
          ...loaded.saved,
          titles: listFrom(titles, { commas: true }).slice(0, 20),
          locations: listFrom(places)
            .map(parseLocation)
            .filter((l): l is { city: string | null; region: string } => l !== null)
            .slice(0, 20),
          remote_ok: remote,
          salary_floor: digits ? Number(digits) : null,
        },
      });
      if (data) return finish();
      setErrors({
        form:
          response.status === 422
            ? "Check your places: use a US city and state, like Austin, TX, or just a state."
            : "We couldn't save your preferences. Try again in a moment.",
      });
    } catch {
      setErrors({ form: "We couldn't save your preferences. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingLayout step={2}>
      <h1>What jobs should Clew show you?</h1>
      <p className="home-lede">You can change these any time from your job feed.</p>
      {loaded.status === "loading" && <p role="status">Loading your preferences</p>}
      {loaded.status === "error" && (
        <p role="alert" className="field-error">
          We couldn&apos;t load your preferences. Refresh the page to try again.
        </p>
      )}
      {loaded.status === "ready" && (
        <form noValidate className="prefs-form" onSubmit={(event) => void submit(event)}>
          {errors.form && (
            <p className="field-error" role="alert">
              {errors.form}
            </p>
          )}
          <TextAreaField
            id={`${id}-titles`}
            label="Job titles"
            hint="One per line, for example Software Engineer"
            rows={3}
            value={titles}
            onChange={(event) => setTitles(event.target.value)}
          />
          <TextAreaField
            id={`${id}-places`}
            label="Places"
            hint="One per line: a city and state, like Austin, TX, or just a state"
            rows={3}
            value={places}
            onChange={(event) => setPlaces(event.target.value)}
          />
          <label className="field-check" htmlFor={`${id}-remote`}>
            <input
              id={`${id}-remote`}
              type="checkbox"
              checked={remote}
              onChange={(event) => setRemote(event.target.checked)}
            />
            Show remote jobs too
          </label>
          <TextField
            id={`${id}-pay`}
            label="Lowest yearly pay (optional)"
            hint="In dollars, for example 90000"
            inputMode="numeric"
            value={pay}
            error={errors.pay}
            onChange={(event) => setPay(event.target.value)}
          />
          <div className="review-actions">
            <button type="submit" className="button button-primary" disabled={saving}>
              Show my jobs
            </button>
            <Link to="/jobs" className="button button-ghost" onClick={() => rememberResume(null)}>
              Skip for now
            </Link>
          </div>
        </form>
      )}
    </OnboardingLayout>
  );
}
