/**
 * @id PP-BALANCES (POO-815, POO-1893)
 * @name fetchWalletHoldings
 * @implements-rules-version v3 (POO-1893 rules v2) · v2 (POO-1893 rules v1) · v1 (POO-815)
 * @analytics-events none, a server-only read behind the wallet modal with no screen or flow of its
 *   own. Its failure signal is a structured log (`api.response_parse_failed`), not a product event.
 *
 * Server-side read of the connected wallet's FULL multi-token holdings (with USD) across every
 * ACTIVE network, from pool-party-api `GET /api/v1/wallet/{address}?network=` (backend discovers
 * tokens via Alchemy, prices them via CoinGecko, keeping only unit prices > $0.01). Mirrors
 * pool-party-interface `fetchWalletMetadata`, adapted to our chain-agnostic UI:
 * fan out over the 3 networks and merge. A per-network failure is skipped (never hides funds held
 * elsewhere, POO-815 [R2]); if EVERY network fails the read throws so the caller falls back to the
 * USDC-only on-chain read ([R5]). Unpriced rows are dropped in the mapper ([R3]).
 *
 * POO-1893: that fallback used to be reachable through METADATA DRIFT alone. One field the backend
 * stopped sending on unpriced tokens (`formattedBalanceInUSD`) rejected the whole array, therefore
 * the whole network, therefore — since the trigger is not network-specific — all three at once, and
 * the user was silently served a USDC-only balance for six days. Rows are now parsed one at a time
 * ([R2], `parseHoldingRows`): a row that fails is dropped and COUNTED in a structured log, and the
 * rest are returned. A network is failed only when NOT ONE of its rows is readable, which is a
 * contract break rather than a drifted field.
 *
 * POO-1893 rules v2 [R5]: the same "funded wallet renders empty" outcome was still reachable ONE
 * LAYER DOWN. Every row can PARSE and still be dropped by `mapHolding` for having no price, which
 * is what a total pricing outage looks like from here (the incident's co-timed backend warning,
 * `tokens/multi returned 0 of 4`, at its limit). That returned `[]`, and `[]` is not nullish, so it
 * travelled all the way to the modal as $0.00 instead of reaching the USDC-only fallback. So there
 * are now TWO separate guards, in this order and never merged: PARSE success is checked first
 * (`holdings.length`, [R3]), PRICING second (`balances.length`, [R5]).
 *
 * The tradeoff is named on purpose: a wallet that genuinely holds ONLY unpriced tokens now costs one
 * extra on-chain read, and "network failure" is slightly wider than it was. It fires only when
 * NOTHING the wallet holds is priced, so any wallet holding USDC (priced, unit price > $0.01) is
 * untouched, and the alternative is showing a funded wallet a zero balance.
 *
 * KNOWN LIMIT, unchanged by [R5] and shared with [R3]: the fan-out below tolerates a PARTIAL
 * failure by design (POO-815 [R2], never hide funds held elsewhere), so a wallet whose only holdings
 * sit on the one network that fails this way still merges to `[]` while the other networks answer
 * "empty" successfully. Closing that would mean failing the whole read on any network failure, which
 * is the behaviour POO-815 [R2] exists to prevent.
 *
 * `?network=` is a plain query param and the apiFetch `network` ROUTING option is intentionally NOT
 * set: pool-party-interface always calls the CURRENT backend for `/wallet` (network as query only),
 * whereas passing `network` would route Arbitrum/Base to PP_API_URL_LEGACY. See POO-813 [Q2].
 *
 * POO-1776 [R1]: the fan-out enumerates `activeChainMetas`, so a flag-gated chain is not read while
 * its flag is off — that call would go to a backend which does not know the slug, once per wallet.
 *
 * PP-INTEGRATION-POINT (POO-813): the real wallet-holdings endpoint on pool-party-api.
 */
import "server-only";

import { ApiParseError, apiFetch } from "@/lib/api/client";
import { activeChainMetas } from "@/lib/chains/config";
import { isFeatureEnabled } from "@/lib/features";
import { logError, summarizeZodIssues } from "@/lib/observability/logger";
import { getRequestTraceId } from "@/lib/observability/trace";
import { mapHolding } from "./mapHolding";
import type { TokenBalance } from "./types";
import { parseHoldingRows, walletHoldingsSchema } from "./walletHoldingsSchema";

/** One network's holdings, mapped and priced (unpriced rows already dropped). */
async function fetchNetworkHoldings(address: string, apiNetworkId: string, chainId: number) {
  const endpoint = `wallet/${address}?network=${apiNetworkId}`;
  const data = await apiFetch(endpoint, {
    schema: walletHoldingsSchema,
    // No `network` routing option on purpose (see file header + POO-813 [Q2]); no `revalidate`
    // so the balance stays fresh (the manual refresh re-reads it, POO-808).
  });

  const rows = data?.tokensBalance ?? [];
  const { holdings, rejected } = parseHoldingRows(rows);

  // [R2] The drop is never silent. `apiFetch` used to emit this exact event for the whole payload
  // (`api.response_parse_failed`, POO-243 [R15]); it now names the ROWS instead, so the signal that
  // found POO-1893 survives the tolerance that fixes it. Same event token on purpose: a grep, an
  // alert or a saved Sentry search written for the outage keeps working on the degrade.
  //
  // `traceId` FIRST, exactly as the [R15] line carries it (`api/client.ts`): the degrade is only
  // diagnosable if it joins to the render that caused it and to the rest of the trace, which is how
  // POO-1893 was found. `requestId` has no counterpart here — `apiFetch` does not surface the
  // backend's echoed id on a SUCCESSFUL response — and an invented one would be worse than none.
  if (rejected.length > 0) {
    logError("api.response_parse_failed", {
      traceId: getRequestTraceId(),
      endpoint: `GET /api/v1/${endpoint}`,
      status: 200,
      code: "SYSTEM_PARSE_ERROR",
      // One event token now covers two degrade causes ([R2] here, [R5] below), so the cause is a
      // FIELD. The token stays put: an alert or saved search written for the outage keeps working.
      reason: "rows_rejected",
      network: apiNetworkId,
      rowsReceived: rows.length,
      rowsDropped: rows.length - holdings.length,
      issueCount: rejected.length,
      issues: summarizeZodIssues(rejected),
    });
  }

  // [R3] Tolerance stops where it would hide a contract break. A non-empty payload in which NOT ONE
  // row is readable is a shape change, not the metadata drift [R1] absorbs, and answering "no
  // holdings" for it would render a FUNDED wallet as empty: `[]` is not nullish, so it never
  // reaches the USDC-only fallback (`getWalletHoldingsAction` → `useTokenBalances`). Failing the
  // network instead keeps POO-815 [R5]'s last resort reachable for the case it was designed for.
  if (rows.length > 0 && holdings.length === 0) {
    throw new ApiParseError(
      `No readable holding row for ${apiNetworkId} (${rows.length} received)`,
      rejected,
    );
  }

  const balances = holdings
    .map((row) => mapHolding(row, chainId))
    .filter((balance): balance is TokenBalance => balance !== null);

  // [R5] The SECOND guard, deliberately separate from [R3] and deliberately after the mapper. [R3]
  // asks "did anything parse"; this asks "did anything survive PRICING", which is the other way the
  // same funded wallet reaches the modal as $0.00: a total pricing outage drops every row here even
  // though every row parsed. Merging the two conditions would lose the ordering [R3] depends on and
  // blur two failures that need different diagnoses (a shape change vs a price feed).
  if (rows.length > 0 && balances.length === 0) {
    logError("api.response_parse_failed", {
      traceId: getRequestTraceId(),
      endpoint: `GET /api/v1/${endpoint}`,
      status: 200,
      code: "SYSTEM_PARSE_ERROR",
      reason: "no_priced_row",
      network: apiNetworkId,
      rowsReceived: rows.length,
      // Every row that parsed was then dropped for having no price, so nothing survived to display.
      rowsDropped: rows.length,
      issueCount: 0,
      issues: [],
    });
    throw new ApiParseError(
      `No priced holding row for ${apiNetworkId} (${rows.length} received, ${holdings.length} parsed)`,
      [],
    );
  }

  return balances;
}

/**
 * The connected wallet's holdings across all ACTIVE networks, merged. No address → `[]`. Throws
 * only when EVERY network read failed (so the caller can fall back); a partial failure is tolerated.
 */
export async function fetchWalletHoldings(address: string): Promise<TokenBalance[]> {
  if (!address) return [];

  const results = await Promise.allSettled(
    // [R1] `isFeatureEnabled` (not a passed-in reader): this is a `server-only` module, so the Dev
    // menu's client-side QA overrides could not reach it and the env answer is the only one there is.
    activeChainMetas(isFeatureEnabled).map((meta) =>
      fetchNetworkHoldings(address, meta.apiNetworkId, meta.chain.id),
    ),
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<TokenBalance[]> => r.status === "fulfilled",
  );

  // Every network failed → surface the failure so the caller degrades to the USDC-only read ([R5]).
  if (fulfilled.length === 0) {
    const firstRejected = results.find((r) => r.status === "rejected");
    throw (
      (firstRejected as PromiseRejectedResult | undefined)?.reason ??
      new Error("wallet holdings read failed on every network")
    );
  }

  return fulfilled.flatMap((r) => r.value);
}
