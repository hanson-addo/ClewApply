/** The fit score square. The number carries the meaning; color never does. */
export function FitScore({ score }: { score: number }) {
  return (
    <div className="fit-score">
      <span className="clew-sr-only">Fit {score} of 100</span>
      <span aria-hidden="true" className="fit-score-number">
        {score}
      </span>
      <span aria-hidden="true" className="fit-score-label">
        FIT
      </span>
    </div>
  );
}
