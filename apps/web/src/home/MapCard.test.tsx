import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapCard } from "./MapCard";
import { type JobMapState, type MapPin, milesBetween, roundPoint } from "./useJobMap";

const webgl = vi.hoisted(() => ({ ok: false }));
vi.mock("./webgl", () => ({ canDrawMap: () => webgl.ok }));

// MapLibre needs WebGL, which tests don't have. The stand-in shows what the map was given.
vi.mock("./JobsMapCanvas", () => ({
  default: ({
    pins,
    near,
    onSelect,
  }: {
    pins: MapPin[];
    near: { lat: number; lng: number } | null;
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="map">
      <span>{near ? `near ${near.lat},${near.lng}` : "no location"}</span>
      {pins.map((pin) => (
        <button key={pin.id} type="button" onClick={() => onSelect(pin.id)}>
          pin {pin.title}
        </button>
      ))}
    </div>
  ),
}));

const pin = (n: number, over: Partial<MapPin> = {}): MapPin => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Thread Analyst ${n}`,
  company: "Labyrinth Logistics",
  location: "Austin, TX",
  lat: 30.27,
  lng: -97.74,
  fit_score: 90 - n,
  unverified_board: false,
  ...over,
});

const ready = (pins: MapPin[], unplaced = 0): JobMapState => ({
  status: "ready",
  center: { lat: 30.27, lng: -97.74 },
  pins,
  unplaced,
});

function renderCard(state: JobMapState) {
  return render(
    <MemoryRouter>
      <MapCard state={state} />
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

describe("MapCard", () => {
  beforeEach(() => {
    webgl.ok = false;
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "geolocation");
  });

  it("lists jobs, best fit first, when the browser can't draw a map", () => {
    renderCard(ready([pin(1), pin(2)], 3));
    expect(screen.queryByRole("group", { name: "Show jobs as" })).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Best matching jobs" });
    const links = within(list).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", `/jobs/${pin(1).id}`);
    expect(links).toHaveLength(2);
    expect(screen.getByText(/3 remote or unplaced jobs aren't on the map/)).toBeInTheDocument();
  });

  it("labels jobs from unverified boards", () => {
    renderCard(ready([pin(1, { unverified_board: true })]));
    expect(screen.getByText("Unverified board")).toBeInTheDocument();
  });

  it("shows the map, and a React card for the pin you pick", async () => {
    webgl.ok = true;
    renderCard(ready([pin(1), pin(2, { unverified_board: true })]));
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(await screen.findByRole("button", { name: "pin Thread Analyst 2" }));
    const card = screen.getByRole("group", { name: "Thread Analyst 2" });
    expect(within(card).getByRole("link")).toHaveAttribute("href", `/jobs/${pin(2).id}`);
    expect(within(card).getByText("Unverified board")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("group", { name: "Thread Analyst 2" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "pin Thread Analyst 1" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Thread Analyst 1" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Best matching jobs" })).toBeInTheDocument();
  });

  it("asks for location only on a press, and rounds it before using it", async () => {
    webgl.ok = true;
    const ask = stubLocation({ lat: 30.123456, lng: -97.987654 });
    renderCard(ready([pin(1)]));
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByText("Your location isn't sent to Clew or saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    expect(ask).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: false }));
    expect(await screen.findByText("near 30.12,-97.99")).toBeInTheDocument();
  });

  it("sorts the list by distance once you share a location, and never sends it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    stubLocation({ lat: 47.61, lng: -122.33 });
    renderCard(ready([pin(1), pin(2, { location: "Seattle, WA", lat: 47.606, lng: -122.332 })]));
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    const list = await screen.findByRole("list", { name: "Closest matching jobs" });
    const first = within(list).getAllByRole("link")[0];
    expect(first).toHaveAttribute("href", `/jobs/${pin(2).id}`);
    expect(first).toHaveTextContent("Under 1 mi");
    expect(screen.getByText("Sorted by distance from you.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("says so when location is turned off", () => {
    stubLocation({ denied: true });
    renderCard(ready([pin(1)]));
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    expect(screen.getByText(/Location is off for Clew, so the map uses your saved places, or the whole US/)).toBeInTheDocument();
  });

  it("handles loading, errors and no placed jobs", () => {
    const { rerender } = renderCard({ status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading the map…");
    rerender(
      <MemoryRouter>
        <MapCard state={{ status: "error" }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/couldn't load the map/)).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <MapCard state={ready([], 4)} />
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
    expect(milesBetween({ lat: 30.27, lng: -97.74 }, { lat: 32.78, lng: -96.8 })).toBeCloseTo(182, -1);
  });
});
