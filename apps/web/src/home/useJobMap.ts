import { useEffect, useState } from "react";

import type { components } from "../api/schema";
import { useApi } from "../auth/useApi";

export type JobMap = components["schemas"]["JobMap"];
export type MapPin = components["schemas"]["MapPin"];

export type JobMapState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & JobMap);

/** The pins for the Home map. Sends no location: the server uses saved preferences only. */
export function useJobMap(enabled: boolean): JobMapState {
  const api = useApi();
  const [state, setState] = useState<JobMapState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .GET("/feed/map")
      .then(({ data }) => {
        if (!cancelled) setState(data ? { status: "ready", ...data } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api, enabled]);
  return state;
}

export type Point = { lat: number; lng: number };

/** Rounded to 2 decimals (about 1 km) before it's used at all, so a precise spot never is. */
export function roundPoint(lat: number, lng: number): Point {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

/** Straight-line distance in miles. */
export function milesBetween(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
