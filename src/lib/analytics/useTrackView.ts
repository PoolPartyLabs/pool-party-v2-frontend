/**
 * @id PP-CORE-HOK-012
 * @name useTrackView
 * @implements-rules-version v1
 *
 * Fire-once lifecycle tracker. Wraps `useAnalytics().track()` and emits a single event when the host
 * component first mounts — the canonical way to record `*_viewed` events (and other one-shot events
 * like `app_error_shown`). The event/params are snapshotted at mount so re-renders never re-fire, and
 * the `fired` ref guards React's development double-invoke. No-op on the server (the underlying
 * `track` already guards `window`). Components use this; they never touch gtag/dataLayer directly.
 */
"use client";

import { useEffect, useRef } from "react";
import type { AnalyticsEvent, AnalyticsParams } from "./events";
import { useAnalytics } from "./useAnalytics";

/** Track `event` exactly once, when the calling component first mounts. */
export function useTrackView(event: AnalyticsEvent, params?: AnalyticsParams): void {
  const { track } = useAnalytics();
  const fired = useRef(false);
  // Snapshot at mount: a view fires once, with the values it had when it appeared.
  const snapshot = useRef<{ event: AnalyticsEvent; params?: AnalyticsParams }>({ event, params });

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(snapshot.current.event, snapshot.current.params);
  }, [track]);
}
