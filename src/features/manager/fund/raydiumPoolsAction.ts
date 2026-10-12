/**
 * @id PP-MGR-CMP-107
 * @name raydiumPoolsAction
 * @description Server action: the Raydium CLMM pools for a Solana token, from DEX Screener.
 * @linear https://linear.app/yeildbay/issue/POO-2343
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, a data adapter.
 *
 * The browser calls this action. The action calls DEX Screener from the server (R1). The result is
 * serializable and typed, so the Pools step can show its error state with Retry (R5).
 *
 * PP-INTEGRATION-POINT: DEX Screener read. POO-2344 moves it into the Pool Party API.
 */
"use server";
import type { RaydiumPoolsResult } from "./raydiumPools";
import { readRaydiumPools } from "./raydiumPoolsRead";

/** A server action is a public endpoint, so the input is `unknown` until `readRaydiumPools` checks it. */
export async function getRaydiumPoolsAction(input: unknown): Promise<RaydiumPoolsResult> {
  return readRaydiumPools(input);
}
