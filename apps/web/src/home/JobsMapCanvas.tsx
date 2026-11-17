import "maplibre-gl/dist/maplibre-gl.css";

import { tokens } from "@clew/design-tokens";
import {
  AttributionControl,
  type ExpressionSpecification,
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

import { type Camera, cameraAt, type NearPin, ringAround, US_CAMERA, zoomForRadius } from "./stageMath";
import { DUSK_OPACITY, duskAt, mapStyle } from "./mapStyle";
import type { Frame } from "./useScrollExpand";
import type { MapPin, Point } from "./useJobMap";

// The bundler moves the worker file, so tell MapLibre where it ended up.
setWorkerUrl(workerUrl);

const { coral, ink } = tokens.color;
const PIN_RADIUS = 7;

export type Motion = "full" | "lite" | "none";

type PinProps = { id: string; order: number };

function pinData(pins: MapPin[]): FeatureCollection<GeoPoint, PinProps> {
  return {
    type: "FeatureCollection",
    features: pins.map((pin, order) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
      properties: { id: pin.id, order },
    })),
  };
}

function ringData(focus: Point | null, miles: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = focus
    ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ringAround(focus, miles)] }, properties: {} }]
    : [];
  return { type: "FeatureCollection", features };
}

const COLLAPSED_LAYERS = ["clusters", "cluster-count", "pins"];
const EXPANDED_LAYERS = ["ring-fill", "ring-line", "near-pins"];

type Props = {
  /** Every pin, clustered, for the small card. */
  pins: MapPin[];
  /** Pins inside the radius, nearest first, for the full map (the top pins are drawn apart). */
  near: NearPin[];
  /** The best-fitting pins inside the radius: large coral pins with a score. */
  top: NearPin[];
  /** Where the full map looks: the user's rounded location, else their saved place. */
  focus: Point | null;
  /** The user's rounded location, only ever used here in the browser. */
  here: Point | null;
  radius: number;
  expanded: boolean;
  motion: Motion;
  /** Hands the scroll stage the function it calls every frame while the map grows. */
  onDriver: (drive: ((frame: Frame) => void) | null) => void;
  onSelect: (id: string) => void;
};

/**
 * The drawn map. Loaded only when Home shows the map, so the map library never weighs down the
 * first paint. Pins are map layers and the large top pins are buttons with text set as text, so
 * no job text is ever written into the map as HTML. The card for a picked pin is React.
 */
export default function JobsMapCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(props);
  const lastT = useRef(-1);
  const shownRadius = useRef(props.radius);

  // Declared first, so the effects below always see the newest props.
  useEffect(() => {
    latest.current = props;
  });

  /** On a phone the panel covers the bottom of the open map, so the area is centred above it. */
  const openPadding = () =>
    latest.current.motion === "lite" ? { top: 0, right: 0, left: 0, bottom: 220 } : { top: 0, right: 0, left: 0, bottom: 0 };

  /** Where the camera ends up once the map fills the page. */
  const target = (): Camera => {
    const { focus, radius, motion } = latest.current;
    const pitch = motion === "none" ? 0 : motion === "lite" ? 30 : 52;
    const el = container.current;
    const shortSide = el ? Math.min(el.clientWidth, el.clientHeight) || 600 : 600;
    if (!focus) return { center: US_CAMERA.center, zoom: 3.6, pitch: Math.min(pitch, 30) };
    return { center: [focus.lng, focus.lat], zoom: zoomForRadius(radius, focus.lat, shortSide), pitch };
  };

  useEffect(() => {
    if (!container.current) return;
    const { motion, expanded } = latest.current;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const start = expanded ? target() : US_CAMERA;
    const instance = new MapLibre({
      container: container.current,
      style: mapStyle({ buildings: motion === "full" }),
      center: start.center,
      zoom: start.zoom,
      pitch: start.pitch,
      maxPitch: 60,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      // On touch, one finger scrolls the page and two move the map.
      cooperativeGestures: coarse,
    });
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
      // The small, US-wide card starts at dusk; the open map is the light street map.
      const dark = first.motion !== "none" && !first.expanded;
      instance.setPaintProperty("dusk", "background-opacity", dark ? DUSK_OPACITY : 0);
      instance.addSource("jobs", {
        type: "geojson",
        data: pinData(first.pins),
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 11,
      });
      instance.addSource("near", { type: "geojson", data: pinData(first.near) });
      instance.addSource("ring", { type: "geojson", data: ringData(first.focus, first.radius) });
      instance.addLayer({
        id: "ring-fill",
        type: "fill",
        source: "ring",
        paint: { "fill-color": coral[500], "fill-opacity": 0.08 },
      });
      instance.addLayer({
        id: "ring-line",
        type: "line",
        source: "ring",
        paint: { "line-color": coral[600], "line-width": 2, "line-opacity": 0.8, "line-dasharray": [2, 2] },
      });
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
          "circle-radius": PIN_RADIUS,
          "circle-stroke-color": ink[50],
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: "near-pins",
        type: "circle",
        source: "near",
        paint: {
          "circle-color": coral[500],
          "circle-radius": PIN_RADIUS,
          "circle-stroke-color": ink[50],
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "map",
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
        instance.easeTo({ center: [lng, lat], zoom });
      });
    });
    const pick = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (id) latest.current.onSelect(id);
    };
    instance.on("click", "pins", pick);
    instance.on("click", "near-pins", pick);
    for (const layer of ["clusters", "pins", "near-pins"]) {
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

  // The scroll stage drives the camera: the US at the start, the user's area at the end.
  const { onDriver } = props;
  useEffect(() => {
    onDriver(({ t, padding }) => {
      const instance = map.current;
      if (!instance || latest.current.motion === "none") return;
      const was = lastT.current;
      lastT.current = t;
      if (instance.getLayer("dusk")) instance.setPaintProperty("dusk", "background-opacity", duskAt(t));
      if (t <= 0) {
        // Small card: keep whatever the user has panned to, just re-centre it in the card.
        if (was > 0) instance.jumpTo({ ...US_CAMERA, padding });
        else instance.setPadding(padding);
      } else if (t >= 1) {
        if (was < 1) instance.jumpTo({ ...target(), padding: openPadding() });
      } else {
        instance.jumpTo({ ...cameraAt(t, US_CAMERA, target()), padding });
      }
    });
    return () => onDriver(null);
  }, [onDriver]);

  const { pins, near, top, focus, here, radius, expanded, motion } = props;

  useEffect(() => {
    if (loaded) map.current?.getSource<GeoJSONSource>("jobs")?.setData(pinData(pins));
  }, [loaded, pins]);

  // Small card: clusters. Full map: the ring and the nearby pins, which pop in nearest first.
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance) return;
    for (const id of COLLAPSED_LAYERS) instance.setLayoutProperty(id, "visibility", expanded ? "none" : "visible");
    for (const id of EXPANDED_LAYERS) instance.setLayoutProperty(id, "visibility", expanded ? "visible" : "none");
    instance.getSource<GeoJSONSource>("near")?.setData(pinData(near));
    if (!expanded) return;
    return popIn(instance, near.length, motion);
  }, [loaded, expanded, near, motion]);

  // The large top pins, dropped in one after another once the map is full.
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance || !expanded) return;
    const markers = top.map((pin, index) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-top-pin";
      el.style.setProperty("--drop-delay", `${300 + index * 110}ms`);
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
  }, [loaded, expanded, top]);

  // "You are here": a pulsing coral beacon at the user's rounded location.
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

  // The ring grows or shrinks to the new radius, and a full map refits to it.
  useEffect(() => {
    const instance = map.current;
    if (!loaded || !instance) return;
    const source = instance.getSource<GeoJSONSource>("ring");
    const from = shownRadius.current;
    shownRadius.current = radius;
    if (lastT.current >= 1 || motion === "none") {
      instance.easeTo({ ...target(), padding: openPadding(), duration: motion === "none" ? 0 : 900 });
    }
    if (motion === "none" || from === radius) {
      source?.setData(ringData(focus, radius));
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - began) / 450);
      const eased = 1 - (1 - k) ** 3;
      source?.setData(ringData(focus, from + (radius - from) * eased));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [loaded, focus, radius, motion]);

  return (
    <div
      ref={container}
      className="jobs-map-canvas"
      role="region"
      aria-label="Map of matching jobs. Use the list view to browse them with a keyboard."
    />
  );
}

/**
 * Pops the nearby pins in with a small overshoot, nearest first. One paint expression keyed on
 * each pin's order, updated per frame for about a second, then set back to a plain value.
 */
function popIn(instance: MapLibre, count: number, motion: Motion): () => void {
  const rest = () => {
    instance.setPaintProperty("near-pins", "circle-radius", PIN_RADIUS);
    instance.setPaintProperty("near-pins", "circle-opacity", 1);
    instance.setPaintProperty("near-pins", "circle-stroke-opacity", 1);
  };
  if (motion === "none" || count === 0) {
    rest();
    return () => {};
  }
  const stagger = Math.min(40, 900 / count);
  const length = motion === "lite" ? 280 : 460;
  const overshoot = motion === "lite" ? 1.1 : 1.5;
  const total = stagger * count + length;
  const began = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const elapsed = now - began;
    const local: ExpressionSpecification = ["-", elapsed, ["*", ["get", "order"], stagger]];
    instance.setPaintProperty("near-pins", "circle-radius", [
      "interpolate", ["linear"], local,
      0, 0,
      length * 0.55, PIN_RADIUS * overshoot,
      length * 0.8, PIN_RADIUS * 0.9,
      length, PIN_RADIUS,
    ]);
    const fade: ExpressionSpecification = ["interpolate", ["linear"], local, 0, 0, length * 0.3, 1];
    instance.setPaintProperty("near-pins", "circle-opacity", fade);
    instance.setPaintProperty("near-pins", "circle-stroke-opacity", fade);
    if (elapsed < total) frame = requestAnimationFrame(step);
    else rest();
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    rest();
  };
}
