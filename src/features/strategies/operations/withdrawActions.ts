/**
 * @id PP-STR-MOD-004 (POO-302)
 * @name Withdraw build-tx actions
 * @implements-rules-version v1
 *
 * Server Actions that ask pool-party-api to build the withdraw transactions. The wallet is
 * derived from the SIWE session (POO-270), never trusted from the client, and the token is
 * forwarded as a Bearer. A partial withdraw removes a percentage of liquidity; a full / closed
 * withdraw exits the position. Both return the built tx for the client to sign + send.
 *
 * POO-475: both actions never throw across the RSC boundary. Each returns a {@link BuildTxResult}
 * ({ ok: true, tx } | { ok: false, code, message }); the not-signed-in case is SESSION_MISSING and
 * upstream failures keep their code so `classifyTxError` can act on them in production.
 *
 * PP-INTEGRATION-POINT (POO-475): withdraw calldata ← pool-party-api POST /portfolio/build/{remove-liquidity,withdraw}-tx.
 */
"use server";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { type BuildTxResult, buildTxFailure } from "@/lib/tx/actionResult";
import { builtTxSchema } from "@/lib/tx/builtTxSchema";

/** Defensive slippage tolerance (percent) when the caller omits one (POO-463 R3). */
const DEFAULT_SLIPPAGE = 1;

/**
 * Build a partial-withdraw (remove-liquidity) transaction by percentage (1–100) (POO-475). Returns
 * typed data, never throws: SESSION_MISSING when not signed in, the upstream failure code otherwise.
 */
export async function buildRemoveLiquidityTxAction(input: {
  positionId: string;
  network: string;
  percentage: number;
  slippageTolerance?: number;
  /** Swap the removed fees/liquidity to the stable currency (default true). */
  shouldSwapFees?: boolean;
  /** Pool address for Universal-Router routing (current networks only; omit on legacy). */
  poolPartyPositionAddress?: string;
}): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    const tx = await apiFetch("portfolio/build/remove-liquidity-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        percentage: input.percentage,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
        shouldSwapFees: input.shouldSwapFees ?? true,
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

/**
 * Build a full-exit (withdraw) transaction for a full or already-closed position (POO-475). Returns
 * typed data, never throws: SESSION_MISSING when not signed in, the upstream failure code otherwise.
 */
export async function buildWithdrawTxAction(input: {
  positionId: string;
  network: string;
  slippageTolerance?: number;
  /** Swap the withdrawn liquidity/fees to the stable currency (default true; POO-481 R4). */
  shouldSwapFees?: boolean;
}): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    const tx = await apiFetch("portfolio/build/withdraw-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
        // POO-481 R4: default to swapping to the stable currency; the caller can opt out.
        shouldSwapFees: input.shouldSwapFees ?? true,
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
