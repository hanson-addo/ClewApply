import { useAuth, useReverification } from "@clerk/react";
import { isReverificationCancelledError } from "@clerk/react/errors";

import { config } from "../config";

/**
 * Calls an account endpoint that needs a recent sign-in. A 403 comes back as Clerk's
 * reverification hint (JSON), which useReverification spots: it asks the user to confirm it's
 * them, then calls again. Anything else comes back as the Response.
 */
export function useAccountRequest(method: "POST" | "DELETE", path: string) {
  const { getToken } = useAuth();
  return useReverification(async (): Promise<Response | unknown> => {
    const token = await getToken();
    const response = await globalThis.fetch(
      new Request(`${config.apiUrl}${path}`, {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    );
    if (response.status === 403) return response.json();
    return response;
  });
}

/** Clerk throws this when the user closes its "confirm it's you" step. */
export function isCancelled(error: unknown): boolean {
  return isReverificationCancelledError(error);
}
