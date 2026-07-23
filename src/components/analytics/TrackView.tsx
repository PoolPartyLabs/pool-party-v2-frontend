/**
 * @id PP-CORE (POO-158)
 * @name TrackView
 * @implements-rules-version v1
 *
 * Tiny client wrapper that fires a one-shot analytics event on mount, then renders nothing. Lets a
 * Server Component (e.g. a route `page.tsx`) record a `*_viewed` event without becoming a Client
 * Component itself — drop `<TrackView event="home_viewed" />` next to the view. Tracking goes through
 * `useTrackView` → `useAnalytics`; never gtag/dataLayer directly.
 */
"use client";

import type { AnalyticsEvent, AnalyticsParams } from "@/lib/analytics/events";
import { useTrackView } from "@/lib/analytics/useTrackView";

/** Props for {@link TrackView}. */
export interface TrackViewProps {
  /** The event to emit on mount. Restricted to the typed analytics union. */
  event: AnalyticsEvent;
  /** Optional event params (must be serializable — this crosses the server→client boundary). */
  params?: AnalyticsParams;
}

/** Fire `event` once on mount; renders nothing. */
export function TrackView({ event, params }: TrackViewProps) {
  useTrackView(event, params);
  return null;
}
