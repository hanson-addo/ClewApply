import type { ReactNode } from "react";
import { vi } from "vitest";

/** Controllable stand-in for @clerk/react, so tests never load Clerk or call its servers. */
export const clerkState = {
  isLoaded: true,
  isSignedIn: false,
  token: "test-session-token" as string | null,
  signOut: vi.fn<(opts?: unknown) => Promise<void>>(async () => {}),
};

export function resetClerk() {
  clerkState.isLoaded = true;
  clerkState.isSignedIn = false;
  clerkState.token = "test-session-token";
  clerkState.signOut.mockClear();
}

const getToken = async () => clerkState.token;

export const clerkModule = {
  ClerkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    isLoaded: clerkState.isLoaded,
    isSignedIn: clerkState.isSignedIn,
    getToken,
  }),
  useClerk: () => ({ signOut: clerkState.signOut }),
  RedirectToSignIn: () => <p>Redirecting to sign in</p>,
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignUp: () => <div data-testid="clerk-sign-up" />,
};
