import { tokens } from "@clew/design-tokens";
import type { StyleSpecification } from "maplibre-gl";

/**
 * The map's look, in brand colors: an indigo land, deeper water, quiet roads and state lines.
 * Tiles and fonts come from OpenFreeMap (free, no account or key). Only map tiles are fetched
 * from it; no user data is sent.
 */
export const TILE_HOST = "https://tiles.openfreemap.org";

/** Credit the tile licenses require (OpenStreetMap ODbL, OpenMapTiles), shown on the map. */
export const MAP_CREDIT =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const ink = tokens.color.ink;

export function mapStyle(): StyleSpecification {
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
    layers: [
      { id: "land", type: "background", paint: { "background-color": ink[800] } },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": ink[900] },
      },
      {
        id: "parks",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": ink[700], "fill-opacity": 0.35 },
      },
      {
        id: "roads",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: {
          "line-color": ink[700],
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 12, 2.5],
        },
      },
      {
        id: "states",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 4],
        paint: { "line-color": ink[500], "line-width": 1, "line-dasharray": [2, 2] },
      },
      {
        id: "places",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": ["get", "name:latin"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 13],
        },
        paint: { "text-color": ink[300], "text-halo-color": ink[900], "text-halo-width": 1 },
      },
    ],
  };
}
