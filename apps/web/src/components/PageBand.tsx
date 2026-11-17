import { useEffect, useState } from "react";

export type BandKind = "home" | "jobs" | "applications" | "profile";

/**
 * One long maze, 4 screens wide. Each tab shows its own quarter, so moving between tabs slides
 * the maze sideways. Drawn at 7% so it reads as texture, never as content.
 */
const MAZE = [
  "M40 40H360V120H120V200H440V40H700V280H520V200",
  "M780 40V160H1000V80H1240V240H900V320H1180",
  "M200 280H460V340",
  "M620 340V300H860",
  "M1060 160V240",
  "M1240 240H1420V80H1700V200H1500V320H1900V120H2100",
  "M1600 40V120",
  "M1980 200H2240V40H2520V280H2300V340",
  "M2100 120V280H2200",
  "M2600 80H2900V240H2700V160",
  "M2520 280H3000V40H3300V200H3120",
  "M3300 200V320H3600V120H3840V260",
  "M3840 260H4100V60H4380V220H4180V140",
  "M4000 340V300H4300",
  "M4460 40V180H4700V80H4980V300H4620V240",
  "M4540 320H4860",
].join("");

/** The tab the maze was last showing, so the next page can slide on from there. */
let lastShown: BandKind | null = null;

/**
 * The indigo band behind a page's title: the maze, and a coral glow that sits somewhere
 * different on each tab. Purely decorative. The slide is a CSS transition on one transform,
 * so it costs nothing per frame in JavaScript, and reduced motion turns it off.
 */
export function PageBand({ kind }: { kind: BandKind }) {
  const [at, setAt] = useState<BandKind>(() => lastShown ?? kind);

  useEffect(() => {
    lastShown = kind;
    if (at === kind) return;
    // Two frames: the first paints the old position, so the browser has something to slide from.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setAt(kind));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [kind, at]);

  return (
    <div className="page-band" data-band={kind} data-at={at} aria-hidden="true">
      <div className="page-band-glow" />
      <svg className="page-band-maze" viewBox="0 0 5120 360" preserveAspectRatio="none" focusable="false">
        <path d={MAZE} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
