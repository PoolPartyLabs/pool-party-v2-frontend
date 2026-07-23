/**
 * @id PP-STR-LIB-001 (POO-611)
 * @name settle (outcome + TxError + tx hash + swapInfo)
 * @implements-rules-version v2
 *
 * Resolves the phase a transactional strategy flow (invest / collect / compound / withdraw) moves to
 * after its pending step, plus the structured error and the transaction hash that accompany the
 * terminal states (POO-279). In mock mode the outcome is always "success" — the app is
 * intentionally happy-path. PP-INTEGRATION-POINT: the real flow derives all three from the
 * on-chain transaction result (revert reason + JSON-RPC error code on failure; receipt hash on
 * either side). Isolated here (rather than inlined) so tests can force the error branch.
 *
 * POO-611 (rules v1): {@link settleSwapInfo} + {@link MOCK_BUILT_TX} give the handshake mock build a
 * real-shaped `swapInfo` (price impact + protocol fee + min received) so the Review step demos real
 * figures in mock mode. PP-INTEGRATION-POINT: real values come from the API `TxResponseWithSwap` block.
 */

import type { BuiltTx, SwapInfo } from "@/lib/tx/builtTxSchema";
import type { TxError } from "@/lib/tx/diagnostics";

/** The terminal phase after a pending transaction. */
export type SettleOutcome = "success" | "error";

export type { TxError };

/** The settled outcome of a mock transaction (always success; see PP-INTEGRATION-POINT above). */
export function settleOutcome(): SettleOutcome {
  return "success";
}

/**
 * The slippage threshold (percent) at or below which the mock deterministically fails with the canned
 * settle slippage error (POO-499 R6). A gear slippage this tight is the demo trigger for the
 * auto-retry -> slippage-view -> settings-auto-open path in mock mode.
 */
const MOCK_SLIPPAGE_FAILURE_PCT = 0.1;

/**
 * PP-MOCK (POO-499 R6): the mock confirm step's outcome given the gear slippage. A slippage <= 0.1%
 * forces the canned {@link settleTxError} (which classifies as slippage) on BOTH the first and the
 * auto-retried attempt, so the full notice -> slippage view -> auto-open path is demoable in mock
 * mode; any slippage > 0.1% keeps the happy path (`settleOutcome`). Tests still force outcomes via
 * `vi.mock("./settle")`.
 */
export function settleOutcomeForSlippage(slippagePct: number): SettleOutcome {
  if (slippagePct <= MOCK_SLIPPAGE_FAILURE_PCT) return "error";
  return settleOutcome();
}

/**
 * The structured error for a failed settle. Mock values mirror the Figma v2 reference
 * (JSON-RPC internal error + a revert reason). PP-INTEGRATION-POINT: map the real provider
 * error (code + revert reason) here.
 */
export function settleTxError(): TxError {
  return {
    code: "-32603",
    message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
  };
}

/**
 * The transaction hash of the settled (or pending) mock transaction.
 * PP-MOCK (POO-541 R1): an obvious `0xMOCK...` marker, not a realistic-looking hash, so a mock receipt
 * hash is never mistaken for a real one. It is display-only: it flows into `formatTxHash` (pure string
 * slice) and `getExplorerTxUrl` (URL interpolation), never into viem parsing, so `0xMOCK` (invalid hex)
 * is safe here; the resulting explorer link visibly does not resolve, which is the intent in mock mode
 * (POO-541 R3). Kept at the original 42-char length so the receipt / explorer layout still holds.
 * PP-INTEGRATION-POINT: the real hash comes from the submitted transaction receipt.
 */
export function settleTxHash(): string {
  return "0xMOCK00000000000000000000000000000000MOCK";
}

/**
 * The USD actually deployed into the position for a settled invest (POO-383 R9). Mock mode always
 * deploys the full requested amount (happy-path); isolated here so tests can force a partial fill
 * (deployed < requested) to exercise the partial-investment banner.
 * PP-INTEGRATION-POINT: the real figure comes from the add-liquidity result — market movement and
 * slippage can leave a remainder that stays in the wallet, so deployed may be < requested.
 */
export function settleDeployedUsd(requestedUsd: number): number {
  return requestedUsd;
}

/**
 * PP-MOCK: the manager performance-fee cut a collect build estimates (POO-827, mirroring the real
 * `performanceFeeInUsd` of POO-811): a plausible flat 10% cut over the claimable, deterministic so
 * the Review's 10s re-quote never flickers the figure. Real mode reads the API estimate instead.
 */
export function settlePerformanceFeeUsd(claimableUsd: number): number {
  return roundTo(claimableUsd * 0.1, 2);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * Deterministic [0, 1) pseudo-noise from a seed. Used to vary the mock price impact per amount WITHOUT
 * `Math.random`, so a `flow.rebuild()` re-quote (same amount) returns the SAME figure and the Review's
 * 10s countdown never flickers the number (POO-611 R3).
 */
function pseudoUnit(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * PP-MOCK (POO-611): a real-shaped {@link SwapInfo} for the handshake mock build, so the Review step
 * shows real-looking figures in mock mode. Price impact grows with the swapped size on a log-of-size
 * curve (a bigger swap moves the pool more), so typical amounts stay benign (< ~0.3%) and only
 * whale-sized trades approach the 2% warning band (POO-613); `protocolFee` (USD) and `minAmountInStable`
 * (the amount net of slippage + impact + fee) mirror the API fields. Deterministic per amount (R3).
 * PP-INTEGRATION-POINT: the real values come from the API `TxResponseWithSwap` block on the build-tx
 * response (see `builtTxSchema`); this stands in until that is wired.
 */
export function settleSwapInfo(
  amountUsd: number,
  { slippagePct }: { slippagePct: number },
): SwapInfo {
  const amount = Math.max(0, amountUsd);
  const size = Math.log10(Math.max(amount, 10)); // $10 -> 1, $1k -> 3, $100k -> 5, $1M -> 6
  const jitter = 0.85 + pseudoUnit(Math.round(amount)) * 0.3; // 0.85 .. 1.15, fixed per amount
  const priceImpactPercentage = roundTo(clamp(0.02 * size ** 2.5 * jitter, 0.01, 12), 2);
  const protocolFee = roundTo(Math.max(0.002, amount * 0.0004), 3);
  const haircut = (amount * (slippagePct + priceImpactPercentage)) / 100 + protocolFee;
  const minAmountInStable = roundTo(Math.max(0, amount - haircut), 2);
  return { priceImpactPercentage, protocolFee, minAmountInStable };
}

/**
 * PP-MOCK (POO-611): a benign placeholder `tx` for the mock build's `built` object (the context type
 * requires a `BuiltTx`, whose `tx` is required). Display-only and never broadcast — in mock mode the
 * confirm step settles via {@link settleTxHash}, not by sending this. The Review reads only
 * `built.estimatedGasInUsd` (absent here, so the honest gas estimate stands) and `built.swapInfo`.
 */
export const MOCK_BUILT_TX: BuiltTx["tx"] = {
  to: "0x0000000000000000000000000000000000000000",
  data: "0x",
};
