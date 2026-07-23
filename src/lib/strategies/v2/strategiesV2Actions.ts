/**
 * @id PP-STR-LIB-005 (POO-638) · PP-STR-LIB-006 (POO-308 · POO-868)
 * @name strategiesV2Actions
 * @implements-rules-version v1 (POO-308) · signature drop: POO-868 v2
 *
 * The `"use server"` bridge for the v2 strategy seam.
 *
 * POO-638 (read): {@link readStrategyOnchainBlocksAction} is the observe-only onchain-block read the
 * client-side convergence poll ({@link usePostWriteRefresh}) calls. Data access is server-only, so the
 * client cannot call {@link fetchStrategyV2ById} directly; this thin action is the seam. [R3]
 * Observe-only — it never writes; a failed or 404 read maps to `null` so the comparator treats that
 * strategy as "not yet converged" and the poll retries or caps rather than throwing into the success UI.
 *
 * POO-308 (write, POO-868 rules-v2): {@link createStrategyMetadataAction} posts the metadata to the
 * session-guarded `POST /api/v2/strategies` (pre-tx, returns the pending strategyId, [R1]) with the
 * session Bearer read server-side from the httpOnly cookie (`getAuthHeader` — never a client-supplied
 * header), and busts the v2 catalog cache. The API verifies the SIWE session JWT and takes the manager
 * wallet from its `address` claim, so no per-write wallet signature is asked.
 *
 * POO-868 (post-onchain writes): {@link confirmStrategyOnchainAction} and
 * {@link recordLiquidityEventAction} post a plain `{txHash, network}` — NO client identity at all. The
 * user already signed the referenced tx on-chain; the API derives the caller identity from the receipt
 * itself.
 */
"use server";

import { revalidateTag } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { getAuthHeader } from "@/lib/auth/session";
import { fetchStrategyV2ById, STRATEGIES_V2_CACHE_TAG } from "./fetchStrategiesV2";
import {
  createStrategyResponseSchema,
  readStrategyId,
  type StrategyMetadataInput,
  type StrategyTxRefBody,
} from "./strategyMetadataSchema";

/**
 * Fan-out cap per call. This action is client-invokable and issues one upstream GET per id via
 * `Promise.all` against the shared per-API-key throttle bucket (20 req / 60s). A large id list from a
 * buggy or hostile caller could drain that bucket in a single tick and starve every other server read,
 * so the fan-out is bounded to the first {@link MAX_ONCHAIN_BLOCK_READS} ids. Real convergence sets are
 * tiny (a single write touches one, or a few, strategies), so the cap only trims pathological inputs.
 */
const MAX_ONCHAIN_BLOCK_READS = 10;

/**
 * Parse the wire `onchain.blockNumber` (a decimal STRING, e.g. `'215000000'`, from the refresher's
 * bigint column) into the number `blockConvergence` compares against the mined receipt block. A
 * null/absent/garbled value resolves to `null` (the comparator then treats the strategy as not yet
 * converged). Restores POO-638 determinism: the old `z.number()` schema rejected the string, so every
 * read threw → was swallowed to `null` → convergence always exhausted the 45s cap instead of firing.
 */
function parseOnchainBlock(block: string | null | undefined): number | null {
  // `Number("")`/`Number("  ")` are 0 (finite), so an empty string must be rejected explicitly —
  // a blank checkpoint is "not indexed", never block 0.
  if (block == null || block.trim() === "") return null;
  const parsed = Number(block);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the current indexed `onchain.blockNumber` for each strategy id, keyed by id. A missing/never
 * -refreshed strategy or a failed read resolves to `null`. The id list is capped to the first
 * {@link MAX_ONCHAIN_BLOCK_READS} (throttle safety); it trims rather than throws, staying observe-only.
 */
export async function readStrategyOnchainBlocksAction(
  strategyIds: string[],
): Promise<Record<string, number | null>> {
  const capped = strategyIds.slice(0, MAX_ONCHAIN_BLOCK_READS);
  const entries = await Promise.all(
    capped.map(async (id): Promise<[string, number | null]> => {
      try {
        const strategy = await fetchStrategyV2ById(id);
        return [id, parseOnchainBlock(strategy?.onchain?.blockNumber)];
      } catch {
        return [id, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * [R1] POST the pre-tx metadata to the session-guarded `POST /api/v2/strategies` with the session
 * Bearer (POO-868: the manager wallet is the verified JWT claim — no per-write signature). Returns
 * the freshly-minted `strategyId` (status `pending_onchain`), or `null` when the response carries no
 * id ([R5]: a shapeless response degrades rather than throwing into the launch flow). Busts the v2
 * catalog cache on success. An upstream error (including 401 when signed out) propagates so the
 * caller can surface a retry.
 *
 * PP-INTEGRATION-POINT (POO-308): create-pool strategy metadata -> pool-party-api `POST /api/v2/strategies`.
 */
export async function createStrategyMetadataAction(
  body: StrategyMetadataInput,
): Promise<string | null> {
  const response = await apiFetch("strategies", {
    method: "POST",
    apiVersion: "v2",
    body,
    headers: await getAuthHeader(),
    schema: createStrategyResponseSchema,
  });
  const strategyId = readStrategyId(response);
  if (strategyId) revalidateTag(STRATEGIES_V2_CACHE_TAG);
  return strategyId;
}

/**
 * [R3] POST the mined tx hash to `POST /api/v2/strategies/:id/confirm` (post-mine). The API binds the
 * chain identity from the `PositionCreated` log — including the manager identity (POO-868: no signed
 * envelope; the receipt is the proof) — and flips the strategy to `live` (idempotent on txHash). Busts
 * the v2 catalog cache. An upstream error propagates ([R5]: the on-chain pool already exists — the
 * caller retries the confirm, never re-mints).
 *
 * PP-INTEGRATION-POINT (POO-308): create-pool confirm -> pool-party-api `POST /api/v2/strategies/:id/confirm`.
 */
export async function confirmStrategyOnchainAction(
  strategyId: string,
  body: StrategyTxRefBody,
): Promise<void> {
  await apiFetch(`strategies/${strategyId}/confirm`, {
    method: "POST",
    apiVersion: "v2",
    body,
  });
  revalidateTag(STRATEGIES_V2_CACHE_TAG);
}

/**
 * POO-719 (rules-v2): POST the confirmed tx hash to `POST /api/v2/strategies/:ref/liquidity-event`
 * after an add / remove / withdraw / close confirms on-chain. The API decodes the receipt server-side
 * (the event KIND and the wallet attribution are never client-chosen — POO-868: no signed envelope),
 * values it in USD and appends the immutable `strategy_liquidity_events` row that powers the
 * "Invested" cost basis. `strategyRef` accepts the strategy uuid OR the on-chain positionId (the
 * investor app holds positionId as the strategy identity, POO-216 D1). Idempotent upstream on
 * (txHash, logIndex) ([R9]); fee-collect receipts record nothing ([R8]) so collect flows never call
 * this. Callers treat this as FIRE-AND-FORGET: a failure must never block or fail the user's
 * operation (the POO-822 reconciliation sweep heals dropped writes).
 *
 * PP-INTEGRATION-POINT (POO-719): liquidity-event ledger callback -> pool-party-api
 * `POST /api/v2/strategies/:ref/liquidity-event`.
 */
export async function recordLiquidityEventAction(
  strategyRef: string,
  body: StrategyTxRefBody,
): Promise<void> {
  await apiFetch(`strategies/${strategyRef}/liquidity-event`, {
    method: "POST",
    apiVersion: "v2",
    body,
  });
}
