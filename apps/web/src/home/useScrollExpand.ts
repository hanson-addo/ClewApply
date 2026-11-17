import { type RefObject, useEffect, useRef, useState } from "react";

import { type Box, cameraPadding, type Insets, insetsWithin, progressAt, stageLayout, windowBox } from "./stageMath";

export type Frame = { t: number; padding: Insets };

type Elements = {
  stage: RefObject<HTMLElement | null>;
  intro: RefObject<HTMLElement | null>;
  slot: RefObject<HTMLElement | null>;
  sticky: RefObject<HTMLElement | null>;
  win: RefObject<HTMLElement | null>;
};

const CARD_RADIUS = 14; // --clew-radius-lg, the small card's corners.

function box(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Ties the map window to the scroll position. Each animation frame after a scroll it measures
 * the small card and the stuck area, clips the full-size map down to the card's box grown by
 * the progress so far, and hands the camera that progress. Only clip-path and a CSS variable
 * change per frame, never layout, and React re-renders only when "expanded" flips.
 */
export function useScrollExpand(
  enabled: boolean,
  { stage, intro, slot, sticky, win }: Elements,
  onFrame: RefObject<((frame: Frame) => void) | null>,
): { expanded: boolean; runway: number } {
  const [expanded, setExpanded] = useState(false);
  const [runway, setRunway] = useState(0);
  const runwayRef = useRef(0);
  const expandedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;

    const draw = () => {
      frame = 0;
      const stageEl = stage.current;
      const introEl = intro.current;
      const slotEl = slot.current;
      const stickyEl = sticky.current;
      const winEl = win.current;
      if (!stageEl || !introEl || !slotEl || !stickyEl || !winEl) return;

      const root = document.documentElement;
      const header = document.querySelector(".app-header");
      const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
      root.style.setProperty("--map-page-width", `${root.clientWidth}px`);
      root.style.setProperty("--map-header-height", `${headerHeight}px`);

      const stageBox = box(stageEl);
      const slotBox = box(slotEl);
      const full = box(stickyEl);
      if (full.height === 0) return; // Not laid out (tests, or hidden).

      const layout = stageLayout(slotBox.top - stageBox.top, introEl.offsetHeight, full.height);
      if (layout.runway !== runwayRef.current) {
        runwayRef.current = layout.runway;
        setRunway(layout.runway);
      }
      const t = progressAt(headerHeight - stageBox.top, layout);
      const shown = windowBox(slotBox, full, t);
      const insets = insetsWithin(shown, full);
      const radius = CARD_RADIUS * (1 - t);
      winEl.style.clipPath = `inset(${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px round ${radius}px)`;
      winEl.style.setProperty("--map-t", t.toFixed(3));

      // Hysteresis, so scrolling to and fro around the middle doesn't flicker.
      const next = expandedRef.current ? t > 0.35 : t > 0.6;
      if (next !== expandedRef.current) {
        expandedRef.current = next;
        setExpanded(next);
      }
      onFrame.current?.({ t, padding: cameraPadding(insets, full) });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (observer && intro.current) observer.observe(intro.current);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [enabled, stage, intro, slot, sticky, win, onFrame]);

  return { expanded: enabled && expanded, runway: enabled ? runway : 0 };
}
