/**
 * @id PP-STR-LIB-002 (POO-403)
 * @name strategyReceiveOptions
 * @implements-rules-version v1
 *
 * The payout assets the "Receive as" picker offers for a strategy (Collect / Withdraw, plus the
 * shared TransactionSettingsDialog). POO-403 R4: a manager may define `receiveTokens` explicitly;
 * when they don't, single-pool strategies still let the investor receive the underlying pair, so we
 * derive the options from `poolPair` (`["USDC", token0, token1]`, deduped, USDC = default). With
 * neither field present we fall back to USDC-only — never fabricated.
 *
 * PP-INTEGRATION-POINT (POO-405): real-mode created strategies need the backend to serve `poolPair`
 * and/or `receiveTokens`; until then those strategies honestly show USDC-only.
 *
 * POO-481 (v1): `withdrawReceiveOptions` is the Withdraw-specific BINARY variant (USDC or the pool
 * token pair, the Collect/POO-417 model, since the backend knob is the single `shouldSwapFees`
 * boolean). Its pair resolves from data the modal already holds in both modes, so real mode stops
 * collapsing to USDC-only.
 */
import type { Position, Strategy, StrategyDetail } from "@/lib/schemas";

/** The default payout asset when nothing else is known. */
const DEFAULT_RECEIVE_TOKEN = "USDC";

/** Resolve the "Receive as" options for a strategy detail (see file header for the rule). */
export function strategyReceiveOptions(detail: StrategyDetail | undefined): string[] {
  const managerDefined = detail?.receiveTokens;
  if (managerDefined && managerDefined.length > 0) return managerDefined;

  const pair = detail?.poolPair;
  if (pair) {
    // USDC first (the default), then the pool tokens, de-duplicated (a USDC-leg pool keeps one).
    return Array.from(new Set([DEFAULT_RECEIVE_TOKEN, pair.token0, pair.token1]));
  }

  return [DEFAULT_RECEIVE_TOKEN];
}

/** Binary withdraw receive-as option set (POO-481 R1). */
export interface WithdrawReceiveOptions {
  /** Picker options: `["USDC"]`, or `["USDC", "<t0> / <t1>"]` when a pair source exists. */
  options: string[];
  /** The pair label ("ETH / USDC"); absent when no pair source exists. */
  pairLabel?: string;
  /** The pair token symbols in pool order; absent when no pair source exists. */
  pairTokens?: [string, string];
}

/**
 * The Withdraw "Receive as" options, BINARY per POO-481 R1: USDC (default) or the pool token pair.
 * Pair source precedence: the position's `claimableFeeTokens` (real per-token data, the Collect
 * source) → `detail.poolPair` (mock strategies) → the TOP-LEVEL `strategy.poolPair` (the real-mode
 * mapper shape: `mapStrategy` never sets `detail` but does map the pair) → USDC-only, never
 * fabricated.
 */
export function withdrawReceiveOptions(
  strategy: Strategy | undefined,
  position: Position | undefined,
): WithdrawReceiveOptions {
  const pairTokens = resolvePairTokens(strategy, position);
  if (!pairTokens) return { options: [DEFAULT_RECEIVE_TOKEN] };
  const pairLabel = `${pairTokens[0]} / ${pairTokens[1]}`;
  return { options: [DEFAULT_RECEIVE_TOKEN, pairLabel], pairLabel, pairTokens };
}

/** The pool pair symbols from the best available source (see {@link withdrawReceiveOptions}). */
function resolvePairTokens(
  strategy: Strategy | undefined,
  position: Position | undefined,
): [string, string] | undefined {
  const [fee0, fee1] = position?.claimableFeeTokens ?? [];
  if (fee0 && fee1) return [fee0.symbol, fee1.symbol];
  const pair = strategy?.detail?.poolPair ?? strategy?.poolPair;
  if (pair) return [pair.token0, pair.token1];
  return undefined;
}
