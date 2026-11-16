import { useEffect, useState } from "react";

import { useApi } from "../auth/useApi";
import type { Application } from "../applications/model";
import type { FeedJob, Preferences } from "./model";

export const TOP_MATCHES = 4;

export type Dashboard = {
  /** The profile's name, or null when there is no profile or no name on it. */
  name: string | null;
  /** False only when the server says there's no profile (404); null when it couldn't be loaded. */
  hasProfile: boolean | null;
  prefs: Preferences | null;
  /** Null when the feed could not be loaded. */
  jobs: { items: FeedJob[]; total: number } | null;
  /** Null when applications could not be loaded. */
  apps: Application[] | null;
};

/**
 * Only a 404 means there's no profile. A server error or a dropped connection is unknown,
 * so a returning user is never shown the new-user hero because of an outage.
 */
export function profileExists(
  result: { data?: unknown; response: { status: number } } | null,
): boolean | null {
  if (result?.data) return true;
  if (result?.response.status === 404) return false;
  return null;
}

export type DashboardState = { status: "loading" } | ({ status: "ready" } & Dashboard);

/**
 * Everything the home page shows besides the account. Each block loads on its own, so one
 * failing call leaves its block out instead of breaking the page.
 */
export function useDashboard(enabled: boolean): DashboardState {
  const api = useApi();
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const settle = async <T,>(call: Promise<T>): Promise<T | null> => {
      try {
        return await call;
      } catch {
        return null;
      }
    };
    void Promise.all([
      settle(api.GET("/profile")),
      settle(api.GET("/preferences")),
      settle(api.GET("/feed", { params: { query: { per_page: TOP_MATCHES } } })),
      settle(api.GET("/applications")),
    ]).then(([profile, prefs, feed, apps]) => {
      if (cancelled) return;
      setState({
        status: "ready",
        name: profile?.data?.data.basics?.name ?? null,
        hasProfile: profileExists(profile),
        prefs: prefs?.data ?? null,
        jobs: feed?.data ? { items: feed.data.jobs, total: feed.data.total } : null,
        apps: apps?.data ? apps.data.applications : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [api, enabled]);

  return state;
}
