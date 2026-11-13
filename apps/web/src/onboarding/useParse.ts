import { useEffect, useRef } from "react";

import type { useApi } from "../auth/useApi";
import type { Parse } from "./model";

/** Polls GET /resumes/{id}/parse every 2 s for 30 s, then every 5 s, until it is done or
 *  failed. Paused while the tab is hidden; stopped when the page is left. A 404 means the
 *  resume isn't being read, reported as null. */
export function usePollParse(
  api: ReturnType<typeof useApi>,
  resumeId: string | null,
  active: boolean,
  onUpdate: (parse: Parse | null) => void,
) {
  const latest = useRef(onUpdate);
  useEffect(() => {
    latest.current = onUpdate;
  });

  useEffect(() => {
    if (!resumeId || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const poll = async () => {
      if (stopped) return;
      if (document.hidden) return; // picked up again on visibilitychange
      try {
        const { data, response } = await api.GET("/resumes/{resume_id}/parse", {
          params: { path: { resume_id: resumeId } },
        });
        if (stopped) return;
        if (data) {
          latest.current(data);
          if (data.status === "done" || data.status === "failed") return;
        } else if (response.status === 404) {
          latest.current(null);
          return;
        }
      } catch {
        // A dropped request is tried again on the next tick.
      }
      if (!stopped) timer = setTimeout(() => void poll(), Date.now() - started < 30_000 ? 2000 : 5000);
    };
    const onVisible = () => {
      if (!document.hidden && !stopped) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [api, resumeId, active]);
}
