/**
 * The maths behind Home's jobs map: where the camera looks, the radius ring, and which pins are
 * near. Pure functions, so they're tested without a browser.
 */
import { milesBetween, type MapPin, type Point } from "./useJobMap";

export type Camera = { center: [number, number]; zoom: number };

export const RADII = [10, 25, 50] as const;
export type Radius = (typeof RADII)[number];
export const DEFAULT_RADIUS: Radius = 25;

/** The whole lower 48, for a user with no saved place who hasn't shared their location. */
export const US_CAMERA: Camera = { center: [-98.5, 39.5], zoom: 3.6 };

/** How many of the best-fitting jobs get the large coral pin with a score. */
export const TOP_PINS = 5;

/** How far the map settles in as it appears: one gentle zoom level. */
export const SETTLE_ZOOM = 1;

/**
 * The zoom at which a circle of `miles` fills about 70% of the shorter side of the map.
 * MapLibre draws 512px tiles: at zoom z one pixel covers 40,075,017 m × cos(lat) / (512 × 2^z).
 */
export function zoomForRadius(miles: number, lat: number, shortSide: number): number {
  const metres = miles * 1609.344 * 2;
  const scale = (40_075_016.686 * Math.cos((lat * Math.PI) / 180) * shortSide * 0.7) / (512 * metres);
  return Math.min(13, Math.max(3, Math.log2(scale)));
}

/** Where the map looks: the radius around `focus`, or the whole US with no focus. */
export function cameraFor(focus: Point | null, miles: number, shortSide: number): Camera {
  if (!focus) return US_CAMERA;
  return { center: [focus.lng, focus.lat], zoom: zoomForRadius(miles, focus.lat, shortSide) };
}

/** A ring of `miles` around `center`, as a closed list of [lng, lat] points. */
export function ringAround(center: Point, miles: number, steps = 72): [number, number][] {
  const latPerMile = 1 / 69.0;
  const lngPerMile = 1 / (69.172 * Math.cos((center.lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + Math.cos(angle) * miles * lngPerMile, center.lat + Math.sin(angle) * miles * latPerMile]);
  }
  return ring;
}

export type NearPin = MapPin & { miles: number | null };

/** The pins within `miles` of `focus` (all of them when there's no focus), nearest first. */
export function pinsWithin(pins: MapPin[], focus: Point | null, miles: number): NearPin[] {
  if (!focus) return pins.map((pin) => ({ ...pin, miles: null }));
  return pins
    .map((pin) => ({ ...pin, miles: milesBetween(focus, { lat: pin.lat, lng: pin.lng }) }))
    .filter((pin) => pin.miles <= miles)
    .sort((a, b) => a.miles - b.miles);
}

/** The best-fitting pins, which get the large coral pin and score badge. */
export function topPins<T extends MapPin>(pins: T[], count = TOP_PINS): T[] {
  return [...pins].sort((a, b) => b.fit_score - a.fit_score || a.id.localeCompare(b.id)).slice(0, count);
}

export type Nearest = { miles: number; count: number };

/**
 * For an empty radius: how far the nearest jobs are, and how many sit about that far (within
 * 10 miles, or 10%, of the nearest one). Null with no focus or no pins at all.
 */
export function nearestOutside(pins: MapPin[], focus: Point | null): Nearest | null {
  if (!focus || pins.length === 0) return null;
  const distances = pins.map((pin) => milesBetween(focus, { lat: pin.lat, lng: pin.lng })).sort((a, b) => a - b);
  const closest = distances[0] ?? 0;
  const reach = closest + Math.max(10, closest * 0.1);
  return { miles: closest, count: distances.filter((d) => d <= reach).length };
}

/** A friendly rounded distance: "about 80 miles", "about 1,200 miles". */
export function aboutMiles(miles: number): string {
  const step = miles < 20 ? 1 : miles < 200 ? 5 : 50;
  return `about ${(Math.round(miles / step) * step).toLocaleString()} miles`;
}
