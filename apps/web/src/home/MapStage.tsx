import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useMediaQuery } from "../components/useMediaQuery";
import { FitScore } from "../jobs/FitScore";
import { MapArt } from "./BrandArt";
import type { Motion } from "./JobsMapCanvas";
import { DEFAULT_RADIUS, pinsWithin, RADII, type Radius, topPins } from "./stageMath";
import { useCountUp } from "./useCountUp";
import { type JobMapState, type MapPin, milesBetween, type Point, roundPoint } from "./useJobMap";
import { type Frame, useScrollExpand } from "./useScrollExpand";
import { canDrawMap } from "./webgl";

// The map library is big, so it loads only when the map is shown.
const JobsMapCanvas = lazy(() => import("./JobsMapCanvas"));

const LIST_SIZE = 8;

type View = "map" | "list";
type Near =
  | { status: "off" }
  | { status: "finding" }
  | { status: "on"; point: Point }
  | { status: "denied" }
  | { status: "unavailable" };

function miles(value: number): string {
  return value < 1 ? "Under 1 mi" : `${Math.round(value).toLocaleString()} mi`;
}

/** One job as a list row. */
function PinRow({ pin, distance }: { pin: MapPin; distance?: number }) {
  return (
    <Link to={`/jobs/${pin.id}`} className="match-row">
      <FitScore score={pin.fit_score} />
      <span className="match-text">
        <span className="match-title">{pin.title}</span>
        <span className="match-meta">
          {pin.company}
          {pin.location ? ` · ${pin.location}` : ""}
          {distance !== undefined ? ` · ${miles(distance)}` : ""}
        </span>
        {pin.unverified_board && <span className="pill pill-warning map-pill">Unverified board</span>}
      </span>
    </Link>
  );
}

/** The card that slides in for a picked pin. */
function PinCard({ pin, distance, onClose }: { pin: MapPin; distance?: number; onClose: () => void }) {
  return (
    <div className="map-pin-card" role="group" aria-label={pin.title}>
      <div className="map-pin-card-top">
        <FitScore score={pin.fit_score} />
        <button type="button" className="map-popup-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="map-pin-card-title">{pin.title}</p>
      <p className="map-pin-card-meta">
        {pin.company}
        {pin.location ? ` · ${pin.location}` : ""}
        {distance !== undefined ? ` · ${miles(distance)}` : ""}
      </p>
      {pin.unverified_board && <span className="pill pill-warning map-pill">Unverified board</span>}
      <Link to={`/jobs/${pin.id}`} className="button button-primary map-pin-card-cta">
        View and apply
      </Link>
    </div>
  );
}

/** The frosted panel over the full map: how many jobs, how far, and "near me". */
function GlassPanel({
  count,
  focus,
  near,
  radius,
  onRadius,
  onFindMe,
  hidden,
}: {
  count: number;
  focus: "here" | "saved" | null;
  near: Near;
  radius: Radius;
  onRadius: (radius: Radius) => void;
  onFindMe: () => void;
  hidden: boolean;
}) {
  const shown = useCountUp(hidden ? 0 : count);
  const noun = count === 1 ? "job" : "jobs";
  const where = focus ? `within ${radius} miles` : "on the map";
  return (
    // Hidden panels are inert, so keyboard users never tab into controls they can't see.
    <div className="map-glass" inert={hidden}>
      <p className="map-glass-eyebrow">
        {focus === "here" ? "Around you" : focus === "saved" ? "Around your saved place" : "Across the US"}
      </p>
      <p className="map-glass-count" aria-hidden="true">
        <span className="map-glass-number">{shown.toLocaleString()}</span> {noun} {where}
      </p>
      <p className="clew-sr-only" role="status">
        {count.toLocaleString()} {noun} {where}
      </p>
      {focus && (
        <div className="map-radius" role="group" aria-label="Distance">
          {RADII.map((option) => (
            <button
              key={option}
              type="button"
              className="map-radius-option"
              aria-pressed={radius === option}
              onClick={() => onRadius(option)}
            >
              {option} mi
            </button>
          ))}
        </div>
      )}
      {near.status !== "on" && (
        <button type="button" className="button button-primary map-glass-cta" onClick={onFindMe} disabled={near.status === "finding"}>
          {near.status === "finding" ? "Finding you…" : "Show jobs near me"}
        </button>
      )}
      <p className="map-glass-note" role="status">
        {(near.status === "off" || near.status === "finding") && "Your location isn't sent to Clew or saved."}
        {near.status === "on" && "Showing jobs around you. Your location stays on this device."}
        {near.status === "denied" && "Location is off for Clew, so the map uses your saved places, or the whole US."}
        {near.status === "unavailable" && "We couldn't find your location. Try again later."}
      </p>
    </div>
  );
}

/**
 * The top of Home: the intro (greeting, resume and setup) beside a "Jobs near you" card. As the
 * user scrolls, the card's map grows into a full-width section that sticks while it opens, flies
 * from the whole US down to the user's area, and drops in the pins; then it lets go and the rest
 * of Home follows. Location is asked for only on a press of "Show jobs near me" (or used straight
 * away when the browser already allows it), rounded to about 1 km at once, and used only here in
 * the browser: never sent, saved or logged.
 */
export function MapStage({ state, intro }: { state: JobMapState; intro: ReactNode }) {
  const [drawable] = useState(canDrawMap);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const phone = useMediaQuery("(max-width: 47.99rem)");
  const [view, setView] = useState<View>(drawable ? "map" : "list");
  const [near, setNear] = useState<Near>({ status: "off" });
  const [radius, setRadius] = useState<Radius>(DEFAULT_RADIUS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pins = useMemo(() => (state.status === "ready" ? state.pins : []), [state]);
  const saved = state.status === "ready" ? (state.center ?? null) : null;
  const here = near.status === "on" ? near.point : null;
  const focus = here ?? saved;

  const inRadius = useMemo(() => pinsWithin(pins, focus, radius), [pins, focus, radius]);
  const top = useMemo(() => topPins(inRadius), [inRadius]);
  const rest = useMemo(() => {
    const topIds = new Set(top.map((pin) => pin.id));
    return inRadius.filter((pin) => !topIds.has(pin.id));
  }, [inRadius, top]);

  const listed = useMemo(() => {
    const rows = pins.map((pin) => ({
      pin,
      distance: here ? milesBetween(here, { lat: pin.lat, lng: pin.lng }) : undefined,
    }));
    if (here) rows.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return rows.slice(0, LIST_SIZE);
  }, [pins, here]);
  const selected = useMemo(() => {
    const pin = pins.find((item) => item.id === selectedId);
    if (!pin) return undefined;
    return { pin, distance: here ? milesBetween(here, { lat: pin.lat, lng: pin.lng }) : undefined };
  }, [pins, selectedId, here]);

  const hasMap = state.status === "ready" && pins.length > 0 && drawable && view === "map";
  const scrolling = hasMap && !reduced;
  const motion: Motion = reduced ? "none" : phone ? "lite" : "full";

  const stage = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const driver = useRef<((frame: Frame) => void) | null>(null);
  const onDriver = useCallback((drive: ((frame: Frame) => void) | null) => {
    driver.current = drive;
  }, []);
  const { expanded: scrolledOpen, runway } = useScrollExpand(scrolling, { stage, intro: introRef, slot, sticky, win }, driver);
  const expanded = reduced ? true : scrolledOpen;

  // Escape closes the picked job's card.
  useEffect(() => {
    if (!selectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selectedId]);

  function findMe() {
    if (!("geolocation" in navigator)) {
      setNear({ status: "unavailable" });
      return;
    }
    setNear({ status: "finding" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setNear({ status: "on", point: roundPoint(coords.latitude, coords.longitude) }),
      (error) => setNear({ status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" }),
      // A coarse fix is all the map needs; never ask the device for its most precise one.
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 15000 },
    );
  }

  // Once the user has allowed location for Clew, use it without asking again. Never prompts.
  const findMeRef = useRef(findMe);
  useEffect(() => {
    findMeRef.current = findMe;
  });
  useEffect(() => {
    if (!hasMap || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") findMeRef.current();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasMap]);

  const views = state.status === "ready" && pins.length > 0 && drawable && (
    <div className="map-views" role="group" aria-label="Show jobs as">
      {(["map", "list"] as const).map((option) => (
        <button key={option} type="button" className="map-view" aria-pressed={view === option} onClick={() => setView(option)}>
          {option === "map" ? "Map" : "List"}
        </button>
      ))}
    </div>
  );

  const unplaced = state.status === "ready" && state.unplaced > 0 && (
    <p className="map-unplaced">
      {state.unplaced.toLocaleString()} remote or unplaced {state.unplaced === 1 ? "job isn't" : "jobs aren't"} on the map.{" "}
      <Link to="/jobs">See all jobs</Link>
    </p>
  );

  const mapWindow = hasMap && (
    <div ref={win} className={`map-window${expanded ? " is-expanded" : ""}`}>
      <Suspense fallback={<div className="map-loading">Loading the map…</div>}>
        <JobsMapCanvas
          pins={pins}
          near={rest}
          top={top}
          focus={focus}
          here={here}
          radius={radius}
          expanded={expanded}
          motion={motion}
          onDriver={onDriver}
          onSelect={setSelectedId}
        />
      </Suspense>
      <GlassPanel
        count={inRadius.length}
        focus={here ? "here" : saved ? "saved" : null}
        near={near}
        radius={radius}
        onRadius={setRadius}
        onFindMe={findMe}
        hidden={!expanded}
      />
      {!reduced && (
        <p className="map-scroll-hint" aria-hidden="true">
          Scroll to explore ↓
        </p>
      )}
      {selected && <PinCard pin={selected.pin} distance={selected.distance} onClose={() => setSelectedId(null)} />}
    </div>
  );

  const card = (
    <section className="home-card home-map" aria-labelledby="map-title">
      <div className="home-card-head">
        <h2 id="map-title">Jobs near you</h2>
        {views}
      </div>

      {state.status === "loading" && (
        <div className="map-frame map-loading" role="status">
          Loading the map…
        </div>
      )}
      {state.status === "error" && (
        <p role="status" className="home-note">
          We couldn&apos;t load the map just now. Refresh the page to try again.
        </p>
      )}
      {state.status === "ready" && pins.length === 0 && (
        <>
          <MapArt />
          <p className="home-empty">
            No matching jobs with a city yet. Once roles near the places you picked come in,
            they&apos;ll show up here.
          </p>
        </>
      )}

      {hasMap && !reduced && (
        <div ref={slot} className="map-frame map-slot" />
      )}
      {hasMap && reduced && <p className="home-note">The map is just below.</p>}

      {state.status === "ready" && pins.length > 0 && !hasMap && (
        <>
          <ol className="map-list" aria-label={here ? "Closest matching jobs" : "Best matching jobs"}>
            {listed.map(({ pin, distance }) => (
              <li key={pin.id}>
                <PinRow pin={pin} distance={distance} />
              </li>
            ))}
          </ol>
          <div className="map-foot">
            <button type="button" className="button button-secondary" onClick={findMe} disabled={near.status === "finding"}>
              {near.status === "on" ? "Find me again" : "Near me"}
            </button>
            <p className="map-note" role="status">
              {near.status === "off" && "Your location isn't sent to Clew or saved."}
              {near.status === "finding" && "Finding you…"}
              {near.status === "on" && "Sorted by distance from you."}
              {near.status === "denied" && "Location is off for Clew, so the map uses your saved places, or the whole US."}
              {near.status === "unavailable" && "We couldn't find your location. Try again later."}
            </p>
          </div>
        </>
      )}
      {unplaced}
    </section>
  );

  return (
    <div ref={stage} className={`map-stage${scrolling ? " is-scrolling" : ""}`}>
      <div ref={introRef} className="map-intro">
        <div className="map-intro-main">{intro}</div>
        {card}
      </div>
      {scrolling && (
        <>
          <div className="map-runway" style={{ height: runway }} aria-hidden="true" />
          <div className="map-layer">
            <div ref={sticky} className="map-sticky">
              {mapWindow}
            </div>
          </div>
        </>
      )}
      {hasMap && reduced && <div className="map-static">{mapWindow}</div>}
    </div>
  );
}
