const R = 20;
const AROUND = 2 * Math.PI * R;

/** The fit ring. The number carries the meaning; the ring and its color only echo it. */
export function FitScore({ score }: { score: number }) {
  const filled = (Math.max(0, Math.min(100, score)) / 100) * AROUND;
  return (
    <div className="fit-score">
      <span className="clew-sr-only">Fit {score} of 100</span>
      <svg className="fit-score-ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle className="fit-score-track" cx="24" cy="24" r={R} />
        <circle
          className="fit-score-arc"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={`${filled} ${AROUND}`}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span aria-hidden="true" className="fit-score-number">
        {score}
      </span>
    </div>
  );
}
