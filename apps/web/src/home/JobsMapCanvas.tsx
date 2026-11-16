import "maplibre-gl/dist/maplibre-gl.css";

import { tokens } from "@clew/design-tokens";
import {
  AttributionControl,
  type GeoJSONSource,
  Map as MapLibre,
  type MapLayerMouseEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import { useEffect, useRef } from "react";

import { mapStyle } from "./mapStyle";
import type { MapPin, Point } from "./useJobMap";

// The bundler moves the worker file, so tell MapLibre where it ended up.
setWorkerUrl(workerUrl);

const US_VIEW = { center: [-98.5, 39.5] as [number, number], zoom: 3 };
const CITY_ZOOM = 8;
const NEAR_ZOOM = 9;
const { coral, ink } = tokens.color;

type Collection = FeatureCollection<GeoPoint, { id: string }>;

function pinData(pins: MapPin[]): Collection {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
      properties: { id: pin.id },
    })),
  };
}

function meData(near: Point | null): Collection {
  return {
    type: "FeatureCollection",
    features: near
      ? [{ type: "Feature", geometry: { type: "Point", coordinates: [near.lng, near.lat] }, properties: { id: "me" } }]
      : [],
  };
}

type Props = {
  pins: MapPin[];
  center: Point | null;
  /** Already rounded, and only ever used here in the browser. */
  near: Point | null;
  onSelect: (id: string) => void;
};

/**
 * The drawn map: clustered coral pins on an indigo map. Loaded only when Home shows the map,
 * so the map library never weighs down the first paint. Pins are drawn as map layers, and the
 * card for a clicked pin is React (MapCard), so no job text is ever written into the map as HTML.
 */
export default function JobsMapCanvas({ pins, center, near, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const select = useRef(onSelect);
  // The map is built once; later changes move it or swap its data instead of rebuilding it.
  const latest = useRef({ pins, center, near });

  // Declared first, so the effects below always see the newest props.
  useEffect(() => {
    select.current = onSelect;
    latest.current = { pins, center, near };
  });

  useEffect(() => {
    if (!container.current) return;
    const first = latest.current;
    const view = first.center
      ? { center: [first.center.lng, first.center.lat] as [number, number], zoom: CITY_ZOOM }
      : US_VIEW;
    const instance = new MapLibre({
      container: container.current,
      style: mapStyle(),
      ...view,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: true,
    });
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new AttributionControl({ compact: true }), "bottom-right");

    instance.on("load", () => {
      instance.addSource("jobs", {
        type: "geojson",
        data: pinData(latest.current.pins),
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 11,
      });
      instance.addSource("me", { type: "geojson", data: meData(latest.current.near) });
      instance.addLayer({
        id: "clusters",
        type: "circle",
        source: "jobs",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": coral[500],
          "circle-opacity": 0.9,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
          "circle-stroke-color": coral[400],
          "circle-stroke-width": 3,
          "circle-stroke-opacity": 0.35,
        },
      });
      instance.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "jobs",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 13,
        },
        paint: { "text-color": ink[900] },
      });
      instance.addLayer({
        id: "pins",
        type: "circle",
        source: "jobs",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": coral[500],
          "circle-radius": 7,
          "circle-stroke-color": ink[50],
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: "me",
        type: "circle",
        source: "me",
        paint: {
          "circle-color": ink[50],
          "circle-radius": 6,
          "circle-stroke-color": coral[400],
          "circle-stroke-width": 3,
        },
      });
    });

    instance.on("click", "clusters", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      const source = instance.getSource<GeoJSONSource>("jobs");
      if (!feature || clusterId === undefined || !source || feature.geometry.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates;
      if (lng === undefined || lat === undefined) return;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        instance.easeTo({ center: [lng, lat], zoom });
      });
    });
    instance.on("click", "pins", (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (id) select.current(id);
    });
    for (const layer of ["clusters", "pins"]) {
      instance.on("mouseenter", layer, () => (instance.getCanvas().style.cursor = "pointer"));
      instance.on("mouseleave", layer, () => (instance.getCanvas().style.cursor = ""));
    }

    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.getSource<GeoJSONSource>("jobs")?.setData(pinData(pins));
  }, [pins]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.getSource<GeoJSONSource>("me")?.setData(meData(near));
    if (near) instance.flyTo({ center: [near.lng, near.lat], zoom: NEAR_ZOOM });
  }, [near]);

  return (
    <div
      ref={container}
      className="jobs-map-canvas"
      role="region"
      aria-label="Map of matching jobs. Use the list view to browse them with a keyboard."
    />
  );
}
