import { useClerk } from "@clerk/react";
import { useCallback } from "react";

import { useApi } from "./useApi";

/** How long signing out waits for Clew to disconnect the extension before going ahead. */
const DISCONNECT_WAIT_MS = 3000;

/**
 * Signs out of Clew, first disconnecting the browser extension everywhere (Security #7), so a
 * shared computer isn't left with a signed-in extension. Signing out goes ahead even if Clew
 * can't be reached.
 */
export function useSignOut(): (redirectUrl?: string) => Promise<void> {
  const { signOut } = useClerk();
  const api = useApi();
  return useCallback(
    async (redirectUrl = "/sign-in") => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, DISCONNECT_WAIT_MS);
      });
      await Promise.race([api.POST("/extension/connections/revoke-all").catch(() => undefined), wait]);
      clearTimeout(timer);
      await signOut({ redirectUrl });
    },
    [api, signOut],
  );
}
