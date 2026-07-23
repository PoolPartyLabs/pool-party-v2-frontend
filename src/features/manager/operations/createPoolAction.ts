/**
 * @id PP-MGR-SCR-002 (POO-306)
 * @name Create-pool build-tx action
 * @implements-rules-version v2
 *
 * Server Action that asks pool-party-api to build the create-pool transaction from a signed
 * Permit2 batch. The wallet is derived from the SIWE session (POO-270) + Bearer. Returns the built
 * tx for the client to sign + send, or null when not signed in.
 *
 * POO-475: the action never throws across the RSC boundary. It returns a {@link BuildTxResult}
 * ({ ok: true, tx } | { ok: false, code, message }); the not-signed-in case is SESSION_MISSING and
 * upstream failures (incl. the pre-flight UNSUPPORTED_NETWORK / POOL_NOT_FOUND ApiErrors) keep their
 * code so `classifyTxError` can act on them in production.
 *
 * PP-INTEGRATION-POINT (POO-475): create-pool calldata ← pool-party-api POST /portfolio/build/create-pool-tx.
 *
 * POO-547: the server-side slippage clamp now uses the shared SLIPPAGE_MAX (100), not the old
 * create-pool 5% cap, so the uniform 0.1-100% UI range reaches the build. PP-INTEGRATION-POINT
 * (POO-551): confirm with Rafael the build endpoint accepts up to 100%.
 *
 * POO-878 rules v1 (@implements-rules-version: v1 for POO-878): the optional `wrappedNativeFunding`
 * ('native' | 'erc20') rides the build body so the API can set `tx.value` for the wrapped-native leg
 * (WETH/WPOL) to match the FE-selected source. The API half (portfolio.service.ts) is a separate
 * pool-party-api change — marked at the seam below; omitted keeps the API's native default.
 */
"use server";

import { CREATE_POOL_DEFAULT_SLIPPAGE_PCT, SLIPPAGE_MAX } from "@/features/strategies/lib/slippage";
import { ApiError, apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { networkToChainId } from "@/lib/chains/config";
import { fetchDexPoolState } from "@/lib/manager/dexPoolState";
import { mintAmountsWithSlippage } from "@/lib/manager/mintAmounts";
import { type BuildTxResult, buildTxFailure } from "@/lib/tx/actionResult";
import { builtTxSchema } from "@/lib/tx/builtTxSchema";
import type { SerializedPermitBatch } from "@/lib/tx/permit2";
import type { WrappedNativeFunding } from "../lib/seedAmounts";

/**
 * Defensive slippage tolerance (percent) when the caller omits one: the shared create-pool default
 * (POO-525 R1, was 1% under POO-463 R3), aligned with the Review gear seed + useCreatePool.
 */
const DEFAULT_SLIPPAGE = CREATE_POOL_DEFAULT_SLIPPAGE_PCT;

/**
 * Prospectus visibility flags the API requires on `featureSettings` (it reads them directly).
 * The manager console has no hide toggles yet, so the strategy shows everything (all true).
 * PP-INTEGRATION-POINT: expose hidden-field toggles in the builder when the design lands.
 */
const SHOW_ALL_HIDDEN_FIELDS = {
  showPriceRange: true,
  showTokenPair: true,
  showInOutRange: true,
} as const;

/** Strategy identity + manager fee carried into create-pool. */
export interface CreatePoolFeatureSettings {
  name: string;
  description: string | null;
  poolManagerFee: number;
}

/** Input for {@link buildCreatePoolTxAction}. */
export interface CreatePoolInput {
  network: string;
  feeTier: number;
  /** token0 / token1 (pool currency) addresses — used to read the pool state for the mint mins. */
  currency0: string;
  currency1: string;
  tickLower: number;
  tickUpper: number;
  /** Seed amounts in raw token units (wei), as decimal strings. */
  amount0: string;
  amount1: string;
  permitBatch: SerializedPermitBatch;
  signature: string;
  slippageTolerance?: number;
  featureSettings: CreatePoolFeatureSettings;
  /**
   * POO-878 [R5]: how the pool's wrapped-native leg (WETH/WPOL) is funded — `"native"` sends the
   * native coin as `msg.value`, `"erc20"` pulls the wrapped token via Permit2 (`tx.value = 0`).
   * Optional: omitted defaults to the API's native behavior (back-compat). Only meaningful when the
   * pool contains the chain's wrapped-native token.
   */
  wrappedNativeFunding?: WrappedNativeFunding;
}

/**
 * Build the create-pool transaction for the signed-in wallet. Computes position-aware mint mins
 * server-side (POO-315): reads the pool state and runs the Uniswap SDK's `mintAmountsWithSlippage`,
 * keeping the SDK out of the browser bundle. Not signed in → null.
 */
export async function buildCreatePoolTxAction(input: CreatePoolInput): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    // PP-SECURITY: clamp the caller's slippage to the shared UI ceiling server-side, so a tampered
    // client cannot push the mint-min slippage above the max the UI accepts and take a worse fill.
    // POO-547: the ceiling is now the uniform SLIPPAGE_MAX (100), not the old create-pool 5% cap.
    // PP-INTEGRATION-POINT (POO-551): the pool-party-api create-pool build must accept up to 100%
    // slippage too (it previously assumed the 5% interim); verifying with Rafael — add a [BE] note
    // here if the server rejects > 5%.
    const slippage = Math.min(
      Math.max(input.slippageTolerance ?? DEFAULT_SLIPPAGE, 0),
      SLIPPAGE_MAX,
    );
    const authHeader = await getAuthHeader();

    // Position-aware mint mins from the pool's current state (the API trusts these + haircuts again).
    const chainId = networkToChainId(input.network);
    if (!chainId) {
      throw new ApiError(400, "UNSUPPORTED_NETWORK", `Unsupported network: ${input.network}`);
    }
    const state = await fetchDexPoolState(
      input.network,
      input.currency0,
      input.currency1,
      input.feeTier,
      authHeader,
    );
    if (!state) {
      throw new ApiError(404, "POOL_NOT_FOUND", "Could not read the pool state for the mint mins");
    }
    const { amount0Min, amount1Min } = mintAmountsWithSlippage(
      state,
      chainId,
      input.tickLower,
      input.tickUpper,
      input.amount0,
      input.amount1,
      slippage,
    );

    const tx = await apiFetch("portfolio/build/create-pool-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        feeTier: input.feeTier,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        permitBatch: input.permitBatch,
        signature: input.signature,
        amount0Min,
        amount1Min,
        slippageTolerance: slippage,
        // PP-INTEGRATION-POINT (POO-878 [BE half]): the pool-party-api create-pool build must honor
        // `wrappedNativeFunding` when setting `tx.value` (portfolio.service.ts:561-571): keep the
        // native msg.value for "native", set `nativeTokenAmount = 0` for "erc20" so the contract's
        // `Core.transferETHOrToken` Permit2 fallback pulls the wrapped token. On Polygon the same
        // field must win over the broken `getWETHContract('polygon')` sentinel (POO-882). Omitted =>
        // the API keeps its native default. `buildCreatePositionParamsHash` excludes value, so no
        // re-sign is needed when the value flips.
        ...(input.wrappedNativeFunding ? { wrappedNativeFunding: input.wrappedNativeFunding } : {}),
        featureSettings: {
          name: input.featureSettings.name,
          // The API validates `description` as a string (null would 400) and the service coalesces
          // empty — send "" rather than null when the manager leaves it blank.
          description: input.featureSettings.description ?? "",
          poolManagerFee: input.featureSettings.poolManagerFee,
          hiddenFields: SHOW_ALL_HIDDEN_FIELDS,
        },
      },
      schema: builtTxSchema,
      network: input.network,
      headers: authHeader,
    });
    if (!tx) {
      return { ok: false, code: "SYSTEM_INTERNAL", message: "Build returned no transaction" };
    }
    return { ok: true, tx };
  } catch (error) {
    return buildTxFailure(error);
  }
}
