import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapStage } from "./MapStage";
import type { NearPin } from "./stageMath";
import { type JobMapState, type MapPin, milesBetween, roundPoint } from "./useJobMap";

const webgl = vi.hoisted(() => ({ ok: false }));
vi.mock("./webgl", () => ({ canDrawMap: () => webgl.ok }));

type CanvasProps = {
  pins: MapPin[];
  top: NearPin[];
  focus: { lat: number; lng: number } | null;
  here: { lat: number; lng: number } | null;
  radius: number;
  revealed: boolean;
  still: boolean;
  phone: boolean;
  onSelect: (id: string, fromKeyboard?: boolean) => void;
};

// MapLibre needs WebGL, which tests don't have. The stand-in shows what the map was given.
vi.mock("./JobsMapCanvas", () => ({
  default: (props: CanvasProps) => (
    <div data-testid="map">
      <span>{props.here ? `here ${props.here.lat},${props.here.lng}` : "no location"}</span>
      <span>{props.focus ? `focus ${props.focus.lat},${props.focus.lng}` : "no focus"}</span>
      <span>{`radius ${props.radius}`}</span>
      <span>{props.revealed ? "revealed" : "hidden"}</span>
      <span>{props.still ? "still" : "moving"}</span>
      <span>{`top ${props.top.map((pin) => pin.fit_score).join(",")}`}</span>
      {props.pins.map((pin) => (
        <button key={pin.id} type="button" onClick={(event) => props.onSelect(pin.id, event.detail === 0)}>
          pin {pin.title}
        </button>
      ))}
    </div>
  ),
}));

const AUSTIN = { lat: 30.27, lng: -97.74 };

const pin = (n: number, over: Partial<MapPin> = {}): MapPin => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  title: `Thread Analyst ${n}`,
  company: "Labyrinth Logistics",
  location: "Austin, TX",
  ...AUSTIN,
  fit_score: 90 - n,
  unverified_board: false,
  ...over,
});

const DALLAS = { location: "Dallas, TX", lat: 32.78, lng: -96.8 };

const ready = (pins: MapPin[], unplaced = 0, center: { lat: number; lng: number } | null = AUSTIN): JobMapState => ({
  status: "ready",
  center,
  pins,
  unplaced,
});

function renderStage(state: JobMapState) {
  return render(
    <MemoryRouter>
      <MapStage state={state} intro={<h1>Welcome back</h1>} />
    </MemoryRouter>,
  );
}

function stubLocation(result: { lat: number; lng: number } | { denied: true }) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
    if ("denied" in result) {
      fail?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    } else {
      ok({ coords: { latitude: result.lat, longitude: result.lng } } as GeolocationPosition);
    }
  });
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

function stubPermission(state: PermissionState) {
  const query = vi.fn(async () => ({ state }) as PermissionStatus);
  Object.defineProperty(navigator, "permissions", { value: { query }, configurable: true });
  return query;
}

/** A stand-in IntersectionObserver the test triggers by hand. */
function stubIntersection() {
  const observers: { fire: (visible: boolean) => void; disconnected: boolean }[] = [];
  class Observer {
    disconnected = false;
    constructor(private readonly callback: IntersectionObserverCallback) {
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
    fire(visible: boolean) {
      this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  return observers;
}

function preferReducedMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("MapStage", () => {
  beforeEach(() => {
    webgl.ok = false;
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "geolocation");
    Reflect.deleteProperty(navigator, "permissions");
    vi.unstubAllGlobals();
  });

  it("puts the intro above the map", () => {
    renderStage(ready([pin(1)]));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Jobs near you" })).toBeInTheDocument();
  });

  it("lists jobs, best fit first, when the browser can't draw a map", () => {
    renderStage(ready([pin(1), pin(2)], 3));
    expect(screen.queryByRole("group", { name: "Show jobs as" })).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Best matching jobs" });
    const links = within(list).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", `/jobs/${pin(1).id}`);
    expect(links).toHaveLength(2);
    expect(screen.getByText(/3 more are remote or have no address/)).toBeInTheDocument();
  });

  it("labels jobs from unverified boards", () => {
    renderStage(ready([pin(1, { unverified_board: true })]));
    expect(screen.getByText("Unverified board")).toBeInTheDocument();
  });

  it("waits out of view, then reveals the map once as it scrolls in", async () => {
    webgl.ok = true;
    const observers = stubIntersection();
    renderStage(ready([pin(1), pin(2)]));
    expect(await screen.findByText("hidden")).toBeInTheDocument();
    expect(screen.getByText("moving")).toBeInTheDocument();
    expect(document.querySelector(".map-window")).not.toHaveClass("is-revealed");
    // No scroll-driven stage: no runway, no sticky layer, no scroll hint.
    expect(document.querySelector(".map-runway, .map-sticky")).not.toBeInTheDocument();
    expect(screen.queryByText(/Scroll to explore/)).not.toBeInTheDocument();

    act(() => observers[0]?.fire(true));
    expect(screen.getByText("revealed")).toBeInTheDocument();
    expect(document.querySelector(".map-window")).toHaveClass("is-revealed");
    expect(observers[0]?.disconnected).toBe(true);
  });

  it("counts jobs inside the radius around the saved place, and refilters when it changes", async () => {
    webgl.ok = true;
    // Two in Austin, one in Dallas (about 182 miles away).
    renderStage(ready([pin(1), pin(2), pin(3, DALLAS)]));
    expect(await screen.findByText("focus 30.27,-97.74")).toBeInTheDocument();
    expect(screen.getByText("Around your saved place")).toBeInTheDocument();
    expect(screen.getByText("2 jobs within 25 miles", { selector: ".clew-sr-only" })).toBeInTheDocument();
    expect(screen.getByText("top 89,88")).toBeInTheDocument();

    const distance = screen.getByRole("group", { name: "Distance" });
    expect(within(distance).getByRole("button", { name: "25 mi" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(distance).getByRole("button", { name: "50 mi" }));
    expect(screen.getByText("radius 50")).toBeInTheDocument();
    expect(screen.getByText("2 jobs within 50 miles", { selector: ".clew-sr-only" })).toBeInTheDocument();
  });

  it("says plainly when nothing is inside the radius, how far the nearest jobs are, and offers to widen", async () => {
    webgl.ok = true;
    // Saved place Austin; the only jobs are in Dallas, about 182 miles away.
    renderStage(ready([pin(1, DALLAS), pin(2, DALLAS), pin(3, DALLAS)], 2));
    expect(await screen.findByText("No matching jobs within 25 miles yet.")).toBeInTheDocument();
    expect(screen.getByText("Nearest: 3 jobs about 180 miles away.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Widen to 50 mi" }));
    expect(screen.getByText("radius 50")).toBeInTheDocument();
    expect(screen.getByText("No matching jobs within 50 miles yet.")).toBeInTheDocument();
    // Already at the widest: no button.
    expect(screen.queryByRole("button", { name: /Widen to/ })).not.toBeInTheDocument();
    expect(screen.getByText(/2 more are remote or have no address/)).toBeInTheDocument();
  });

  it("gives the five best fits the large pins and still draws every pin", async () => {
    webgl.ok = true;
    renderStage(ready([1, 2, 3, 4, 5, 6, 7].map((n) => pin(n))));
    expect(await screen.findByText("top 89,88,87,86,85")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^pin / })).toHaveLength(7);
  });

  it("shows the whole US when there's no saved place or location", async () => {
    webgl.ok = true;
    renderStage(ready([pin(1), pin(3, DALLAS)], 0, null));
    expect(await screen.findByText("no focus")).toBeInTheDocument();
    expect(screen.getByText("Across the US")).toBeInTheDocument();
    expect(screen.getByText("2 jobs on the map", { selector: ".clew-sr-only" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Distance" })).not.toBeInTheDocument();
  });

  it("slides in a card for the pin you pick, with the fit and a way to apply", async () => {
    webgl.ok = true;
    renderStage(ready([pin(1), pin(2, { unverified_board: true })]));
    fireEvent.click(await screen.findByRole("button", { name: "pin Thread Analyst 2" }));
    const card = screen.getByRole("group", { name: "Thread Analyst 2" });
    expect(within(card).getByRole("link", { name: "View and apply" })).toHaveAttribute("href", `/jobs/${pin(2).id}`);
    expect(within(card).getByText("Unverified board")).toBeInTheDocument();
    expect(within(card).getByText(/Labyrinth Logistics · Austin, TX/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("group", { name: "Thread Analyst 2" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "pin Thread Analyst 1" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Thread Analyst 1" })).not.toBeInTheDocument();
  });

  it("moves focus into the card when a pin is picked from the keyboard, and back on Escape", async () => {
    webgl.ok = true;
    renderStage(ready([pin(1), pin(2)]));
    const pinButton = await screen.findByRole("button", { name: "pin Thread Analyst 2" });
    pinButton.focus();
    fireEvent.click(pinButton, { detail: 0 });
    expect(screen.getByRole("group", { name: "Thread Analyst 2" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Thread Analyst 2" })).not.toBeInTheDocument();
    expect(pinButton).toHaveFocus();
  });

  it("leaves focus alone when a pin is picked with the mouse", async () => {
    webgl.ok = true;
    renderStage(ready([pin(1), pin(2)]));
    fireEvent.click(await screen.findByRole("button", { name: "pin Thread Analyst 2" }), { detail: 1 });
    expect(screen.getByRole("group", { name: "Thread Analyst 2" })).not.toHaveFocus();
  });

  it("switches to the list, which drops the map", async () => {
    webgl.ok = true;
    renderStage(ready([pin(1), pin(2)]));
    await screen.findByTestId("map");
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Best matching jobs" })).toBeInTheDocument();
  });

  it("asks for location only on a press, rounds it, and centres on it", async () => {
    webgl.ok = true;
    const ask = stubLocation({ lat: 30.123456, lng: -97.987654 });
    stubPermission("prompt");
    renderStage(ready([pin(1)]));
    await screen.findByTestId("map");
    await act(async () => {});
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByText("Your location isn't sent to Clew or saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show jobs near me" }));
    expect(ask).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: false }));
    expect(await screen.findByText("here 30.12,-97.99")).toBeInTheDocument();
    expect(screen.getByText("focus 30.12,-97.99")).toBeInTheDocument();
    expect(screen.getByText("Around you")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show jobs near me" })).not.toBeInTheDocument();
  });

  it("uses the location straight away once the browser already allows it, and never sends it", async () => {
    webgl.ok = true;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ask = stubLocation({ lat: 47.61, lng: -122.33 });
    stubPermission("granted");
    renderStage(ready([pin(1)]));
    expect(await screen.findByText("here 47.61,-122.33")).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("says so when location is turned off", async () => {
    webgl.ok = true;
    stubLocation({ denied: true });
    renderStage(ready([pin(1)]));
    fireEvent.click(await screen.findByRole("button", { name: "Show jobs near me" }));
    expect(screen.getByText(/Location is off for Clew, so the map uses your saved places, or the whole US/)).toBeInTheDocument();
  });

  it("sorts the list by distance once you share a location", async () => {
    stubLocation({ lat: 47.61, lng: -122.33 });
    renderStage(ready([pin(1), pin(2, { location: "Seattle, WA", lat: 47.606, lng: -122.332 })]));
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    const list = await screen.findByRole("list", { name: "Closest matching jobs" });
    const first = within(list).getAllByRole("link")[0];
    expect(first).toHaveAttribute("href", `/jobs/${pin(2).id}`);
    expect(first).toHaveTextContent("Under 1 mi");
    expect(screen.getByText("Sorted by distance from you.")).toBeInTheDocument();
  });

  it("with reduced motion, shows the map at once and keeps it still", async () => {
    webgl.ok = true;
    stubIntersection();
    preferReducedMotion();
    renderStage(ready([pin(1)]));
    expect(await screen.findByText("revealed")).toBeInTheDocument();
    expect(screen.getByText("still")).toBeInTheDocument();
    expect(document.querySelector(".map-window")).toHaveClass("is-revealed");
  });

  it("handles loading, errors and no placed jobs", () => {
    const { rerender } = renderStage({ status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading the map…");
    rerender(
      <MemoryRouter>
        <MapStage state={{ status: "error" }} intro={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/couldn't load the map/)).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <MapStage state={ready([], 4)} intro={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No matching jobs with a city yet/)).toBeInTheDocument();
  });
});

describe("location helpers", () => {
  it("rounds to two decimals, about a kilometer", () => {
    expect(roundPoint(30.123456, -97.987654)).toEqual({ lat: 30.12, lng: -97.99 });
  });

  it("measures miles between two points", () => {
    // Austin to Dallas is about 182 miles in a straight line.
    expect(milesBetween(AUSTIN, { lat: 32.78, lng: -96.8 })).toBeCloseTo(182, -1);
  });
});
