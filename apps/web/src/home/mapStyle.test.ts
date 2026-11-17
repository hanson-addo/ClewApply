import { describe, expect, it } from "vitest";

import { mapStyle } from "./mapStyle";

describe("map style", () => {
  const style = mapStyle();
  const ids = style.layers.map((layer) => layer.id);

  it("draws a quiet street map: water, parks, roads and place names", () => {
    for (const id of ["water", "parks", "road-minor", "road-secondary", "road-major", "places"]) {
      expect(ids).toContain(id);
    }
  });

  it("leaves out busy detail: no shops or landmarks, no 3D, no tint", () => {
    expect(ids).not.toContain("pois");
    expect(ids).not.toContain("buildings-3d");
    expect(ids).not.toContain("dusk");
    expect(style.layers.some((layer) => layer.type === "fill-extrusion")).toBe(false);
  });

  it("keeps the map muted, so coral pins are the only bold color", () => {
    const colors = JSON.stringify(style.layers.map((layer) => ("paint" in layer ? layer.paint : {}))).match(/#[0-9a-f]{6}/gi) ?? [];
    expect(colors.length).toBeGreaterThan(5);
    for (const hex of colors) {
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      // Max minus min channel: 0 for pure grey, up to 255 for a vivid color.
      expect(Math.max(...channels) - Math.min(...channels), hex).toBeLessThan(24);
    }
  });

  it("only fetches from OpenFreeMap", () => {
    expect(style.glyphs).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    for (const source of Object.values(style.sources)) {
      expect("url" in source && source.url).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    }
  });
});
