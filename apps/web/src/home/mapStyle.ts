import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * The map's look: a quiet, muted light map in the spirit of OpenFreeMap's "Positron" style.
 * Grey streets, soft water and parks, a few place names and no shops or landmarks, so Clew's
 * coral pins are the only bold color on it. Tiles and fonts come from OpenFreeMap (free, no
 * account or key). Only map tiles are fetched from it; no user data is sent.
 *
 * The colors here describe the world, not Clew's interface, so they're map colors rather than
 * design tokens.
 */
export const TILE_HOST = "https://tiles.openfreemap.org";

/** Credit the tile licenses require (OpenStreetMap ODbL, OpenMapTiles), shown on the map. */
export const MAP_CREDIT =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

const C = {
  land: "#f2f2ef",
  residential: "#eaeae6",
  park: "#e1e8dc",
  water: "#cfd8dd",
  waterway: "#d5dde1",
  building: "#e6e5e1",
  street: "#ffffff",
  major: "#ffffff",
  casing: "#dcdcd8",
  majorCasing: "#d2d2cd",
  boundary: "#cfcbd3",
  label: "#6f6f6f",
  labelStrong: "#4a4a4a",
  halo: "#ffffff",
};

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
const REGULAR = ["Noto Sans Regular"];

const cls = (...classes: string[]): ExpressionSpecification => ["in", ["get", "class"], ["literal", classes]];
const notTunnel: ExpressionSpecification = ["!", ["in", ["get", "brunnel"], ["literal", ["tunnel"]]]];

/** Width by zoom: [zoom, px] pairs, growing exponentially like real road maps. */
const width = (...stops: number[]): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.4], ["zoom"], ...stops] as ExpressionSpecification;

/** A road class drawn as a thin grey edge with a white fill on top. */
function road(id: string, classes: string[], casing: string, min: number, w: number[], c: number[]): LayerSpecification[] {
  const filter: ExpressionSpecification = ["all", cls(...classes), notTunnel];
  const base = {
    type: "line" as const,
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: min,
    filter,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
  };
  return [
    { ...base, id: `${id}-casing`, paint: { "line-color": casing, "line-width": width(...c) } },
    { ...base, id, paint: { "line-color": C.street, "line-width": width(...w) } },
  ];
}

function fill(id: string, layer: string, filter: ExpressionSpecification | null, color: string, minzoom = 0): LayerSpecification {
  return {
    id,
    type: "fill",
    source: "openmaptiles",
    "source-layer": layer,
    minzoom,
    ...(filter ? { filter } : {}),
    paint: { "fill-color": color },
  };
}

export function mapStyle(): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: "land", type: "background", paint: { "background-color": C.land } },
    fill("residential", "landuse", cls("residential", "suburb", "neighbourhood"), C.residential),
    fill("parks", "park", null, C.park),
    fill("wood", "landcover", cls("wood", "forest", "grass", "park"), C.park),
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      minzoom: 8,
      paint: { "line-color": C.waterway, "line-width": width(8, 0.5, 14, 2, 18, 8) },
    },
    fill("water", "water", null, C.water),
    ...road("road-minor", ["minor", "service"], C.casing, 13, [13, 0.5, 15, 3, 18, 14], [13, 1, 15, 4.5, 18, 16]),
    ...road("road-secondary", ["secondary", "tertiary"], C.casing, 9, [9, 0.5, 12, 1.6, 15, 5, 18, 20], [9, 0.9, 12, 2.6, 15, 7, 18, 23]),
    ...road("road-major", ["primary", "trunk", "motorway"], C.majorCasing, 5, [5, 0.5, 10, 2, 14, 6, 18, 26], [5, 1, 10, 3.2, 14, 8, 18, 29]),
    fill("building", "building", null, C.building, 14),
    {
      id: "states",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["<=", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": C.boundary, "line-width": width(3, 0.6, 10, 1.4) },
    },
    {
      id: "road-names",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: cls("primary", "secondary", "tertiary", "minor"),
      layout: {
        "symbol-placement": "line",
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": 11,
        "text-rotation-alignment": "map",
      },
      paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 },
    },
    {
      id: "places",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: cls("city", "town"),
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          4, ["match", ["get", "class"], "city", 11, 9],
          10, ["match", ["get", "class"], "city", 15, 12],
        ],
        "text-max-width": 8,
      },
      paint: {
        "text-color": ["match", ["get", "class"], "city", C.labelStrong, C.label],
        "text-halo-color": C.halo,
        "text-halo-width": 1.5,
      },
    },
  ];

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
