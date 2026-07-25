/**
 * @id PP-STR-LIB-018 (POO-1037)
 * @name awaitBridgeSettlement (bridge arrival detection)
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * A bridge leg settles on the DESTINATION chain, minutes after its source transaction mines. This is
 * the observation that proves it, and the reason the execution rail cannot treat a bridge like every
 * other step.
 *
 * ## There is no plan endpoint to ask
 *
 * The epic was designed around `GET /plan/:id` telling us where a chained route had got to. A
 * read-only probe of the live Trading API established that we cannot obtain a `CHAINED` quote at all,
 * and `/plan` requires one (POO-1054, `01_UNISWAP_INTEGRATION.md` §1). `GET /swaps` can corroborate
 * the SOURCE side and reports nothing about arrival. So the authority here is the chain itself, which
 * is the only actual authority on whether money moved.
 *
 * ## The test, and why it is a delta ([R1])
 *
 *     balanceOf(owner, tokenOut) on destChainId  −  baseline  ≥  minAmountOut
 *
 * The baseline is read BEFORE the source transaction is broadcast (`02_BRIDGE_ARCHITECTURE.md` §3.4),
 * which is what makes the comparison about *this* bridge. An absolute test (`balance >= amount`) is
 * wrong in both directions: it reports instant success for a user who already held the destination
 * token, and it never fires for a user whose arrival is netted against a concurrent spend.
 *
 * ## Bounded, backing off, and honest at the ceiling ([R2], [R3])
 *
 * Windows grow from {@link BRIDGE_POLL_MIN_DELAY_MS} to {@link BRIDGE_POLL_MAX_DELAY_MS} and the whole
 * wait stops at {@link BRIDGE_SETTLE_CEILING_MS}. At the ceiling the leg is **not** failed and **not**
 * succeeded: this returns `settled: false` and the caller degrades to "still settling, we'll update
 * you" with the route recoverable. It never spins forever and it never fakes success, which is exactly
 * the failure class this codebase already shipped once (a deposit that "succeeds" after a 2500 ms
 * `setTimeout`) and the one the vendored Uniswap skill warns about: "duplicate bridge deposits result
 * in double payment".
 *
 * ## A failed read is not a failed bridge ([R4])
 *
 * An RPC hiccup says nothing about where the money is. A failed observation leaves the last known
 * state standing and the next window simply retries, mirroring the shipped background re-quote
 * semantics of `useWalletSignFlow` (POO-885 [R1]).
 *
 * Money convention: every amount in and out is a base-unit decimal STRING and every comparison is
 * `BigInt`. No float touches this file.
 *
 * PP-INTEGRATION-POINT: `readTokenBalance` is the caller's on-chain read (`readErc20Balance` /
 * `readNativeBalance` per chain); this module owns the polling policy, not the transport.
 */
import { TransactionError } from "@/lib/tx/sendTransaction";

/** Shortest window between two observations. Anything tighter is a busy loop against an RPC. */
export const BRIDGE_POLL_MIN_DELAY_MS = 3_000;

/** Longest window between two observations, per `02_BRIDGE_ARCHITECTURE.md` §3.6. */
export const BRIDGE_POLL_MAX_DELAY_MS = 30_000;

/** Window growth factor. 3s → 6s → 12s → 24s → 30s → 30s… */
export const BRIDGE_POLL_BACKOFF = 2;

/**
 * How long the wait may run before it degrades. Ten minutes against an `estimatedFillTimeMs` usually
 * measured in seconds: generous enough that a congested fill still lands inside it, short enough that
 * a user is never held hostage by a modal.
 */
export const BRIDGE_SETTLE_CEILING_MS = 10 * 60_000;

/**
 * Stable machine code for "broadcast, not yet arrived" ([R3]). Deliberately NOT in the diagnostics
 * catalog (`classifyTxError`): it is not a transaction failure, so it must not inherit failure copy,
 * and above all it must not reach a retry affordance. `flow.retry()` re-invokes the failed step
 * verbatim, which for a bridge already in flight is a second deposit of the same money.
 */
export const BRIDGE_PENDING_CODE = "PROVISIONING_BRIDGE_PENDING";

/** What has to land, where, and above what floor. All amounts are base-unit decimal strings. */
export interface BridgeArrival {
  /** The DESTINATION chain. For a bridge leg that is `leg.tokenOut.chainId`, not `leg.chainId`. */
  chainId: number;
  /** The token the bridge delivers on the destination chain. */
  token: string;
  /** The wallet the funds are bridged to (the SIWE-session address the plan was priced for). */
  owner: string;
  /** Destination balance read BEFORE the source transaction was broadcast. */
  baseline: string;
  /** The floor the leg must deliver (`leg.minAmountOut`); Across quotes it, slippage does not. */
  minAmountOut: string;
  /** `quote.estimatedFillTimeMs` when the quote gave one. Sizes the FIRST window only. */
  etaMs?: number;
}

/** The single injected dependency: an on-chain balance read, per chain. */
export interface BridgeSettlementDeps {
  /** Base-unit balance of `token` for `owner` on `chainId`, as a decimal string. */
  readTokenBalance: (args: { chainId: number; token: string; owner: string }) => Promise<string>;
}

/** Common shape of both outcomes, so a caller can log the wait without narrowing first. */
interface BridgeSettlementBase {
  /** The last observed delta against the baseline, base units, decimal string. */
  delta: string;
  /** How many observations were made (the first one is immediate). */
  polls: number;
  /** Wall-clock time spent waiting, ms. */
  waitedMs: number;
}

/** Arrived, or ran out of patience. Never "probably arrived". */
export type BridgeSettlement =
  | (BridgeSettlementBase & { settled: true })
  | (BridgeSettlementBase & {
      settled: false;
      reason: "ceiling";
      /** The last transient read failure, when the wait ended on one ([R4]). */
      lastError?: string;
    });

/**
 * Wait for a bridge leg to land on its destination chain.
 *
 * Resolves either way: arrival is `settled: true`, and the ceiling is `settled: false` with the last
 * known delta. It throws only when the CALLER's own figures cannot be parsed, which is a rail bug and
 * not a chain condition.
 */
export async function awaitBridgeSettlement(
  arrival: BridgeArrival,
  deps: BridgeSettlementDeps,
): Promise<BridgeSettlement> {
  const baseline = requireAmount(arrival.baseline, "baseline");
  const floor = requireAmount(arrival.minAmountOut, "minimum amount out");
  const startedAt = Date.now();

  let delay = firstDelayMs(arrival.etaMs);
  let polls = 0;
  let delta = "0";
  let lastError: string | undefined;

  for (;;) {
    polls++;
    try {
      const balance = await deps.readTokenBalance({
        chainId: arrival.chainId,
        token: arrival.token,
        owner: arrival.owner,
      });
      // Untrusted input: an RPC that answers with junk (a gateway HTML page, an empty body) is a
      // FAILED observation, never a zero balance. Zero is a claim about the user's money.
      const observed = parseAmount(balance) - baseline;
      delta = observed.toString();
      lastError = undefined;
      // The delta must be positive on its own: a degenerate zero floor must not turn "nothing has
      // happened" into success.
      if (observed > BigInt(0) && observed >= floor) {
        return { settled: true, delta, polls, waitedMs: Date.now() - startedAt };
      }
    } catch (error) {
      // [R4] A failed read says nothing about where the money is. The last known state stands.
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remaining = BRIDGE_SETTLE_CEILING_MS - (Date.now() - startedAt);
    if (remaining <= 0) break;
    // The final window is clipped to the ceiling, so the wait always ends on a fresh observation
    // rather than on a sleep that overshoots it.
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * BRIDGE_POLL_BACKOFF, BRIDGE_POLL_MAX_DELAY_MS);
  }

  return {
    settled: false,
    reason: "ceiling",
    delta,
    polls,
    waitedMs: Date.now() - startedAt,
    ...(lastError === undefined ? {} : { lastError }),
  };
}

/**
 * The first window, sized from the quote's own fill estimate when there is one ([R2]).
 *
 * A live Base → Arbitrum USDC transfer measured around 1000 ms, so sleeping the full floor delay
 * would be three times the whole transfer. A quote may therefore SHORTEN the first window and never
 * lengthen it past {@link BRIDGE_POLL_MAX_DELAY_MS}: `estimatedFillTimeMs` is an estimate, and a
 * pessimistic one must not delay the moment we notice money that has already landed.
 */
function firstDelayMs(etaMs: number | undefined): number {
  if (etaMs === undefined || !Number.isFinite(etaMs) || etaMs <= 0) return BRIDGE_POLL_MIN_DELAY_MS;
  return Math.min(Math.max(etaMs, 500), BRIDGE_POLL_MAX_DELAY_MS);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Parse a base-unit amount, decimal or hex. Throws on anything else. */
function parseAmount(value: string): bigint {
  const parsed = BigInt(value.trim());
  if (parsed < BigInt(0)) throw new Error(`negative amount: ${value}`);
  return parsed;
}

/** Parse one of the caller's OWN figures: unparseable here is a rail bug, so it fails typed. */
function requireAmount(value: string, label: string): bigint {
  try {
    return parseAmount(value);
  } catch {
    throw new TransactionError(`The bridge leg's ${label} is not a valid amount: ${value}`, {
      code: "PROVISIONING_INVALID_AMOUNT",
    });
  }
}
