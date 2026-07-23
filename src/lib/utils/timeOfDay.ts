/**
 * @name timeOfDay
 * @implements-rules-version v1
 *
 * Pure helper: map a local 24h hour to a greeting bucket. Kept free of React / Date so the bucketing
 * is unit-tested independently of the component that reads the clock (the caller passes the hour, and
 * guards SSR/hydration with a mount check).
 */

/** A time-of-day greeting bucket. */
export type TimeOfDay = "morning" | "afternoon" | "evening";

/**
 * Bucket a 24-hour clock hour (0-23): 5-11 morning, 12-17 afternoon, 18-4 evening.
 *
 * @param hour Local hour, 0-23 (e.g. `new Date().getHours()`).
 */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}
