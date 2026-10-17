import { RedirectToSignIn, useAuth } from "@clerk/react";
import type { ReactNode } from "react";

/** Renders its children only for signed-in users; everyone else goes to sign-in and back. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <p className="clew-loading" role="status">
        Loading…
      </p>
    );
  }
  if (!isSignedIn) return <RedirectToSignIn />;
  return <>{children}</>;
}
