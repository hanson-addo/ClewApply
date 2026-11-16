import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router";

import { FitScore } from "../jobs/FitScore";
import { MapArt } from "./BrandArt";
import { type JobMapState, type MapPin, milesBetween, type Point, roundPoint } from "./useJobMap";
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

/** One job, as the map's pop-up card and as a list row. */
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

/**
 * "Jobs near you": matching jobs on a map, or as a list. "Near me" asks the browser for a
 * location only when pressed, rounds it to about 1 km straight away, and uses it here in the
 * browser only, to center the map and sort the list. It is never sent, saved or logged.
 */
export function MapCard({ state }: { state: JobMapState }) {
  const [drawable] = useState(canDrawMap);
  const [view, setView] = useState<View>(drawable ? "map" : "list");
  const [near, setNear] = useState<Near>({ status: "off" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pins = useMemo(() => (state.status === "ready" ? state.pins : []), [state]);
  const nearPoint = near.status === "on" ? near.point : null;
  const listed = useMemo(() => {
    const rows = pins.map((pin) => ({
      pin,
      distance: nearPoint ? milesBetween(nearPoint, { lat: pin.lat, lng: pin.lng }) : undefined,
    }));
    if (nearPoint) rows.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return rows.slice(0, LIST_SIZE);
  }, [pins, nearPoint]);
  const selected = pins.find((pin) => pin.id === selectedId);

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

  return (
    <section className="home-card home-map" aria-labelledby="map-title">
      <div className="home-card-head">
        <h2 id="map-title">Jobs near you</h2>
        {state.status === "ready" && pins.length > 0 && drawable && (
          <div className="map-views" role="group" aria-label="Show jobs as">
            {(["map", "list"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="map-view"
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option === "map" ? "Map" : "List"}
              </button>
            ))}
          </div>
        )}
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

      {state.status === "ready" && pins.length > 0 && (
        <>
          {view === "map" ? (
            <div className="map-frame">
              <Suspense fallback={<div className="map-loading">Loading the map…</div>}>
                <JobsMapCanvas
                  pins={pins}
                  center={state.center ?? null}
                  near={nearPoint}
                  onSelect={setSelectedId}
                />
              </Suspense>
              {selected && (
                <div className="map-popup" role="group" aria-label={selected.title}>
                  <PinRow pin={selected} />
                  <button
                    type="button"
                    className="map-popup-close"
                    aria-label="Close"
                    onClick={() => setSelectedId(null)}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ) : (
            <ol className="map-list" aria-label={nearPoint ? "Closest matching jobs" : "Best matching jobs"}>
              {listed.map(({ pin, distance }) => (
                <li key={pin.id}>
                  <PinRow pin={pin} distance={distance} />
                </li>
              ))}
            </ol>
          )}

          <div className="map-foot">
            <button
              type="button"
              className="button button-secondary"
              onClick={findMe}
              disabled={near.status === "finding"}
            >
              {near.status === "on" ? "Find me again" : "Near me"}
            </button>
            <p className="map-note" role="status">
              {near.status === "off" && "Your location stays on this device."}
              {near.status === "finding" && "Finding you…"}
              {near.status === "on" &&
                (view === "map" ? "Showing jobs around you." : "Sorted by distance from you.")}
              {near.status === "denied" && "Location is off for Clew, so the map uses your saved places."}
              {near.status === "unavailable" && "We couldn't find your location. Try again later."}
            </p>
          </div>
          {state.unplaced > 0 && (
            <p className="map-unplaced">
              {state.unplaced.toLocaleString()} remote or unplaced{" "}
              {state.unplaced === 1 ? "job isn't" : "jobs aren't"} on the map.{" "}
              <Link to="/jobs">See all jobs</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
