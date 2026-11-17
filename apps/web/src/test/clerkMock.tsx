import type { ReactNode } from "react";
import { vi } from "vitest";

/** Controllable stand-in for @clerk/react, so tests never load Clerk or call its servers. */
export const clerkState = {
  isLoaded: true,
  isSignedIn: false,
  // True when Clerk's script failed to load (isLoaded stays false then).
  failed: false,
  token: "test-session-token" as string | null,
  signOut: vi.fn<(opts?: unknown) => Promise<void>>(async () => {}),
  // How many times useReverification showed its "confirm it's you" step.
  reverified: 0,
};

export function resetClerk() {
  clerkState.isLoaded = true;
  clerkState.isSignedIn = false;
  clerkState.failed = false;
  clerkState.token = "test-session-token";
  clerkState.signOut.mockClear();
  clerkState.reverified = 0;
}

function isHint(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "clerk_error" in result &&
    (result as { clerk_error?: { reason?: string } }).clerk_error?.reason === "reverification-error"
  );
}

/** Like Clerk's: on a reverification hint it "confirms it's you" once and calls again. */
function useReverification<T extends (...args: never[]) => Promise<unknown>>(fetcher: T): T {
  return (async (...args: Parameters<T>) => {
    const first = await fetcher(...args);
    if (!isHint(first)) return first;
    clerkState.reverified += 1;
    return fetcher(...args);
  }) as T;
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
  useReverification,
  ClerkLoading: ({ children }: { children: ReactNode }) =>
    !clerkState.isLoaded && !clerkState.failed ? <>{children}</> : null,
  ClerkFailed: ({ children }: { children: ReactNode }) =>
    clerkState.failed ? <>{children}</> : null,
  RedirectToSignIn: () => <p>Redirecting to sign in</p>,
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignUp: () => <div data-testid="clerk-sign-up" />,
};
