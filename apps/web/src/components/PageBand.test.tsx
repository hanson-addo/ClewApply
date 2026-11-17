import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageBand } from "./PageBand";

function band(container: HTMLElement) {
  const node = container.querySelector(".page-band");
  if (!node) throw new Error("no band");
  return node;
}

describe("PageBand", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is hidden from screen readers", () => {
    const { container } = render(<PageBand kind="home" />);
    expect(band(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("starts where the last page left the maze, then slides to its own tab", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const first = render(<PageBand kind="home" />);
    first.unmount();

    const { container } = render(<PageBand kind="jobs" />);
    expect(band(container)).toHaveAttribute("data-band", "jobs");
    expect(band(container)).toHaveAttribute("data-at", "home");

    act(() => {
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
    });
    expect(band(container)).toHaveAttribute("data-at", "jobs");
  });
});
