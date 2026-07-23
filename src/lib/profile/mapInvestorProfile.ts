/**
 * @id PP-PROF-LIB-002 (POO-233, POO-426, POO-661)
 * @name mapInvestorProfile
 * @implements-rules-version v1
 *
 * ACL mapper: deployed pp-api public profile (POO-232) + the analytics rewards read + the pp-api
 * referral read → the FE `ProfileUser`. Encodes the field-gap decisions explicitly so nothing is
 * silently fabricated or dropped:
 *
 * - `displayName` <- `displayName` (PUBLIC; backend already masks the default to `0x1A2b...5678`,
 *   satisfying POO-233 R2 — the FE never re-masks; it renders whatever the backend resolved). Feeds the
 *   avatar `initial`.
 * - `name` <- `name` (POO-693: PRIVATE comms-only; owner projection only). Absent on the public read and
 *   on older API responses → "", never fabricated.
 * - `isManager` <- `isManager` (pass-through).
 * - `referralCode` / `referralJoined` <- the pp-api referral read (POO-661: `/referral/:wallet` is the
 *   AUTHORITATIVE source, NOT the analytics rewards read). `code` is `null` until created → `""`. A null
 *   referral read (absent / degraded) → empty/zero, so identity still loads.
 * - `quacks` <- the analytics rewards read (POO-426). A null rewards read (absent / degraded) → 0.
 * - `referralEarned` <- 0. No backend exposes a USD referral-earnings aggregate yet; PP-INTEGRATION-POINT.
 * - `email` / `country` / `phone` <- the OWNER projection (`GET`/`PATCH /users/me`, POO-674/POO-675),
 *   `null` -> `""`. Absent on the PUBLIC read (signed-out / owner-read fallback), where they resolve to
 *   `""` — the owner fields are simply `undefined` on that shape, so the same `?? ""` covers both.
 * - `username` <- `""` (field removed from the UI, POO-675) and `emailVerified` <- `false` (no
 *   verification backend). Kept empty, never fabricated.
 * - `initial` is derived client-side from the display name.
 * - `avatar` <- `avatarUrl` (POO-580: the media mint persists the uploaded avatar's CDN URL via
 *   `PATCH /users/me`); null (never uploaded) -> "" so the UI falls back to `initial`.
 */
import type { ProfileUser, ReferralProgram, RubberRush } from "@/lib/schemas";
import type { ApiOwnerProfile, ApiPublicProfile } from "./profileApiSchema";

/**
 * The profile shape the mapper accepts: always the PUBLIC projection, optionally carrying the OWNER-only
 * `email`/`country`/`phone` (present on the `GET`/`PATCH /users/me` reads, absent on the public read).
 * One type covers both callers so the owner fields are `undefined` (not a parse error) on the public shape.
 */
type MappableProfile = ApiPublicProfile &
  Partial<Pick<ApiOwnerProfile, "name" | "email" | "country" | "phone">>;

/**
 * The avatar-fallback glyph shown when the display name has no usable letter/digit at all (e.g. it is
 * only "0x", or only punctuation). A truly empty/blank name still yields "" so the UI renders a bare
 * circle, unchanged.
 */
const NEUTRAL_INITIAL = "•";

/**
 * The single avatar-fallback letter, derived from the PUBLIC display name (POO-426: `initial` is
 * client-side). Skips a leading "0x" so a wallet-style name (e.g. "0xRafa", or the masked-wallet default
 * "0x1A2b...5678") yields the first REAL letter/digit — "R" / "1" — instead of the hex prefix "0"
 * (POO-693). Then the first alphanumeric of the remainder, uppercased; a blank name yields "" and a
 * name with no alphanumeric at all falls back to a neutral glyph.
 */
export function deriveInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed === "") return "";
  const candidate = trimmed.replace(/^0x/i, "");
  const match = candidate.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : NEUTRAL_INITIAL;
}

/**
 * Map the real profile record + analytics rewards read + pp-api referral read into a `ProfileUser`.
 * `rewards` may be null when the analytics read is absent/degraded (Quacks → 0), and `referral` may be
 * null when the pp-api referral read is absent/degraded (referral code/joined → empty/zero). Neither
 * outage fails identity.
 */
export function mapInvestorProfile(
  profile: MappableProfile,
  rewards: RubberRush | null,
  referral: ReferralProgram | null,
): ProfileUser {
  return {
    // Backend-sourced identity. POO-693 splits the single name into the PRIVATE `name` (owner projection
    // + PATCH only) and the PUBLIC `displayName` (both projections; backend masks the default). `name` is
    // absent on the public read (and on older API responses) → "", never fabricated; `displayName` (which
    // the backend always resolves) feeds the public-facing avatar `initial`.
    name: profile.name ?? "",
    displayName: profile.displayName,
    isManager: profile.isManager,
    initial: deriveInitial(profile.displayName),
    // Avatar image URL <- the backend `avatarUrl` (POO-580 media mint persists it via PATCH /users/me);
    // null (never uploaded) -> "" so the UI falls back to `initial`. Renders a persisted avatar on reload.
    avatar: profile.avatarUrl ?? "",

    // Referral code + joined count — from the pp-api referral read (POO-661: authoritative source, not
    // the analytics rewards read). `code` is null until created → empty string; empty/zero when absent.
    referralCode: referral?.code ?? "",
    referralJoined: referral?.friendsJoined ?? 0,
    // Quacks — from the analytics rewards read (POO-426), zero when absent.
    quacks: Math.round(rewards?.quacks ?? 0),
    // PP-INTEGRATION-POINT (POO-652): no backend exposes a USD referral-earnings aggregate yet; kept 0
    // until the referral rewards backend surfaces it (POO-584). Never fabricated.
    referralEarned: 0,

    // Owner-only identity (POO-674/POO-675): `email`/`country`/`phone` come from the `/users/me` owner
    // projection, `null` -> `""`. On the PUBLIC shape (signed-out / owner-read fallback) these keys are
    // `undefined`, so the same `?? ""` yields `""` without fabricating anything.
    email: profile.email ?? "",
    country: profile.country ?? "",
    phone: profile.phone ?? "",
    // No backend source — `username` was removed from the UI (POO-675) and there is no email-verification
    // backend, so both stay empty/false, never fabricated.
    emailVerified: false,
    username: "",
  };
}
