import { tokens } from "@clew/design-tokens";
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * The map's look: a light street map in the spirit of OpenFreeMap's "Liberty" style, with real
 * colors (blue water, green parks), every road class with its name, neighborhoods, places and
 * buildings, so Clew's coral pins sit on a map people recognize. Tiles and fonts come from
 * OpenFreeMap (free, no account or key). Only map tiles are fetched from it; no user data is sent.
 *
 * The colors here describe the world, not Clew's interface, so they're map colors rather than
 * design tokens. One layer, "dusk", tints the whole map in Clew's indigo: the scroll stage keeps
 * it dark for the US-wide view and fades it out as the map lands on the user's area.
 */
export const TILE_HOST = "https://tiles.openfreemap.org";

/** Credit the tile licenses require (OpenStreetMap ODbL, OpenMapTiles), shown on the map. */
export const MAP_CREDIT =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/** How dark the dusk tint is when the map is the small, US-wide card. */
export const DUSK_OPACITY = 0.86;

const C = {
  land: "#f8f4f0",
  residential: "#ece7e1",
  park: "#d8e8c8",
  grass: "#cde3bd",
  wood: "#b9d9a0",
  sand: "#f7efc3",
  hospital: "#fde",
  school: "#eceecc",
  water: "#9ebdff",
  waterway: "#a0c8f0",
  building: "#dfdbd7",
  buildingEdge: "#cfc9c3",
  motorway: "#fc8",
  motorwayCasing: "#e9ac77",
  major: "#fea",
  majorCasing: "#e9ac77",
  street: "#ffffff",
  streetCasing: "#cfcdca",
  path: "#c8bfb4",
  rail: "#bbbbbb",
  boundary: "#9e9cab",
  label: "#333333",
  labelStrong: "#1a1a1a",
  roadLabel: "#666666",
  waterLabel: "#495e91",
  halo: "#ffffff",
};

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];
const ITALIC = ["Noto Sans Italic"];

const cls = (...classes: string[]): ExpressionSpecification => ["in", ["get", "class"], ["literal", classes]];
const notBrunnel: ExpressionSpecification = ["!", ["in", ["get", "brunnel"], ["literal", ["tunnel"]]]];

/** Width by zoom: [zoom, px] pairs, growing exponentially like real road maps. */
const width = (...stops: number[]): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.4], ["zoom"], ...stops] as ExpressionSpecification;

/** A road class drawn as a casing (edge) and a fill on top, like printed street maps. */
function road(id: string, classes: string[], fill: string, casing: string, min: number, w: number[], c: number[]): LayerSpecification[] {
  const filter: ExpressionSpecification = ["all", cls(...classes), notBrunnel];
  return [
    {
      id: `${id}-casing`,
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: min,
      filter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": casing, "line-width": width(...c) },
    },
    {
      id,
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: min,
      filter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": fill, "line-width": width(...w) },
    },
  ];
}

function fill(id: string, layer: string, filter: ExpressionSpecification | null, color: string, opacity = 1, minzoom = 0): LayerSpecification {
  return {
    id,
    type: "fill",
    source: "openmaptiles",
    "source-layer": layer,
    minzoom,
    ...(filter ? { filter } : {}),
    paint: { "fill-color": color, "fill-opacity": opacity },
  };
}

/** `buildings` adds 3D building blocks from zoom 15, where the tiles carry heights. */
export function mapStyle({ buildings = false }: { buildings?: boolean } = {}): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: "land", type: "background", paint: { "background-color": C.land } },
    fill("residential", "landuse", cls("residential", "suburb", "neighbourhood"), C.residential, 0.7),
    fill("hospital", "landuse", cls("hospital"), C.hospital, 1, 12),
    fill("school", "landuse", cls("school", "college", "university"), C.school, 1, 12),
    fill("wood", "landcover", cls("wood", "forest"), C.wood, 0.6),
    fill("grass", "landcover", cls("grass", "meadow", "park", "garden", "farmland", "scrub"), C.grass, 0.6),
    fill("sand", "landcover", cls("sand", "beach"), C.sand),
    fill("parks", "park", null, C.park, 0.9),
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": C.waterway, "line-width": width(8, 0.5, 14, 3, 18, 12) },
    },
    fill("water", "water", null, C.water),
    {
      id: "aeroway",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "aeroway",
      minzoom: 11,
      paint: { "fill-color": "#e5e4e0" },
    },
    {
      id: "paths",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 14,
      filter: cls("path", "track", "pedestrian"),
      paint: { "line-color": C.path, "line-width": width(14, 0.6, 18, 2), "line-dasharray": [2, 1.5] },
    },
    {
      id: "rail",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 10,
      filter: cls("rail", "transit"),
      paint: { "line-color": C.rail, "line-width": width(10, 0.5, 16, 2) },
    },
    ...road("road-minor", ["minor", "service"], C.street, C.streetCasing, 12, [12, 0.5, 14, 2.5, 18, 16], [12, 0.8, 14, 4, 18, 19]),
    ...road("road-secondary", ["secondary", "tertiary"], C.street, C.streetCasing, 8, [8, 0.5, 12, 2, 14, 5, 18, 24], [8, 0.8, 12, 3, 14, 7, 18, 28]),
    ...road("road-primary", ["primary", "trunk"], C.major, C.majorCasing, 5, [5, 0.6, 10, 2.2, 14, 7, 18, 30], [5, 0.9, 10, 3.4, 14, 9, 18, 34]),
    ...road("road-motorway", ["motorway"], C.motorway, C.motorwayCasing, 4, [4, 0.8, 10, 3, 14, 8, 18, 32], [4, 1.2, 10, 4.5, 14, 10, 18, 36]),
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-color": C.building,
        "fill-outline-color": C.buildingEdge,
        // Footprints at 14; where 3D blocks rise from 15, the flat fill fades out under them.
        "fill-opacity": buildings ? ["interpolate", ["linear"], ["zoom"], 14, 1, 15, 1, 15.5, 0] : 1,
      },
    },
    {
      id: "states",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": C.boundary, "line-width": width(3, 0.6, 10, 1.6), "line-dasharray": [3, 2] },
    },
    {
      id: "water-names",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      layout: { "text-field": NAME, "text-font": ITALIC, "text-size": 13, "text-max-width": 6 },
      paint: { "text-color": C.waterLabel, "text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": 1.2 },
    },
    {
      id: "road-names",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 12,
      filter: cls("motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"),
      layout: {
        "symbol-placement": "line",
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
        "text-rotation-alignment": "map",
      },
      paint: { "text-color": C.roadLabel, "text-halo-color": C.halo, "text-halo-width": 1.5 },
    },
    {
      id: "pois",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 14,
      filter: ["<=", ["coalesce", ["get", "rank"], 99], 14],
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": 11,
        "text-max-width": 8,
        "text-anchor": "top",
        "text-padding": 4,
      },
      paint: { "text-color": C.roadLabel, "text-halo-color": C.halo, "text-halo-width": 1.2 },
    },
    {
      id: "neighborhoods",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 11,
      filter: cls("suburb", "neighbourhood", "quarter", "hamlet"),
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.1,
        "text-max-width": 7,
      },
      paint: { "text-color": "#6b6460", "text-halo-color": C.halo, "text-halo-width": 1.2 },
    },
    {
      id: "places",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: cls("city", "town", "village"),
      layout: {
        "text-field": NAME,
        "text-font": ["match", ["get", "class"], "city", ["literal", BOLD], ["literal", REGULAR]],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          4, ["match", ["get", "class"], "city", 11, 9],
          10, ["match", ["get", "class"], "city", 17, "town", 14, 12],
        ],
        "text-max-width": 8,
      },
      paint: { "text-color": C.labelStrong, "text-halo-color": C.halo, "text-halo-width": 1.5 },
    },
  ];
  if (buildings) {
    layers.push({
      id: "buildings-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 15,
      paint: {
        "fill-extrusion-color": C.building,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.5, 0.9],
      },
    });
  }
  // Over the whole base map, under Clew's own pins and ring (added after the style loads).
  layers.push({
    id: "dusk",
    type: "background",
    paint: {
      "background-color": tokens.color.ink[900],
      "background-opacity": 0,
      "background-opacity-transition": { duration: 0, delay: 0 },
    },
  });

  return {
    version: 8,
    glyphs: `${TILE_HOST}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      openmaptiles: {
        type: "vector",
        url: `${TILE_HOST}/planet`,
        attribution: MAP_CREDIT,
      },
    },
    layers,
  };
}

/** The dusk tint at scroll progress `t`: dark for the swoop, clearing as the map lands. */
export function duskAt(t: number): number {
  const clear = Math.min(1, Math.max(0, (t - 0.6) / 0.35));
  return DUSK_OPACITY * (1 - clear);
}
