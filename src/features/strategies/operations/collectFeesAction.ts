/**
 * @id PP-STR-MOD-003 (POO-301)
 * @name Collect-fees build-tx action
 * @implements-rules-version v1
 *
 * Server Action that asks pool-party-api to build the collect-fees transaction. The wallet is
 * derived from the SIWE session (POO-270), never trusted from the client, and the session token
 * is forwarded as a Bearer. Returns the built tx for the client to sign + send, or null when not
 * signed in.
 *
 * POO-475: the action never throws across the RSC boundary. It returns a {@link BuildTxResult}
 * ({ ok: true, tx } | { ok: false, code, message }); the not-signed-in case is SESSION_MISSING and
 * upstream failures keep their code so `classifyTxError` can act on them in production.
 *
 * PP-INTEGRATION-POINT (POO-475): collect-fees calldata ← pool-party-api POST /portfolio/build/collect-fees-tx.
 */
"use server";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { type BuildTxResult, buildTxFailure } from "@/lib/tx/actionResult";
import { builtTxSchema } from "@/lib/tx/builtTxSchema";

/** Defensive slippage tolerance (percent) when the caller omits one (POO-463 R3). */
const DEFAULT_SLIPPAGE = 1;

/** Input for {@link buildCollectFeesTxAction}. */
export interface CollectFeesInput {
  /** The position (strategy) id whose fees are being collected. */
  positionId: string;
  /** API network slug the position lives on. */
  network: string;
  /** Slippage tolerance in percent. Defaults to 1. */
  slippageTolerance?: number;
  /** Pool address for Universal-Router routing (current networks only; omit on legacy). */
  poolPartyPositionAddress?: string;
  /**
   * Receive the collected fees as the raw token pair instead of swapping to USDC (POO-417 R2).
   * Maps to `shouldSwapFees = !collectAsTokenPair`; absent/false → swap to USDC (default).
   */
  collectAsTokenPair?: boolean;
}

/**
 * Build the collect-fees transaction for the signed-in wallet (POO-475). Returns typed data, never
 * throws: SESSION_MISSING when not signed in, the upstream failure code otherwise.
 */
export async function buildCollectFeesTxAction(input: CollectFeesInput): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    const tx = await apiFetch("portfolio/build/collect-fees-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
        // Swap the collected fees to USDC, unless the user chose to receive the raw token pair
        // (POO-417 R2). No swap (false) → the backend pays out token0/token1 directly.
        shouldSwapFees: !input.collectAsTokenPair,
        ...(input.poolPartyPositionAddress
          ? { poolPartyPositionAddress: input.poolPartyPositionAddress }
          : {}),
      },
      schema: builtTxSchema,
      network: input.network,
      headers: await getAuthHeader(),
    });
    if (!tx) {
      return { ok: false, code: "SYSTEM_INTERNAL", message: "Build returned no transaction" };
    }
    return { ok: true, tx };
  } catch (error) {
    return buildTxFailure(error);
  }
}
