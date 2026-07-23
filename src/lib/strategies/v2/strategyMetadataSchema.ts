/**
 * @id PP-STR-LIB-006 (POO-308 · POO-868)
 * @name strategy-metadata write contract
 * @implements-rules-version v1 (POO-308) · signature drop: POO-868 v2
 *
 * The request payload + response contract for the pool-party-api v2 strategy WRITE path (POO-308,
 * ADR POO-585): the pre-tx metadata create (`POST /api/v2/strategies`) and the post-mine confirm
 * (`POST /api/v2/strategies/:id/confirm`). POO-868 rules-v2: NEITHER asks for a per-write wallet
 * signature. The create authenticates via the SIWE session Bearer (the manager proved wallet
 * ownership at sign-in and signs the mint right after); the confirm follows the mint tx the manager
 * already signed on-chain, so the API derives the manager from the receipt.
 *
 * The create returns the freshly-minted `strategyId` (status `pending_onchain`); the confirm binds
 * the chain identity from the `PositionCreated` log and flips the strategy to `live`.
 *
 * The field names + shapes MIRROR the deployed pool-party-api v2 write DTOs (POO-579, confirmed against
 * `src/strategies/dto/create-strategy.dto.ts` + `confirm-strategy.dto.ts`): `riskLevel` is the
 * `RiskProfile` enum (`@IsIn(['steady','dynamic','wild'])`), `managerFee` is a TOP-LEVEL integer in
 * basis points (`@IsInt @Min(0) @Max(10000)`), `logoUrl` is an https-only URL (`@IsUrl`, so a `data:`
 * preview is omitted, never sent), and the confirm body carries `network`. The global `whitelist: true`
 * ValidationPipe strips any unknown key, so only these fields persist. `readStrategyId` tolerates either
 * `strategyId` or `id` on the response so a naming drift degrades to null rather than throwing.
 */
import { z } from "zod";
import type { ObjectiveTag, StrategyAccess } from "@/lib/schemas";
import type { RiskProfile } from "@/lib/strategies/riskProfile";

/**
 * The stable, locale-independent category enum persisted as canonical backend data. It mirrors the
 * mandate's derived `categoryKey`. The FE MUST send this key (never a localized label), so the shared
 * backend copy stays locale-invariant; every surface localizes it at render via the `mandate.category*`
 * i18n keys (Cards-perks regression class: never persist locale-variant copy as shared data).
 */
export type StrategyCategory = "stable" | "blueChip" | "volatile";

/** The metadata create payload (`POST /api/v2/strategies`), pre-tx. */
export interface StrategyMetadataInput {
  /** Strategy display name. */
  name: string;
  /** Optional plain-language thesis; null when the manager leaves it blank. */
  description: string | null;
  /**
   * Optional https logo URL. Omitted (key absent) unless it is a real remote https URL — a local
   * `data:` crop preview is never sent (the DTO's `@IsUrl({ protocols: ['https'] })` would 400 the
   * whole create). Real logo persistence (upload -> https URL) is sequenced separately.
   */
  logoUrl?: string;
  /** Auto-derived stable category enum (from the mandate); localized at render, never persisted as copy. */
  category: StrategyCategory;
  /**
   * Auto-derived OBJECTIVE tags (POO-830 R3/R4/R7), computed at creation from the manager's mint
   * composition. Persisted here because the objective is NOT derivable from the pair on the investor
   * read (unlike `assetTags`), so the backend must store + serve it. Rides the existing signed
   * metadata POST; the deployed DTO's `whitelist: true` ValidationPipe STRIPS this unknown key until
   * the backend adds the column (harmless), so nothing is persisted server-side yet.
   * PP-INTEGRATION-POINT (POO-830 R7): the backend persists `objectiveTags` on create and serves it on
   * the investor strategy read (see the seam in `mapStrategyV2`), tracked by POO-836.
   */
  objectiveTags: ObjectiveTag[];
  /** Risk profile enum classified from the pool's token pair; the DTO validates the same enum. */
  riskLevel: RiskProfile;
  /**
   * Performance fee in BASIS POINTS (0-10000), sent top-level — the deployed DTO's `managerFee`
   * (`@IsInt @Min(0) @Max(10000)`). Entry / exit / management are V1-locked to 0 server-side by design.
   */
  managerFee: number;
  /** Access model (V1: `public`). */
  access: StrategyAccess;
}

/**
 * The create response. Only the id is modeled (either key is accepted); the rest passes through so a
 * richer echo (name, status, ...) never fails the parse.
 */
export const createStrategyResponseSchema = z
  .object({
    strategyId: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();

/** The parsed create response. */
export type CreateStrategyResponse = z.infer<typeof createStrategyResponseSchema>;

/** Read the created strategy id off the response, tolerating either key; null when neither present. */
export function readStrategyId(response: CreateStrategyResponse | null): string | null {
  return response?.strategyId ?? response?.id ?? null;
}

/**
 * The plain (unsigned, POO-868) tx-reference body for the post-onchain writes: the confirm
 * (`POST /api/v2/strategies/:id/confirm`) and the liquidity-event ledger callback
 * (`POST /api/v2/strategies/:ref/liquidity-event`). Both fields are DTO-required (`network` is
 * `@IsIn(SUPPORTED_NETWORKS)`); everything else is derived server-side from the receipt.
 */
export interface StrategyTxRefBody {
  txHash: string;
  network: string;
}
