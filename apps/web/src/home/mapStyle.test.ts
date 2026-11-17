import { describe, expect, it } from "vitest";

import { DUSK_OPACITY, duskAt, mapStyle } from "./mapStyle";

describe("map style", () => {
  const ids = (buildings: boolean) => mapStyle({ buildings }).layers.map((layer) => layer.id);

  it("draws a real street map: water, parks, every road class with names, places and buildings", () => {
    const layers = ids(false);
    for (const id of ["water", "parks", "road-minor", "road-secondary", "road-primary", "road-motorway", "road-names", "neighborhoods", "pois", "places", "building"]) {
      expect(layers).toContain(id);
    }
    expect(layers).not.toContain("buildings-3d");
    expect(ids(true)).toContain("buildings-3d");
  });

  it("puts the dusk tint over the whole base map, so Clew's pins stay on top of it", () => {
    expect(ids(true).at(-1)).toBe("dusk");
  });

  it("only fetches from OpenFreeMap", () => {
    const style = mapStyle();
    expect(style.glyphs).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    for (const source of Object.values(style.sources)) {
      expect("url" in source && source.url).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    }
  });

  it("is dark for the US-wide swoop and clears as the map lands", () => {
    expect(duskAt(0)).toBe(DUSK_OPACITY);
    expect(duskAt(0.6)).toBe(DUSK_OPACITY);
    expect(duskAt(0.8)).toBeLessThan(DUSK_OPACITY);
    expect(duskAt(0.95)).toBe(0);
    expect(duskAt(1)).toBe(0);
  });
});
