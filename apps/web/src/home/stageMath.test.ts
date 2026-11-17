import { describe, expect, it } from "vitest";

import { cameraFor, pinsWithin, ringAround, topPins, US_CAMERA, zoomForRadius } from "./stageMath";
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

describe("camera", () => {
  it("opens on the user's area, or the whole US with nowhere to look", () => {
    const camera = cameraFor({ lat: 30.27, lng: -97.74 }, 25, 700);
    expect(camera.center).toEqual([-97.74, 30.27]);
    expect(camera.zoom).toBeCloseTo(zoomForRadius(25, 30.27, 700));
    expect(cameraFor(null, 25, 700)).toEqual(US_CAMERA);
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
