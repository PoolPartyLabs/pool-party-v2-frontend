/**
 * @id PP-CORE-LIB-041 (POO-810)
 * @name decodeExecutedAmounts
 * @implements-rules-version v1
 *
 * The pure receipt decode behind the truthful invest/collect/withdraw receipts (POO-810 R2/R8):
 * given a mined transaction's `logs`, the user's wallet, and the chain's USDC address, it sums the
 * ERC-20 `Transfer(_, to = user, value)` events per token and flags the USDC leg. A `Transfer` log
 * is emitted BY the token contract, so the token identity is the log's own `address` — no token
 * address list is needed in advance (R2/R7). Standard ERC-20 only: no protocol-specific event ABI.
 *
 * Pure and side-effect-free (no chain access), so it unit-tests against fixture receipt logs and
 * tests can force partial fills / specific decoded amounts (R8). Malformed logs and non-Transfer
 * logs are skipped; empty/absent logs yield the empty result, which drives the R9 fallback to the
 * pre-broadcast figure at the call site (never blank or $0).
 *
 * PP-INTEGRATION-POINT: decodes the REAL receipt logs from `executeBuiltTransactionWithLogs`.
 */
import { decodeEventLog } from "viem";
import { erc20Abi } from "@/contracts/erc20";

/** A single mined-receipt log (the subset the decoder reads: emitter + indexed topics + data). */
export interface ReceiptLog {
  /** The emitting contract — for a `Transfer` this IS the token address (R2/R7). */
  address: `0x${string}`;
  /** Indexed topics: `[topic0(sig), from, to]` for a `Transfer`. */
  topics: readonly `0x${string}`[] | `0x${string}`[];
  /** ABI-encoded non-indexed data (the `value` for a `Transfer`). */
  data: `0x${string}`;
}

/** One token's summed receipt inflow to the user. */
export interface DecodedTransfer {
  /** The token contract address (the `Transfer` emitter). */
  address: `0x${string}`;
  /** Whether this token is the chain's native USDC (rendered as USD 1:1 by the caller, R3). */
  isUsdc: boolean;
  /** Summed raw `value` received by the user, in the token's base units. */
  rawValue: bigint;
}

/** The decoded per-token inflows, plus the USDC total for the invest `deployed = requested − refund`. */
export interface DecodedReceiptAmounts {
  /** One entry per distinct token transferred TO the user in this receipt (order of first sighting). */
  perToken: DecodedTransfer[];
  /** Sum of USDC (base units, 6 decimals) received by the user — the invest refund total (R2). */
  usdcReceived: bigint;
}

/** Inputs for {@link decodeExecutedAmounts}. */
export interface DecodeExecutedAmountsInput {
  /** The mined receipt's logs (absent/empty → empty result → R9 fallback at the call site). */
  logs: ReceiptLog[] | undefined | null;
  /** The user's wallet — only Transfers whose `to` matches are counted (R2). */
  userWallet: `0x${string}`;
  /** The chain's native USDC address, or undefined when unknown (then no leg is flagged USDC). */
  usdcAddress: `0x${string}` | undefined;
}

/** Decode a receipt's ERC-20 `Transfer`-to-user events, summed per token (POO-810 R2). */
export function decodeExecutedAmounts({
  logs,
  userWallet,
  usdcAddress,
}: DecodeExecutedAmountsInput): DecodedReceiptAmounts {
  const empty: DecodedReceiptAmounts = { perToken: [], usdcReceived: BigInt(0) };
  if (!logs || logs.length === 0) return empty;

  const wallet = userWallet.toLowerCase();
  const usdc = usdcAddress?.toLowerCase();
  // Sum per token, keyed by lowercase address, preserving first-seen order for a stable render.
  const byToken = new Map<string, DecodedTransfer>();

  for (const log of logs) {
    // A canonical ERC-20 `Transfer` has EXACTLY 3 topics (topic0(sig), from, to). Skip any log with a
    // different topic count BEFORE decoding: a 4-topic event that shares the Transfer topic0 (e.g. an
    // ERC-721 mint `Transfer(from, to, tokenId)`, all three indexed) would otherwise mis-decode its
    // indexed `tokenId` as an ERC-20 `value` and inflate the summed inflow.
    if (log.topics.length !== 3) continue;
    let to: string;
    let value: bigint;
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        eventName: "Transfer",
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        data: log.data,
      });
      // Non-Transfer logs decode to a different name (or throw); guard the name explicitly.
      if (decoded.eventName !== "Transfer") continue;
      to = (decoded.args.to as string).toLowerCase();
      value = decoded.args.value as bigint;
    } catch {
      // Not a decodable Transfer (different event, malformed/partial log) — skip it (R9-safe).
      continue;
    }

    if (to !== wallet) continue;

    const key = log.address.toLowerCase();
    const existing = byToken.get(key);
    if (existing) {
      existing.rawValue += value;
    } else {
      byToken.set(key, {
        address: log.address,
        isUsdc: usdc != null && key === usdc,
        rawValue: value,
      });
    }
  }

  const perToken = [...byToken.values()];
  const usdcReceived = perToken
    .filter((t) => t.isUsdc)
    .reduce((sum, t) => sum + t.rawValue, BigInt(0));
  return { perToken, usdcReceived };
}
