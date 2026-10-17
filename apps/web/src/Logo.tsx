/** Clew mark: a coral yarn ball with two knitting needles and a curly loose end. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Clew">
      <line x1="10" y1="6" x2="32" y2="34" stroke="var(--clew-color-ink-900)" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="38" y1="6" x2="16" y2="34" stroke="var(--clew-color-ink-900)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="26" r="14" fill="var(--clew-color-coral-500)" />
      <path
        d="M13 21c7 3 15 3 22 0M11 27c8 3 18 3 26 0M14 33c6 2 14 2 20 0"
        stroke="var(--clew-color-ink-900)"
        strokeOpacity="0.35"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M37 31c4 2 6 6 3 9s-7 0-5-3 6 1 7 5"
        stroke="var(--clew-color-coral-500)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
