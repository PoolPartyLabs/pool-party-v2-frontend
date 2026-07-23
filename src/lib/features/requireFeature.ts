/**
 * @id PP-CORE-LIB-011
 * @name requireFeature (server route guard)
 *
 * Server guard for a flag-gated route. Call it at the top of a gated route's `page.tsx` / `layout.tsx`:
 * when the area's flag is off it triggers Next's {@link notFound} (renders the 404), so deep-links and
 * shared URLs are gated server-side — not merely hidden from the nav. Core areas are NOT guarded
 * (nav-level kill-switch only). See docs/FEATURE_FLAGS.md.
 */
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "./index";
import type { FeatureKey } from "./registry";

/** Render the 404 page when `key`'s flag is off; otherwise return and let the route render. */
export function requireFeature(key: FeatureKey): void {
  if (!isFeatureEnabled(key)) {
    notFound();
  }
}
