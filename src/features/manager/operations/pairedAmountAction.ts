/**
 * @id PP-MGR (POO-306)
 * @name pairedAmountAction
 * @implements-rules-version v1
 *
 * Server Action behind the create-pool seed inputs: given the amount the manager typed, derive the
 * paired token's amount for the chosen tick range at the pool's current price. Runs server-side so
 * the Uniswap v3 SDK (Position math) never enters the browser bundle. The pool-state read is briefly
 * cached because it fires on every amount edit; the final mint (buildCreatePoolTxAction) re-reads
 * fresh state and applies slippage.
 *
 * PP-INTEGRATION-POINT: pool state ← pool-party-api single dex-pool (via fetchDexPoolState).
 */
"use server";

import { getAuthHeader } from "@/lib/auth/session";
import { networkToChainId } from "@/lib/chains/config";
import { fetchDexPoolState } from "@/lib/manager/dexPoolState";
import {
  type IndependentField,
  pairedSeedAmounts,
  type ResolvedSeedAmounts,
} from "@/lib/manager/pairedAmount";

/** Cache window for the live quote's pool-state read (seconds). */
const QUOTE_STATE_REVALIDATE = 15;

/** Input for {@link quotePairedSeedAmountAction}. Amounts/addresses are raw (wei / token address). */
export interface PairedAmountInput {
  network: string;
  currency0: string;
  currency1: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  /** Which seed the manager typed (0 or 1); the other is derived. */
  independentField: IndependentField;
  /** The typed amount in raw token units (wei). */
  independentAmount: string;
}

/**
 * Derive both resolved seed amounts from the manager's input. Returns null when the network is
 * unsupported or the pool state can't be read (the caller leaves the inputs untouched).
 */
export async function quotePairedSeedAmountAction(
  input: PairedAmountInput,
): Promise<ResolvedSeedAmounts | null> {
  const chainId = networkToChainId(input.network);
  if (!chainId) return null;

  const state = await fetchDexPoolState(
    input.network,
    input.currency0,
    input.currency1,
    input.feeTier,
    await getAuthHeader(),
    QUOTE_STATE_REVALIDATE,
  );
  if (!state) return null;

  return pairedSeedAmounts(
    state,
    chainId,
    input.tickLower,
    input.tickUpper,
    input.independentField,
    input.independentAmount,
  );
}
