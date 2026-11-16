import { useEffect, useState } from "react";

import { useMediaQuery } from "../components/useMediaQuery";

const DURATION_MS = 700;

/**
 * Counts from 0 up to `target` once, easing out. Shows the target straight away when the user
 * prefers reduced motion or the browser can't animate.
 */
export function useCountUp(target: number): number {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const animate = !reduced && typeof requestAnimationFrame === "function" && target > 0;
  const [shown, setShown] = useState(animate ? 0 : target);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setShown(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, target]);

  return animate ? shown : target;
}
