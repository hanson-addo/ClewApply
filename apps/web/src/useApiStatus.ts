import { useEffect, useState } from "react";

import { api } from "./api/client";

export type ApiStatus = "checking" | "online" | "offline";

/** Pings the API's health check once on mount. */
export function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/health")
      .then(({ data }) => {
        if (!cancelled) setStatus(data?.status === "ok" ? "online" : "offline");
      })
      .catch(() => {
        if (!cancelled) setStatus("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
