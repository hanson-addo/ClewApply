/**
 * The maths behind Home's scroll-to-expand map: how far the user has scrolled through the
 * stage, where the map window sits at that point, and where the camera looks. Pure functions,
 * so they're tested without a browser.
 */
import { milesBetween, type MapPin, type Point } from "./useJobMap";

export type Box = { top: number; left: number; width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type Camera = { center: [number, number]; zoom: number; pitch: number };

export const RADII = [10, 25, 50] as const;
export type Radius = (typeof RADII)[number];
export const DEFAULT_RADIUS: Radius = 25;

/** The whole lower 48, as the small card shows it before the user scrolls. */
export const US_CAMERA: Camera = { center: [-98.5, 39.5], zoom: 3, pitch: 0 };

/** How many of the best-fitting jobs get the large coral pin with a score. */
export const TOP_PINS = 5;

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type StageLayout = {
  /** Scroll (px past the point where the stage sticks) at which the map starts to grow. */
  start: number;
  /** Scroll it takes to grow to full width. */
  distance: number;
  /** Extra space under the intro, so the map stays stuck while it grows and for a beat after. */
  runway: number;
};

/**
 * `slotTop` is where the small map card starts, measured from the top of the stage; `introHeight`
 * is the height of everything beside it; `viewHeight` is the stuck area (viewport minus header).
 * On a wide screen the card is at the top, so growing starts at once; on a phone it's further
 * down, so growing starts once the card is a quarter of the way up the screen.
 */
export function stageLayout(slotTop: number, introHeight: number, viewHeight: number): StageLayout {
  const start = Math.max(0, slotTop - viewHeight * 0.25);
  const distance = Math.max(240, viewHeight * 0.75);
  const hold = viewHeight * 0.35;
  const runway = Math.max(0, start + distance + hold + viewHeight - introHeight);
  return { start, distance, runway: Math.round(runway) };
}

/** 0 while the map is the small card, 1 once it fills the page. */
export function progressAt(scrolled: number, layout: StageLayout): number {
  return clamp01((scrolled - layout.start) / layout.distance);
}

/** The map window at progress `t`: the small card's box grown toward the full box. */
export function windowBox(slot: Box, full: Box, t: number): Box {
  const e = easeInOut(t);
  return {
    top: lerp(slot.top, full.top, e),
    left: lerp(slot.left, full.left, e),
    width: lerp(slot.width, full.width, e),
    height: lerp(slot.height, full.height, e),
  };
}

/** How far each edge of `box` sits inside `full`: what's clipped away, and the camera padding. */
export function insetsWithin(box: Box, full: Box): Insets {
  return {
    top: box.top - full.top,
    left: box.left - full.left,
    right: full.left + full.width - (box.left + box.width),
    bottom: full.top + full.height - (box.top + box.height),
  };
}

/** Camera padding must keep a visible area, so it never asks for more than the box has. */
export function cameraPadding(insets: Insets, full: Box): Insets {
  const fit = (a: number, b: number, size: number) => {
    const room = size - 40;
    const total = Math.max(0, a) + Math.max(0, b);
    const scale = total > room ? room / total : 1;
    return [Math.max(0, a) * scale, Math.max(0, b) * scale] as const;
  };
  const [top, bottom] = fit(insets.top, insets.bottom, full.height);
  const [left, right] = fit(insets.left, insets.right, full.width);
  return { top, right, bottom, left };
}

/**
 * The zoom at which a circle of `miles` fills about 70% of the shorter side of the map.
 * MapLibre draws 512px tiles: at zoom z one pixel covers 40,075,017 m × cos(lat) / (512 × 2^z).
 */
export function zoomForRadius(miles: number, lat: number, shortSide: number): number {
  const metres = miles * 1609.344 * 2;
  const scale = (40_075_016.686 * Math.cos((lat * Math.PI) / 180) * shortSide * 0.7) / (512 * metres);
  return Math.min(13, Math.max(3, Math.log2(scale)));
}

/**
 * The camera part of the way from `from` to `to`: it heads for the place first and settles the
 * zoom after, so the move reads as one swoop rather than a slide then a dive, and tilts last.
 */
export function cameraAt(t: number, from: Camera, to: Camera): Camera {
  const e = easeInOut(t);
  const glide = easeInOut(Math.min(1, t * 1.3));
  return {
    center: [lerp(from.center[0], to.center[0], glide), lerp(from.center[1], to.center[1], glide)],
    zoom: lerp(from.zoom, to.zoom, e),
    pitch: lerp(from.pitch, to.pitch, clamp01(t) ** 2),
  };
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

/**
 * The pins the full map shows: within `miles` of `focus` (all of them when there's no focus),
 * nearest first, so they drop in as a ripple from the centre.
 */
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
