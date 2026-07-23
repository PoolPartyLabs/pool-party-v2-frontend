/**
 * @id PP-CORE-HOK-010
 * @name useAnalytics
 * @implements-rules-version v1
 *
 * Single tracking entry point. Components call `track(event, params)`, never `gtag` or the
 * dataLayer directly [R1]. Pushes typed events to `window.dataLayer`; GTM reads it and dispatches
 * to GA4 (configured in the GTM UI, not here). No-op on the server. When `NEXT_PUBLIC_GTM_ID` is
 * absent (local dev), the push still happens against a local dataLayer and is logged in debug.
 */
"use client";

import { useCallback } from "react";
import { readConsent } from "./consent";
import type { AnalyticsEvent, AnalyticsParams } from "./events";
import { sanitizeParams } from "./sanitizeParams";
import { getAnalyticsUserId } from "./userId";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
  }
}

export interface UseAnalytics {
  track: (event: AnalyticsEvent, params?: AnalyticsParams) => void;
}

export function useAnalytics(): UseAnalytics {
  const track = useCallback((event: AnalyticsEvent, params?: AnalyticsParams) => {
    if (typeof window === "undefined") return;
    // POO-164: merge the resolved pseudonymous id (AnalyticsIdentify keeps the store in sync).
    const userId = getAnalyticsUserId();
    const withId: AnalyticsParams | undefined =
      userId && !params?.user_id ? { ...params, user_id: userId } : params;
    // PP-SECURITY [R4]: `user_id` (hashed wallet) only rides along once consent is granted.
    const clean = sanitizeParams(withId, readConsent() === "granted");
    window.dataLayer = window.dataLayer ?? [];
    // PP-INTEGRATION-POINT: GTM reads this dataLayer; GA4 is the configured destination (GTM UI).
    window.dataLayer.push({ event, ...clean });
    if (process.env.NODE_ENV === "development") {
      console.debug("[analytics]", event, clean);
    }
  }, []);

  return { track };
}
