import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StartupErrorBoundary } from "./StartupProblemPage";

function Broken(): never {
  throw new Error("made-up render failure");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StartupErrorBoundary", () => {
  it("shows its children when nothing goes wrong", () => {
    render(
      <StartupErrorBoundary>
        <p>All good</p>
      </StartupErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("shows a message instead of a blank page when rendering crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <StartupErrorBoundary>
        <Broken />
      </StartupErrorBoundary>,
    );
    expect(screen.getByRole("heading", { name: /clew couldn't start/i })).toBeInTheDocument();
  });
});
