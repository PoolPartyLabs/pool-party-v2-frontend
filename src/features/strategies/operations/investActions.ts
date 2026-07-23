/**
 * @id PP-STR-MOD-001 (POO-303)
 * @name Invest (add-liquidity) build-tx action
 * @implements-rules-version v1
 *
 * Server Action that asks pool-party-api to build the add-liquidity transaction from a signed
 * Permit2 authorization. The wallet is derived from the SIWE session (POO-270), never trusted
 * from the client, and the token is forwarded as a Bearer. Returns the built tx to sign + send.
 *
 * POO-475: the action never throws across the RSC boundary. It returns a {@link BuildTxResult}
 * ({ ok: true, tx } | { ok: false, code, message }); the not-signed-in case is SESSION_MISSING and
 * upstream failures keep their code so `classifyTxError` can act on them in production.
 *
 * PP-INTEGRATION-POINT (POO-475): add-liquidity calldata ← pool-party-api POST /portfolio/build/add-liquidity-tx.
 */
"use server";

import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { type BuildTxResult, buildTxFailure } from "@/lib/tx/actionResult";
import { builtTxSchema } from "@/lib/tx/builtTxSchema";
import type { SerializedPermitSingle } from "@/lib/tx/permit2";

/** Defensive slippage tolerance (percent) when the caller omits one (POO-463 R3). */
const DEFAULT_SLIPPAGE = 1;

/** Input for {@link buildAddLiquidityTxAction}. */
export interface AddLiquidityInput {
  /** The pool's positionId (the strategy id). */
  positionId: string;
  /** API network slug the pool lives on. */
  network: string;
  /** The signed Permit2 single (bigints serialized). */
  permit: SerializedPermitSingle;
  /** The Permit2 signature. */
  signature: string;
  /** The pool contract address (Universal Router routing on the "current" networks). */
  poolPartyPositionAddress?: string;
  /** Slippage tolerance in percent. Defaults to 1. */
  slippageTolerance?: number;
}

/**
 * Build the add-liquidity transaction for the signed-in wallet (POO-475). Returns typed data, never
 * throws: SESSION_MISSING when not signed in, the upstream failure code otherwise.
 */
export async function buildAddLiquidityTxAction(input: AddLiquidityInput): Promise<BuildTxResult> {
  const wallet = await getSessionWallet();
  if (!wallet) {
    return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
  }

  try {
    const tx = await apiFetch("portfolio/build/add-liquidity-tx", {
      method: "POST",
      body: {
        network: input.network,
        wallet,
        positionId: input.positionId,
        permit: input.permit,
        signature: input.signature,
        slippageTolerance: input.slippageTolerance ?? DEFAULT_SLIPPAGE,
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
