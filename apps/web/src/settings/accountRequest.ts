import { useAuth, useReverification } from "@clerk/react";
import { isReverificationCancelledError } from "@clerk/react/errors";

import { config } from "../config";

/**
 * Calls an account endpoint that needs a recent sign-in. A 403 comes back as Clerk's
 * reverification hint (JSON), which useReverification spots: it asks the user to confirm it's
 * them, then calls again. Anything else comes back wrapped as `{ response }`: Clerk's
 * useReverification reads a bare Response as JSON (`r.json()`) before handing it back, which
 * loses the status and breaks non-JSON bodies such as the export zip or a 204.
 */
export function useAccountRequest(method: "POST" | "DELETE", path: string) {
  const { getToken } = useAuth();
  return useReverification(async (): Promise<{ response: Response } | unknown> => {
    const token = await getToken();
    const response = await globalThis.fetch(
      new Request(`${config.apiUrl}${path}`, {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    );
    if (response.status === 403) return response.json();
    return { response };
  });
}

/** Clerk throws this when the user closes its "confirm it's you" step. */
export function isCancelled(error: unknown): boolean {
  return isReverificationCancelledError(error);
}

/** The Response from useAccountRequest, or null when it gave back something else. */
export function responseOf(result: unknown): Response | null {
  const response = (result as { response?: unknown } | null)?.response;
  return response instanceof Response ? response : null;
}
