/**
 * @id PP-MGR-MOD (POO-312)
 * @name Close-pool build-tx action
 * @implements-rules-version v2
 *
 * Server Action that asks pool-party-api to build the close-pool transaction for a manager closing
 * their strategy. The wallet is derived from the SIWE session (POO-270) + Bearer. Returns the built
 * tx for the client to sign + send, or null when not signed in.
 *
 * POO-475: the action never throws across the RSC boundary. It returns a {@link BuildTxResult}
 * ({ ok: true, tx } | { ok: false, code, message }); the not-signed-in case is SESSION_MISSING and
 * upstream failures keep their code so `classifyTxError` can act on them in production.
 *
 * POO-509 (v2): a close ALWAYS returns the token pair — `swapAllToStableCurrency` is hard-set to
 * `false` and is not accepted as input, so no caller can re-trigger the backend's close-pool fee→USDC
 * swap, which reverts with "Too little received" (its fee-swap min-out is mis-computed). This matches
 * v1 (which disables the "Close as USDC" button entirely, `pool-party-interface` `close-pool/modal.tsx`).
 * POO-804 R1 (decision #12) VOIDS the old plan to re-enable close-as-USDC once the backend fee-swap
 * min-out is fixed: the whole manager remove family is pair-only by product rule now, so
 * `swapAllToStableCurrency` stays hard-false regardless of the backend fix.
 *
 * PP-INTEGRATION-POINT (POO-475): close-pool calldata ← pool-party-api POST /portfolio/build/close-pool-tx.
 */
"use server";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { type BuildTxResult, buildTxFailure } from "@/lib/tx/actionResult";
import { builtTxSchema } from "@/lib/tx/builtTxSchema";

/** Defensive slippage tolerance (percent) when the caller omits one (POO-463 R3). */
const DEFAULT_SLIPPAGE = 1;

/**
 * Build the close-pool transaction for the signed-in manager (POO-475). Returns typed data, never
 * throws: SESSION_MISSING when not signed in, the upstream failure code otherwise. POO-509: the close
 * always builds the token pair (`swapAllToStableCurrency: false`, hard-set).
 */
export async function buildClosePoolTxAction(input: {
  positionId: string;
  network: string;
  slippageTolerance?: number;
}): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    const tx = await apiFetch("portfolio/build/close-pool-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
        // POO-509: hard-set to false — a close always returns the token pair (see the file header).
        // Close-as-USDC is disabled until the backend fee→USDC swap min-out is fixed.
        swapAllToStableCurrency: false,
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
