import { useId } from "react";

type LogoProps = {
  /** `onDark` for indigo backgrounds (header, sign-in), `onLight` for light panels. */
  variant?: "onDark" | "onLight";
  size?: number;
  withWordmark?: boolean;
};

/** Clew mark: a coral yarn ball with two knitting needles and a curly loose end. Decorative. */
export function Logo({ variant = "onDark", size = 40, withWordmark = true }: LogoProps) {
  const clipId = useId();
  const needles = variant === "onDark" ? "var(--clew-color-ink-50)" : "var(--clew-color-ink-900)";
  return (
    <span className={`clew-logo clew-logo-${variant}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        aria-hidden="true"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx="21" cy="26" r="14" />
          </clipPath>
        </defs>
        <g stroke={needles} strokeWidth="2">
          <path d="M10 38L35 6" />
          <path d="M32 38L9 8" />
        </g>
        <circle cx="35.6" cy="5.2" r="2.2" fill={needles} />
        <circle cx="8.3" cy="7.1" r="2.2" fill={needles} />
        <circle cx="21" cy="26" r="14" fill="var(--clew-color-coral-500)" />
        <g clipPath={`url(#${clipId})`} stroke="var(--clew-color-ink-900)" strokeWidth="1.5">
          <path d="M4 14c8 4 20 14 26 26" />
          <path d="M8 10c8 4 20 14 26 26" />
          <path d="M12 7c8 4 18 12 26 24" />
          <path d="M6 30c8 5 22 5 30-1" />
          <path d="M7 35c8 5 22 5 30-1" />
        </g>
        <path
          d="M34.5 30c5 1 9 6 6 10s-7 1-4.5-2 8-1 10 4"
          stroke="var(--clew-color-coral-500)"
          strokeWidth="2.2"
        />
      </svg>
      {withWordmark && <span className="clew-wordmark">clew</span>}
    </span>
  );
}
