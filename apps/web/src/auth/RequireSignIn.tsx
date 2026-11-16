import { ClerkLoading, RedirectToSignIn, useAuth } from "@clerk/react";
import type { ReactNode } from "react";

/** Renders its children only for signed-in users; everyone else goes to sign-in and back. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    // Only while Clerk is still loading; if it fails, App shows why instead.
    return (
      <ClerkLoading>
        <p className="clew-loading" role="status">
          Loading…
        </p>
      </ClerkLoading>
    );
  }
  if (!isSignedIn) return <RedirectToSignIn />;
  return <>{children}</>;
}
