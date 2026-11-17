import { describe, expect, it } from "vitest";

import {
  cameraAt,
  cameraPadding,
  easeInOut,
  insetsWithin,
  pinsWithin,
  progressAt,
  ringAround,
  stageLayout,
  topPins,
  US_CAMERA,
  windowBox,
  zoomForRadius,
} from "./stageMath";
import { milesBetween, type MapPin } from "./useJobMap";

const pin = (id: string, lat: number, lng: number, fit_score: number): MapPin => ({
  id,
  title: "Thread Analyst",
  company: "Labyrinth Logistics",
  location: null,
  lat,
  lng,
  fit_score,
  unverified_board: false,
});

describe("stage layout", () => {
  it("starts growing at once when the card is at the top, and later when it's further down", () => {
    expect(stageLayout(0, 900, 800).start).toBe(0);
    expect(stageLayout(1000, 1400, 800).start).toBe(800);
  });

  it("leaves enough runway to grow, hold, then let go", () => {
    const layout = stageLayout(0, 900, 800);
    // Stuck while the stage is taller than the view: grow (600) + hold (280) of scrolling.
    expect(900 + layout.runway - 800).toBe(layout.start + layout.distance + 280);
  });

  it("goes from 0 to 1 over the growing distance, and stays inside it", () => {
    const layout = stageLayout(0, 900, 800);
    expect(progressAt(-50, layout)).toBe(0);
    expect(progressAt(layout.distance / 2, layout)).toBeCloseTo(0.5);
    expect(progressAt(layout.distance * 3, layout)).toBe(1);
  });
});

describe("map window", () => {
  const full = { top: 64, left: 0, width: 1200, height: 736 };
  const slot = { top: 120, left: 760, width: 400, height: 300 };

  it("is the card at the start and the whole area at the end", () => {
    expect(windowBox(slot, full, 0)).toEqual(slot);
    expect(windowBox(slot, full, 1)).toEqual(full);
  });

  it("turns into clip insets, and padding that always leaves room to see", () => {
    const insets = insetsWithin(slot, full);
    expect(insets).toEqual({ top: 56, left: 760, right: 40, bottom: 380 });
    // A card scrolled past the bottom still leaves a visible area for the camera.
    const padding = cameraPadding({ top: 900, left: 0, right: 0, bottom: -100 }, full);
    expect(padding.top).toBeLessThanOrEqual(full.height - 40);
    expect(padding.bottom).toBe(0);
  });

  it("eases in and out", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });
});

describe("camera", () => {
  const austin = { center: [-97.74, 30.27] as [number, number], zoom: 9.5, pitch: 52 };

  it("flies from the US to the user's area, tilting last", () => {
    expect(cameraAt(0, US_CAMERA, austin)).toEqual(US_CAMERA);
    expect(cameraAt(1, US_CAMERA, austin)).toEqual(austin);
    const mid = cameraAt(0.5, US_CAMERA, austin);
    // Most of the way there before it's most of the way down.
    const travelled = (mid.center[0] - US_CAMERA.center[0]) / (austin.center[0] - US_CAMERA.center[0]);
    const zoomed = (mid.zoom - US_CAMERA.zoom) / (austin.zoom - US_CAMERA.zoom);
    expect(travelled).toBeGreaterThan(zoomed);
    expect(mid.pitch).toBeLessThan(austin.pitch / 2);
  });

  it("zooms out for a wider radius", () => {
    const ten = zoomForRadius(10, 30.27, 700);
    const fifty = zoomForRadius(50, 30.27, 700);
    expect(ten).toBeGreaterThan(fifty);
    expect(ten - fifty).toBeCloseTo(Math.log2(5));
    expect(zoomForRadius(25, 30.27, 700)).toBeGreaterThan(7);
    expect(zoomForRadius(25, 30.27, 700)).toBeLessThan(11);
  });
});

describe("pins and ring", () => {
  const austin = { lat: 30.27, lng: -97.74 };
  const pins = [
    pin("a", 30.4, -97.7, 70),
    pin("b", 30.27, -97.74, 90),
    pin("c", 32.78, -96.8, 99), // Dallas, far outside 25 miles.
  ];

  it("keeps pins inside the radius, nearest first", () => {
    expect(pinsWithin(pins, austin, 25).map((p) => p.id)).toEqual(["b", "a"]);
    expect(pinsWithin(pins, null, 25).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("picks the best fits for the large pins", () => {
    expect(topPins(pins, 2).map((p) => p.id)).toEqual(["c", "b"]);
  });

  it("draws the ring the right size, closed", () => {
    const ring = ringAround(austin, 25);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring.slice(0, 10)) {
      expect(milesBetween(austin, { lat, lng })).toBeCloseTo(25, 0);
    }
  });
});
