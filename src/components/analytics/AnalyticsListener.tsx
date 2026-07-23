/**
 * @id PP-CORE (SETUP-014 / POO-82)
 * @name AnalyticsListener
 * @analytics-events page_viewed, web_vitals
 * @implements-rules-version v1
 *
 * Mounted once in the app shell. Reports Core Web Vitals and a `page_viewed` on each route change.
 * Tracking goes through `useAnalytics()`; never gtag/dataLayer directly.
 */
"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";

export function AnalyticsListener() {
  const { track } = useAnalytics();
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    track("web_vitals", {
      metric_name: metric.name,
      metric_value: metric.value,
      metric_rating: metric.rating,
    });
  });

  useEffect(() => {
    track("page_viewed", { page_path: pathname });
  }, [pathname, track]);

  return null;
}
