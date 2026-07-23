/**
 * @id PP-MGR-LIB-015 (POO-771)
 * @name embedded manager identity schema
 * @implements-rules-version v1 · v1 (POO-798: verified badge gated on managerVerification enum)
 *
 * The PUBLIC manager identity the pool-party-api now embeds ON the strategy catalog v2 rows and on the
 * portfolio position rows (POO-758), so the FE renders `@handle`, avatar and the verified badge at
 * every attribution site with ZERO extra requests (retires the PR #512 per-manager registry fan-out).
 *
 * Shape mirrors the backend `manager` object exactly (POO-758 R1/R3): `handle`, `displayName`,
 * `avatarUrl` are nullable strings. `managerVerification` is the account-verification enum
 * (`none | pending | valid`, POO-745) and — as of POO-798 — the SINGLE badge source: the strategy
 * mappers derive `managerVerified` from `managerVerification === "valid"`, retiring the legacy derived
 * `verified` boolean (still emitted alongside for now, kept for contract parity). The whole object is
 * `null` when no registry profile matches the manager wallet (R4, never fabricated).
 *
 * Drift tolerance (POO-569/POO-698 lesson): every field is `.nullish()` and the object is
 * `.passthrough()`, so an older backend that omits a field (or the whole object) NEVER fails Zod and
 * never blanks a working screen. The `.nullish()` at the USE SITE (`.nullish()` on the object) keeps
 * `manager` optional on both the v2 strategy row and the portfolio position row.
 *
 * PP-INTEGRATION-POINT (POO-758): `manager` embedded object ← pool-party-api v2 strategy catalog +
 * detail (`GET /api/v2/strategies(/:id)`) and portfolio positions (`GET /api/v1/portfolio/:wallet`).
 */
import { z } from "zod";
import { managerVerificationStatusSchema } from "@/lib/schemas";

/** The public manager identity embedded per strategy row / per position (POO-758). */
export const embeddedManagerIdentitySchema = z
  .object({
    /** The manager's public-profile handle (drives `@handle` attribution + `/m/<handle>`). */
    handle: z.string().nullish(),
    /** The manager's display name. Never rendered in attributions (POO-757 R1); kept for contract parity. */
    displayName: z.string().nullish(),
    /** The manager's avatar URL (https CDN). Null for a manager whose avatar is unset (POO-702). */
    avatarUrl: z.string().nullish(),
    /**
     * POO-798 R2: the manager's account-verification status enum (`none | pending | valid`, POO-745) —
     * the SINGLE badge source. The mapper gates `managerVerified` on `=== "valid"`. `.nullish()` so an
     * older backend that omits it degrades to not-verified (R4), never crashing.
     */
    managerVerification: managerVerificationStatusSchema.nullish(),
    /**
     * Legacy derived verified boolean (true only for the `valid` enum, POO-744/745). SUPERSEDED as the
     * badge source by `managerVerification` (POO-798); still emitted by the backend for now, kept for
     * contract parity. Do not read this for the badge.
     */
    // PP-TODO(POO-809): remove once the backend drops the legacy field from the embed
    verified: z.boolean().nullish(),
  })
  .passthrough();

/** The embedded public manager identity. */
export type EmbeddedManagerIdentity = z.infer<typeof embeddedManagerIdentitySchema>;
