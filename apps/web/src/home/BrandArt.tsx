/** Small decorative drawings in the Clew style. All are hidden from screen readers. */

/** A coral yarn ball with a loose curly thread, for empty states. */
export function YarnArt({ size = 72 }: { size?: number }) {
  return (
    <svg className="brand-art" width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="30" cy="34" r="20" fill="var(--clew-color-coral-500)" />
      <g fill="none" stroke="var(--clew-color-coral-700)" strokeWidth="2" strokeLinecap="round">
        <path d="M14 26c8 4 22 4 32-4" />
        <path d="M12 36c10 6 26 6 36-2" />
        <path d="M16 46c8 4 20 4 28-2" />
        <path d="M24 15c-4 10-4 28 2 38" />
      </g>
      <path
        d="M49 42c6 2 10 7 8 12s-8 4-8 0 6-6 10-4 6 6 5 10"
        fill="none"
        stroke="var(--clew-color-coral-500)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const PINS: [number, number, boolean][] = [
  [62, 44, true],
  [128, 30, false],
  [176, 70, true],
  [96, 92, false],
  [214, 38, false],
];

/** A stylized street map with job pins, for the map teaser. Not a real place. */
export function MapArt() {
  return (
    <svg className="brand-art map-art" viewBox="0 0 260 120" aria-hidden="true">
      <rect width="260" height="120" rx="14" fill="var(--clew-color-ink-900)" />
      <g stroke="var(--clew-color-ink-700)" strokeWidth="6" strokeLinecap="round" fill="none">
        <path d="M-10 58C60 40 120 90 270 62" />
        <path d="M70 -10C80 40 60 80 84 130" />
        <path d="M190 -10C170 50 200 90 182 130" />
      </g>
      <g stroke="var(--clew-color-ink-800)" strokeWidth="2" fill="none">
        <path d="M0 24H260M0 96H260M30 0V120M140 0V120M230 0V120" />
      </g>
      {PINS.map(([x, y, top]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <path
            d="M0 0c-6-8-9-12-9-16a9 9 0 0 1 18 0c0 4-3 8-9 16z"
            fill={top ? "var(--clew-color-coral-500)" : "var(--clew-color-ink-50)"}
          />
          <circle cy="-16" r="3" fill="var(--clew-color-ink-900)" />
        </g>
      ))}
    </svg>
  );
}
