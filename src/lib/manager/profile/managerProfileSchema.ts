/**
 * @id PP-MGR-LIB-004 (POO-579 · POO-576 · POO-582 · POO-637)
 * @name managerProfileSchema
 * @implements-rules-version v1
 *
 * The client+server-safe contract for the deployed pool-party-api manager-profile registry
 * (`/api/v1/managers`, POO-576 + POO-582). Three pure pieces, no `server-only`/`use client` boundary
 * so the read module, the `"use server"` actions AND the client write hook can all share them:
 *
 * - {@link apiManagerProfileSchema}: Zod for the `ManagerProfileResponseDto` the backend returns.
 * - {@link mapManagerProfile}: maps that response 1:1 onto the FE {@link ManagerProfile}
 *   (`walletAddress`->address, `displayName`->name, nullable image/socials -> optional). The derived
 *   FE fields the registry does NOT own — `sinceLabel` (composed from `createdAt`) and `stats` (the
 *   strategies-aggregation, POO-579 separate wave) — are composed here; `stats` defaults to zeros and
 *   a caller with the manager's strategies overrides it ({@link computeManagerStats}).
 * - {@link buildManagerProfileBody} + {@link MANAGER_UPDATE_ACTION}: the write payload for
 *   `PATCH /managers/me` and the signed-write action name. The wallet is bound by the POO-637
 *   signature (never the body). The body is the exact bytes whose sha256 is signed, so the builder is
 *   deterministic.
 *
 * PP-INTEGRATION-POINT (POO-579): manager-profile registry response + write contract
 * (`GET/PATCH /api/v1/managers`), mirrors pp-api `manager-profile-response.dto.ts` +
 * `update-manager-profile.dto.ts`.
 */
import { z } from "zod";
import {
  type ManagerProfile,
  type ManagerSocials,
  managerVerificationStatusSchema,
} from "@/lib/schemas";
import type { UpdateManagerProfileInput } from "@/lib/services";

/** The signed-write action name the `@SignedWrite('manager.update')` guard on `PATCH /managers/me` declares. */
export const MANAGER_UPDATE_ACTION = "manager.update";

/** The five social columns the registry persists (POO-582). Instagram is NOT one of them (POO-593). */
const apiManagerSocialsSchema = z.object({
  x: z.string().nullable(),
  telegram: z.string().nullable(),
  discord: z.string().nullable(),
  youtube: z.string().nullable(),
  website: z.string().nullable(),
});

/** Zod for the deployed `ManagerProfileResponseDto` (pp-api `manager-profile-response.dto.ts`). */
export const apiManagerProfileSchema = z.object({
  /** The manager's wallet address (primary key, lowercased server-side). */
  walletAddress: z.string(),
  /** URL handle (case-folded slug); empty until the first save claims it. */
  handle: z.string(),
  /** Whether the handle is locked (true once claimed on the first save). */
  handleLocked: z.boolean(),
  /** Display name; empty until set. */
  displayName: z.string(),
  /** Short bio; empty until set. */
  bio: z.string(),
  /** Hosted avatar URL (https), or null when unset. */
  avatarUrl: z.string().nullable(),
  /** Hosted banner URL (https, 16:9), or null when unset. */
  bannerUrl: z.string().nullable(),
  /**
   * POO-745 / POO-744: account-verification status (`none|pending|valid`); `valid` drives the badge.
   * TOLERANT (`.nullish()`) because POO-744 is not deployed yet — the current live projection omits it,
   * and a required field would fail the whole read (the portfolio-schema-drift failure class). The
   * mapper defaults an absent/null value to `none`. The secret one-time code is NEVER on this read.
   */
  managerVerification: managerVerificationStatusSchema.nullish(),
  /** The five persisted social links (each nullable). */
  socials: apiManagerSocialsSchema,
  /** ISO timestamps. */
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** The deployed manager-profile registry response. */
export type ApiManagerProfile = z.infer<typeof apiManagerProfileSchema>;

/** The headline stats shown on the public profile (not owned by the registry — composed FE-side). */
export type ManagerStats = ManagerProfile["stats"];

/** Zeroed stats — the default until a caller composes them from the manager's strategies. */
export const EMPTY_MANAGER_STATS: ManagerStats = { aum: 0, investors: 0, strategies: 0, avgApy: 0 };

/**
 * Compose the human "managing since" label from the registry `createdAt`, e.g. `2024-... -> "Since
 * 2024"`. An empty / unparseable timestamp yields `""` (the public screen hides the label when empty).
 * Kept English-as-data, matching the mock fixture convention (the label is DATA, not translated copy).
 */
export function deriveSinceLabel(createdAt: string): string {
  if (!createdAt) return "";
  const year = new Date(createdAt).getFullYear();
  return Number.isFinite(year) ? `Since ${year}` : "";
}

/** A nullable registry social value -> the FE optional (a null/empty link is hidden, so `undefined`). */
function socialOrUndefined(value: string | null): string | undefined {
  return value ?? undefined;
}

/**
 * Map the registry response onto the FE {@link ManagerProfile}. `sinceLabel` is composed from
 * `createdAt`; `stats` defaults to zeros — a caller that has the manager's strategies passes real
 * `stats` (see {@link computeManagerStats}). Nullable image/social columns collapse to the FE optional.
 */
export function mapManagerProfile(
  api: ApiManagerProfile,
  stats: ManagerStats = EMPTY_MANAGER_STATS,
): ManagerProfile {
  const socials: ManagerSocials = {
    x: socialOrUndefined(api.socials.x),
    telegram: socialOrUndefined(api.socials.telegram),
    discord: socialOrUndefined(api.socials.discord),
    youtube: socialOrUndefined(api.socials.youtube),
    website: socialOrUndefined(api.socials.website),
  };
  return {
    handle: api.handle,
    handleLocked: api.handleLocked,
    address: api.walletAddress,
    name: api.displayName,
    avatarUrl: api.avatarUrl ?? undefined,
    bio: api.bio,
    // POO-745 [R1]: default to `none` when the projection omits it (pre-POO-744 tolerance).
    managerVerification: api.managerVerification ?? "none",
    sinceLabel: deriveSinceLabel(api.createdAt),
    bannerUrl: api.bannerUrl ?? undefined,
    socials,
    stats,
  };
}

/** The five social keys the registry write accepts (POO-582). */
const WRITE_SOCIAL_KEYS = ["x", "telegram", "discord", "youtube", "website"] as const;

/** The `PATCH /managers/me` body (pp-api `UpdateManagerProfileDto`). The wallet is NOT a body field. */
export interface ManagerProfileWriteBody {
  /** Chosen handle; honored only on the first save (immutable once locked). Omitted on later saves. */
  handle?: string;
  /** Display name (<=60). */
  displayName?: string;
  /** Short bio (<=2000). */
  bio?: string;
  /** Hosted avatar URL (https only). */
  avatarUrl?: string;
  /** Hosted banner URL (https only). */
  bannerUrl?: string;
  /** The five social links; each empty string clears the link server-side (full-replace parity with the mock). */
  socials?: Record<(typeof WRITE_SOCIAL_KEYS)[number], string>;
}

/**
 * An https URL, or `undefined`. The registry rejects a non-https `avatarUrl`/`bannerUrl` (the DTO's
 * `@IsUrl({ protocols: ['https'] })`), so a non-https value must NOT be sent. An existing hosted https
 * URL passes through and re-persists idempotently.
 *
 * POO-694 wired the media mint: on crop-apply the Profile tab uploads the bytes to media storage
 * (presigned S3 POST, POO-580) and REPLACES the local `data:` value with the returned https `publicUrl`
 * before this write, so a fresh crop persists. This guard now only catches the failure edge — a crop
 * whose upload failed (still a `data:`/`blob:` value): it is dropped here (the manager saw the inline
 * upload-failed error), never leaking a broken URL into the PATCH.
 */
function httpsUrlOrUndefined(value: string | undefined): string | undefined {
  return value && /^https:\/\//i.test(value) ? value : undefined;
}

/**
 * Build the deterministic `PATCH /managers/me` body from the FE {@link UpdateManagerProfileInput} the
 * profile form produces. Field mapping: `name`->`displayName`; socials pass through the five columns
 * with `""` for an unset link (a full replace, matching the mock's `{...input.socials}` semantics so a
 * cleared link is actually cleared). `handleLocked` is dropped (server-derived; whitelisted off).
 * `avatarUrl`/`bannerUrl` are https-only ({@link httpsUrlOrUndefined}).
 */
export function buildManagerProfileBody(input: UpdateManagerProfileInput): ManagerProfileWriteBody {
  const body: ManagerProfileWriteBody = {};
  if (input.handle !== undefined) body.handle = input.handle;
  if (input.name !== undefined) body.displayName = input.name;
  if (input.bio !== undefined) body.bio = input.bio;

  const avatarUrl = httpsUrlOrUndefined(input.avatarUrl);
  if (avatarUrl !== undefined) body.avatarUrl = avatarUrl;
  const bannerUrl = httpsUrlOrUndefined(input.bannerUrl);
  if (bannerUrl !== undefined) body.bannerUrl = bannerUrl;

  if (input.socials !== undefined) {
    const socials = input.socials;
    body.socials = {
      x: socials.x ?? "",
      telegram: socials.telegram ?? "",
      discord: socials.discord ?? "",
      youtube: socials.youtube ?? "",
      website: socials.website ?? "",
    };
  }
  return body;
}
