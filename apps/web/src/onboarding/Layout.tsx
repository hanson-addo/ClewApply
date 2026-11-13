import { useClerk } from "@clerk/react";
import type { ReactNode } from "react";

import { AppHeader } from "../components/AppHeader";
import { STEPS } from "./model";

/** The page around each onboarding step: header, the four-step progress, then the step. */
export function OnboardingLayout({ step, children }: { step: number; children: ReactNode }) {
  const { signOut } = useClerk();
  return (
    <>
      <AppHeader email={null} onSignOut={() => void signOut({ redirectUrl: "/sign-in" })} />
      <main id="main" className="onboarding">
        <ol className="stepper" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`stepper-step${index < step ? " stepper-done" : ""}${index === step ? " stepper-current" : ""}`}
              aria-current={index === step ? "step" : undefined}
            >
              <span className="stepper-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="stepper-label">
                {label}
                {index < step && <span className="clew-sr-only">, done</span>}
              </span>
            </li>
          ))}
        </ol>
        {children}
      </main>
    </>
  );
}
