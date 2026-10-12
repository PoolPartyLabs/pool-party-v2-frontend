/**
 * @id PP-MGR-CMP-107
 * @name raydiumPoolsRead
 * @description Reads the DEX Screener pairs of one Solana token and returns a typed result.
 * @linear https://linear.app/yeildbay/issue/POO-2343
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, a data adapter.
 *
 * Server code only. The browser never calls DEX Screener, so the CSP `connect-src` does not change
 * (R1). Only the server action `raydiumPoolsAction` imports this file.
 *
 * The read stops after 10 s (R5). A bad status, a timeout and a bad response shape each give a
 * typed failure. The function never throws.
 *
 * PP-INTEGRATION-POINT: DEX Screener public API `GET /token-pairs/v1/solana/{mint}`. POO-2344
 * moves this read into the Pool Party API.
 */
import {
  parseDexScreenerPairs,
  type RaydiumPoolsErrorCode,
  type RaydiumPoolsResult,
  raydiumPoolsFromPairs,
} from "./raydiumPools";

const DEXSCREENER_PAIRS_URL = "https://api.dexscreener.com/token-pairs/v1/solana";

/** R5: the longest wait for DEX Screener, in ms. */
export const RAYDIUM_READ_TIMEOUT_MS = 10_000;

/** A Solana mint is a base58 string of 32 to 44 characters. This also keeps the URL path safe. */
const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface RaydiumPoolsInput {
  /** The token of the Pools search. */
  tokenAddress: string;
  /** When present, each pool must hold both tokens. */
  secondTokenAddress?: string;
}

function failure(code: RaydiumPoolsErrorCode, status?: number): RaydiumPoolsResult {
  return { ok: false, error: status === undefined ? { code } : { code, status } };
}

/**
 * R1, R2, R3 and R5: the Raydium CLMM pools for a Solana token, from DEX Screener.
 *
 * @param fetchImpl The fetch function. Tests pass a mock. The default is the global fetch.
 */
export async function readRaydiumPools(
  input: RaydiumPoolsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<RaydiumPoolsResult> {
  const { tokenAddress, secondTokenAddress } = input;
  if (!MINT_PATTERN.test(tokenAddress)) return failure("invalid_input");
  if (secondTokenAddress !== undefined && !MINT_PATTERN.test(secondTokenAddress)) {
    return failure("invalid_input");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RAYDIUM_READ_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${DEXSCREENER_PAIRS_URL}/${tokenAddress}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return failure("unavailable", response.status);
    // The body read stays inside the timeout. A slow body is a timeout too.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) return failure("timeout");
      return failure("invalid_response");
    }
    const pairs = parseDexScreenerPairs(body);
    if (pairs === null) return failure("invalid_response");
    return { ok: true, pools: raydiumPoolsFromPairs(pairs, secondTokenAddress) };
  } catch {
    return controller.signal.aborted ? failure("timeout") : failure("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
