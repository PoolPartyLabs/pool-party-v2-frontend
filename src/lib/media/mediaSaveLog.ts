/**
 * @id PP-CORE-LIB-037 (POO-702 Secondary #1)
 * @name mediaSaveLog
 * @implements-rules-version v1
 *
 * Server-side observability for the real-mode profile persist PATCH (investor `PATCH /users/me`, manager
 * `PATCH /managers/me`). POO-702's primary symptom is deterministic: the uploaded https avatar/banner URL
 * reaches S3 but is NOT persisted, and three code-reading passes could not pin the failing hop because the
 * save path is opaque in the container logs. This helper makes the NEXT real save reveal it:
 *
 * - {@link logMediaSaveRequest} prints the PATCH body's SHAPE — the key names plus whether `avatarUrl` /
 *   `bannerUrl` are absent, present-but-not-https, or https — so a maintainer sees at a glance whether the
 *   trusted URL actually rode the persisting PATCH (the exact question POO-702 could not answer statically).
 * - {@link logMediaSaveError} prints the API failure (status / code / message) so a silent 4xx (e.g. the
 *   phone-length 400 that 400s the whole investor PATCH, POO-699/700) is diagnosable instead of invisible.
 *
 * PII-safe by construction: it logs key NAMES and a URL CLASSIFICATION, never any field value. Both lines
 * carry the greppable `PP-MEDIA-SAVE` prefix for `docker logs` triage.
 *
 * Server-only: imported by the `"use server"` profile/manager actions, never by a client bundle.
 *
 * PP-INTEGRATION-POINT: swap console for the platform structured logger once one exists (mirrors
 * `observeAnalyticsFailure`).
 */
import "server-only";

import { describeError, type ErrorDescription } from "@/lib/observability/describeError";

/** Which profile surface the persist PATCH targets. */
export type MediaSaveSurface = "investor" | "manager";

/** How a URL field looks in the write body, WITHOUT logging its value. */
export type UrlShape = "absent" | "non-https" | "https";

/** Classify a candidate URL field for a PII-free log: absent, present-but-not-https, or https. */
export function classifyUrl(value: unknown): UrlShape {
  if (typeof value !== "string" || value === "") return "absent";
  return /^https:\/\//i.test(value) ? "https" : "non-https";
}

/** The greppable prefix every media-save observability line carries. */
export const MEDIA_SAVE_LOG_PREFIX = "PP-MEDIA-SAVE";

/**
 * Log the persist PATCH body's shape so the next real save reveals whether the uploaded https URL reached
 * the PATCH. Records only the sorted key names + the `avatarUrl`/`bannerUrl` classification — never a value.
 *
 * The generic constraint lets both write bodies (`ProfileWriteBody`, `ManagerProfileWriteBody`) pass
 * without an index signature and without this shared helper importing feature types (no upward coupling).
 */
export function logMediaSaveRequest<T extends { avatarUrl?: string; bannerUrl?: string }>(
  surface: MediaSaveSurface,
  body: T,
): void {
  console.info(`${MEDIA_SAVE_LOG_PREFIX} request`, {
    surface,
    bodyKeys: Object.keys(body).sort(),
    avatarUrl: classifyUrl(body.avatarUrl),
    bannerUrl: classifyUrl(body.bannerUrl),
  });
}

/** Log a failed persist PATCH (status / failure-class / message) so a silent 4xx/5xx is diagnosable. */
export function logMediaSaveError(surface: MediaSaveSurface, error: unknown): void {
  const description: ErrorDescription = describeError(error);
  console.error(`${MEDIA_SAVE_LOG_PREFIX} error`, { surface, ...description });
}
