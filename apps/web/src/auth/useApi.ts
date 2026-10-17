import { useAuth } from "@clerk/react";
import { useMemo } from "react";

import { createApiClient, type ApiClient } from "../api/client";

/** API client that sends the signed-in user's Clerk session token. */
export function useApi(): ApiClient {
  const { getToken } = useAuth();
  return useMemo(() => createApiClient(() => getToken()), [getToken]);
}
