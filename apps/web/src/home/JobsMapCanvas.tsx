import "maplibre-gl/dist/maplibre-gl.css";

import { tokens } from "@clew/design-tokens";
import {
  AttributionControl,
  type GeoJSONSource,
  Map as MapLibre,
  type MapLayerMouseEvent,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Feature, FeatureCollection, Point as GeoPoint, Polygon } from "geojson";
import { useEffect, useRef, useState } from "react";

import { mapStyle } from "./mapStyle";
import { type Camera, cameraFor, type NearPin, ringAround, SETTLE_ZOOM } from "./stageMath";
import type { MapPin, Point } from "./useJobMap";

// The bundler moves the worker file, so tell MapLibre where it ended up.
setWorkerUrl(workerUrl);

const { coral, ink } = tokens.color;
const FADE_MS = 500;
const SETTLE_MS = 1000;
const PIN_LAYERS = ["clusters", "cluster-count", "pins"] as const;

function pinData(pins: MapPin[]): FeatureCollection<GeoPoint, { id: string }> {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
      properties: { id: pin.id },
    })),
  };
}

function ringData(focus: Point | null, miles: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = focus
    ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ringAround(focus, miles)] }, properties: {} }]
    : [];
  return { type: "FeatureCollection", features };
}

type Props = {
  /** Every placed pin, clustered where they're dense. */
  pins: MapPin[];
  /** The best-fitting pins inside the radius: large coral pins with a score. */
  top: NearPin[];
  /** Where the map looks: the user's rounded location, else their saved place. */
  focus: Point | null;
  /** The user's rounded location, only ever used here in the browser. */
  here: Point | null;
  radius: number;
  /** True once the map has scrolled into view: pins fade in and the camera settles, once. */
  revealed: boolean;
  /** No fades or camera moves. */
  still: boolean;
  /** On a phone the panel covers the bottom of the map, so the area is centred above it. */
  phone: boolean;
  onSelect: (id: string) => void;
};

/** On a phone the panel covers the bottom of the map, so the area is centred above it. */
const paddingFor = (phone: boolean) => ({ top: 0, right: 0, left: 0, bottom: phone ? 220 : 0 });

/** Where the map looks, for the map's current size. */
function cameraOf(el: HTMLElement | null, { focus, radius, phone }: Pick<Props, "focus" | "radius" | "phone">): Camera {
  const shortSide = el ? Math.min(el.clientWidth, el.clientHeight - paddingFor(phone).bottom) || 600 : 600;
  return cameraFor(focus, radius, shortSide);
}

/**
 * The drawn map. Loaded only when Home shows the map, so the map library never weighs down the
 * first paint. It's built once at its full size and never resized or driven per frame: the page
 * reveals it with a CSS fade, and the map itself only fades its pins in and settles one zoom
 * level, both on the GPU. Pins are map layers and the large top pins are buttons with text set
 * as text, so no job text is ever written into the map as HTML. The card for a picked pin is React.
 */
export default function JobsMapCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(props);

  // Declared first, so the effects below always see the newest props.
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    if (!container.current) return;
    const { still, revealed } = latest.current;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const end = cameraOf(container.current, latest.current);
    // Until it's revealed, the map waits one zoom level out, then settles in.
    const start = still || revealed ? end : { ...end, zoom: end.zoom - SETTLE_ZOOM };
    const instance = new MapLibre({
      container: container.current,
      style: mapStyle(),
      center: start.center,
      zoom: start.zoom,
      maxPitch: 0,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      // On touch, one finger scrolls the page and two move the map.
      cooperativeGestures: coarse,
    });
    instance.jumpTo({ ...start, padding: paddingFor(latest.current.phone) });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new AttributionControl({ compact: true }), "bottom-right");

    // With a mouse, the wheel scrolls the page until the user clicks into the map.
    const canvas = instance.getCanvasContainer();
    const wake = () => instance.scrollZoom.enable();
    const sleep = () => instance.scrollZoom.disable();
    if (!coarse) {
      sleep();
      canvas.addEventListener("click", wake);
      canvas.addEventListener("mouseleave", sleep);
    }

    instance.on("load", () => {
      const first = latest.current;
      const hidden = !first.still && !first.revealed;
      // Pins start see-through and fade in together when the map is revealed.
      const fade = { duration: first.still ? 0 : FADE_MS, delay: 0 };
      const opacity = hidden ? 0 : 1;
      instance.addSource("jobs", {
        type: "geojson",
        data: pinData(first.pins),
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 11,
      });
      instance.addSource("ring", { type: "geojson", data: ringData(first.focus, first.radius) });
      instance.addLayer({
        id: "ring-fill",
        type: "fill",
        source: "ring",
        paint: { "fill-color": coral[500], "fill-opacity": 0.06 },
      });
      instance.addLayer({
        id: "ring-line",
        type: "line",
        source: "ring",
        paint: { "line-color": coral[600], "line-width": 1.5, "line-opacity": 0.6 },
      });
      instance.addLayer({
        id: "clusters",
        type: "circle",
        source: "jobs",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": coral[500],
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 24],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": opacity,
          "circle-opacity-transition": fade,
          "circle-stroke-opacity": opacity,
          "circle-stroke-opacity-transition": fade,
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
          "text-size": 12,
        },
        paint: { "text-color": ink[900], "text-opacity": opacity, "text-opacity-transition": fade },
      });
      instance.addLayer({
        id: "pins",
        type: "circle",
        source: "jobs",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": coral[500],
          "circle-radius": 6,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": opacity,
          "circle-opacity-transition": fade,
          "circle-stroke-opacity": opacity,
          "circle-stroke-opacity-transition": fade,
        },
      });
      setLoaded(true);
    });

    instance.on("click", "clusters", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      const source = instance.getSource<GeoJSONSource>("jobs");
      if (!feature || clusterId === undefined || !source || feature.geometry.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates;
      if (lng === undefined || lat === undefined) return;
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        instance.easeTo({ center: [lng, lat], zoom, duration: latest.current.still ? 0 : 500 });
      });
    });
    instance.on("click", "pins", (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (id) latest.current.onSelect(id);
    });
    for (const layer of ["clusters", "pins"]) {
      instance.on("mouseenter", layer, () => (instance.getCanvas().style.cursor = "pointer"));
      instance.on("mouseleave", layer, () => (instance.getCanvas().style.cursor = ""));
    }

    map.current = instance;
    return () => {
      canvas.removeEventListener("click", wake);
      canvas.removeEventListener("mouseleave", sleep);
      instance.remove();
      map.current = null;
      setLoaded(false);
    };
    // Built once; the effects below move it or swap its data instead of rebuilding it.
  }, []);

  const { pins, top, focus, here, radius, revealed, still, phone } = props;

  // Revealed: the pins fade in together and the camera settles one zoom level, once.
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance || !revealed || still) return;
    for (const layer of PIN_LAYERS) {
      const prop = layer === "cluster-count" ? "text-opacity" : "circle-opacity";
      instance.setPaintProperty(layer, prop, 1);
      if (layer !== "cluster-count") instance.setPaintProperty(layer, "circle-stroke-opacity", 1);
    }
    instance.easeTo({ ...cameraOf(container.current, latest.current), padding: paddingFor(latest.current.phone), duration: SETTLE_MS });
  }, [loaded, revealed, still]);

  useEffect(() => {
    if (loaded) map.current?.getSource<GeoJSONSource>("jobs")?.setData(pinData(pins));
  }, [loaded, pins]);

  // A new place or radius: redraw the ring and ease over to it.
  const first = useRef(true);
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance) return;
    instance.getSource<GeoJSONSource>("ring")?.setData(ringData(focus, radius));
    if (first.current) {
      first.current = false;
      return;
    }
    instance.easeTo({ ...cameraOf(container.current, latest.current), padding: paddingFor(phone), duration: still ? 0 : 700 });
  }, [loaded, focus, radius, phone, still]);

  // The large top pins, which fade in with the rest once the map is revealed.
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance) return;
    const markers = top.map((pin) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-top-pin";
      el.setAttribute("aria-label", `${pin.title} at ${pin.company}, fit ${pin.fit_score}`);
      const badge = document.createElement("span");
      badge.className = "map-top-pin-score";
      badge.textContent = String(pin.fit_score);
      el.append(badge);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        latest.current.onSelect(pin.id);
      });
      return new Marker({ element: el, anchor: "bottom" }).setLngLat([pin.lng, pin.lat]).addTo(instance);
    });
    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [loaded, top]);

  // "You are here": a small coral dot at the user's rounded location.
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance || !here) return;
    const el = document.createElement("div");
    el.className = "map-beacon";
    el.setAttribute("aria-hidden", "true");
    const marker = new Marker({ element: el }).setLngLat([here.lng, here.lat]).addTo(instance);
    return () => {
      marker.remove();
    };
  }, [loaded, here]);

  return (
    <div
      ref={container}
      className="jobs-map-canvas"
      role="region"
      aria-label="Map of matching jobs. Use the list view to browse them with a keyboard."
    />
  );
}
