/**
 * @id PP-STR-LIB-020 (POO-1038)
 * @name funding journal reconciliation tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * One `it()` per row of the decision table in `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.5, plus
 * the destination-arrival test of §3.6. The chain reader is a stub with THREE read methods and no
 * way to send anything: the type itself is the guarantee that an ambiguous state cannot be resolved
 * by broadcasting ([R3]). Clock is faked so the poll ceiling is asserted, not waited for. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJournal,
  type FundingJournal,
  type FundingLeg,
  getJournal,
  updateLeg,
} from "./fundingJournal";
import {
  applyReconciliation,
  type ChainReader,
  JOURNAL_POLL_CEILING_MS,
  reconcileJournal,
} from "./reconcileFundingJournal";

const WALLET = "0xc3673adc0000000000000000000000000000beef";
const POLYGON = 137;
const ARBITRUM = 42161;
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const SWAP_HASH = `0x${"11".repeat(32)}`;
const BRIDGE_HASH = `0x${"22".repeat(32)}`;
const T0 = Date.parse("2026-07-25T12:00:00.000Z");

interface ReaderOptions {
  receipts?: Record<string, { status: "success" | "reverted" } | null>;
  nonces?: Record<number, number>;
  balances?: Record<string, string>;
}

interface ReaderHarness extends ChainReader {
  calls: string[];
}

function reader(options: ReaderOptions = {}): ReaderHarness {
  const calls: string[] = [];
  return {
    calls,
    getTransactionReceipt: async ({ txHash }) => {
      calls.push(`receipt:${txHash}`);
      return options.receipts?.[txHash] ?? null;
    },
    getTransactionCount: async ({ chainId }) => {
      calls.push(`nonce:${chainId}`);
      return options.nonces?.[chainId] ?? 7;
    },
    getTokenBalance: async ({ chainId, token }) => {
      calls.push(`balance:${chainId}:${token}`);
      return options.balances?.[`${chainId}:${token}`] ?? "0";
    },
  };
}

/** A two-leg flagship route: swap WETH→USDC on Polygon, then bridge USDC to Arbitrum. */
function journalWith(legs: Partial<FundingLeg>[]): FundingJournal {
  const journal = createJournal({
    wallet: WALLET,
    operation: { kind: "invest", targetChainId: ARBITRUM, strategyId: "strat-1" },
    legs: [
      {
        index: 0,
        kind: "swap-token",
        chainId: POLYGON,
        tokenIn: WETH_POLYGON,
        tokenOut: USDC_POLYGON,
        amountIn: "1000000000000000000",
        minAmountOut: "2940000000",
      },
      {
        index: 1,
        kind: "bridge",
        chainId: POLYGON,
        tokenIn: USDC_POLYGON,
        tokenOut: USDC_ARBITRUM,
        destChainId: ARBITRUM,
        amountIn: "3000000000",
        minAmountOut: "2996000000",
      },
    ],
  });
  legs.forEach((patch, index) => {
    updateLeg(journal.journalId, index, patch);
  });
  return getJournal(journal.journalId) as FundingJournal;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[R3] §3.5 the decision table, row by row", () => {
  it("skips a settled leg without reading the chain at all", async () => {
    const journal = journalWith([
      { status: "settled", txHash: SWAP_HASH, settledAt: T0 },
      { status: "settled", txHash: BRIDGE_HASH, settledAt: T0 },
    ]);
    const chain = reader();

    const result = await reconcileJournal(journal, chain);

    expect(result.legs.map((leg) => leg.verdict)).toEqual(["settled", "settled"]);
    expect(chain.calls).toEqual([]);
    expect(result.action).toBe("complete");
  });

  it("settles a broadcast same-chain leg whose receipt succeeded", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: { status: "success" } } });

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("settled");
  });

  it("fails a broadcast leg whose receipt reverted, and asks for a re-derive", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: { status: "reverted" } } });

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("reverted");
    expect(result.action).toBe("rederive");
  });

  it("waits on a broadcast leg with no receipt yet, and never proposes a re-broadcast", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: null } });

    vi.setSystemTime(T0 + JOURNAL_POLL_CEILING_MS - 1);
    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("pending");
    expect(result.action).toBe("wait");
    expect(chain.calls).not.toContain(`nonce:${POLYGON}`);
  });

  it("calls a receiptless leg AMBIGUOUS at the ceiling when the account nonce has moved", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: null }, nonces: { [POLYGON]: 8 } });

    vi.setSystemTime(T0 + JOURNAL_POLL_CEILING_MS);
    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("unknown");
    expect(result.action).toBe("ask");
  });

  it("calls a receiptless leg DROPPED at the ceiling when the account nonce did not move", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: null }, nonces: { [POLYGON]: 7 } });

    vi.setSystemTime(T0 + JOURNAL_POLL_CEILING_MS);
    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("absent");
    expect(result.action).toBe("rederive");
  });

  it("clears a planned leg with no hash when the account nonce did not move", async () => {
    const journal = journalWith([{ status: "planned", nonceBefore: 7 }]);
    const chain = reader({ nonces: { [POLYGON]: 7 } });

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("absent");
    expect(result.action).toBe("rederive");
  });

  it("calls a planned leg with no hash AMBIGUOUS when the nonce moved: the residual window", async () => {
    const journal = journalWith([{ status: "planned", nonceBefore: 7 }]);
    const chain = reader({ nonces: { [POLYGON]: 9 } });

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("unknown");
    expect(result.action).toBe("ask");
  });

  it("cannot resolve a planned leg that never recorded a nonce, so it asks", async () => {
    const journal = journalWith([{ status: "planned" }]);
    const chain = reader();

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("unknown");
  });

  it("ranks ask over wait over rederive when legs disagree", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
      { status: "planned", nonceBefore: 4 },
    ]);
    const chain = reader({
      receipts: { [SWAP_HASH]: null },
      nonces: { [POLYGON]: 5 },
    });

    vi.setSystemTime(T0 + 1_000);
    const result = await reconcileJournal(journal, chain);

    expect(result.legs.map((leg) => leg.verdict)).toEqual(["pending", "unknown"]);
    expect(result.action).toBe("ask");
  });
});

describe("[R3] §3.6 a bridge settles on the DESTINATION chain", () => {
  const broadcastBridge = () =>
    journalWith([
      { status: "settled", txHash: SWAP_HASH, settledAt: T0 },
      {
        status: "broadcast",
        txHash: BRIDGE_HASH,
        broadcastAt: T0,
        nonceBefore: 8,
        destBalanceBefore: "1000000",
      },
    ]);

  it("does not call a bridge settled on a source receipt alone", async () => {
    const chain = reader({
      receipts: { [BRIDGE_HASH]: { status: "success" } },
      // The destination balance has not moved: the funds LEFT, they have not ARRIVED.
      balances: { [`${ARBITRUM}:${USDC_ARBITRUM}`]: "1000000" },
    });

    const result = await reconcileJournal(broadcastBridge(), chain);

    expect(result.legs[1].verdict).toBe("pending");
    expect(result.action).toBe("wait");
  });

  it("settles a bridge when the destination DELTA covers minAmountOut", async () => {
    const chain = reader({
      receipts: { [BRIDGE_HASH]: { status: "success" } },
      balances: { [`${ARBITRUM}:${USDC_ARBITRUM}`]: "3997000000" },
    });

    const result = await reconcileJournal(broadcastBridge(), chain);

    expect(result.legs[1].verdict).toBe("settled");
    expect(result.action).toBe("complete");
  });

  it("measures the delta, not the absolute balance: a pre-existing holding is not an arrival", async () => {
    const journal = journalWith([
      { status: "settled", txHash: SWAP_HASH, settledAt: T0 },
      {
        status: "broadcast",
        txHash: BRIDGE_HASH,
        broadcastAt: T0,
        nonceBefore: 8,
        // The user already held more than the bridge will ever deliver.
        destBalanceBefore: "9000000000",
      },
    ]);
    const chain = reader({
      receipts: { [BRIDGE_HASH]: { status: "success" } },
      balances: { [`${ARBITRUM}:${USDC_ARBITRUM}`]: "9000000000" },
    });

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[1].verdict).toBe("pending");
  });

  it("stays pending at the poll ceiling: never failed, never faked, never re-broadcast", async () => {
    const chain = reader({
      receipts: { [BRIDGE_HASH]: { status: "success" } },
      balances: { [`${ARBITRUM}:${USDC_ARBITRUM}`]: "1000000" },
    });

    vi.setSystemTime(T0 + JOURNAL_POLL_CEILING_MS + 60_000);
    const result = await reconcileJournal(broadcastBridge(), chain);

    expect(result.legs[1].verdict).toBe("pending");
    expect(result.action).toBe("wait");
  });

  it("cannot test arrival without a baseline, so it asks rather than guessing", async () => {
    const journal = journalWith([
      { status: "settled", txHash: SWAP_HASH, settledAt: T0 },
      { status: "broadcast", txHash: BRIDGE_HASH, broadcastAt: T0, nonceBefore: 8 },
    ]);
    const chain = reader({ receipts: { [BRIDGE_HASH]: { status: "success" } } });

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[1].verdict).toBe("unknown");
  });
});

describe("[R6] the reconciled state is legible and it persists", () => {
  it("carries an i18n key per leg and for the whole journal, never raw copy", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: null } });

    const result = await reconcileJournal(journal, chain);

    expect(result.statusKey).toMatch(/^provisioning\.recovery\./);
    for (const leg of result.legs) {
      expect(leg.reasonKey).toMatch(/^provisioning\.recovery\./);
    }
  });

  it("writes the corrected statuses back, so the chain always wins over the record", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: { status: "success" } } });

    applyReconciliation(await reconcileJournal(journal, chain));

    expect(getJournal(journal.journalId)?.legs[0].status).toBe("settled");
  });

  it("leaves a still-pending leg exactly as it was, so nothing is silently abandoned", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain = reader({ receipts: { [SWAP_HASH]: null } });

    applyReconciliation(await reconcileJournal(journal, chain));

    const persisted = getJournal(journal.journalId);
    expect(persisted?.legs[0].status).toBe("broadcast");
    expect(persisted?.legs[0].txHash).toBe(SWAP_HASH);
  });

  it("re-reconciling a completed journal is a pure no-op", async () => {
    const journal = journalWith([
      { status: "settled", txHash: SWAP_HASH, settledAt: T0 },
      { status: "settled", txHash: BRIDGE_HASH, settledAt: T0 },
    ]);
    const chain = reader();

    const first = await reconcileJournal(journal, chain);
    applyReconciliation(first);
    const second = await reconcileJournal(journal, chain);

    expect(second.action).toBe("complete");
    expect(chain.calls).toEqual([]);
  });

  it("survives a chain read that throws: an unreadable leg is ambiguous, never assumed", async () => {
    const journal = journalWith([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: T0, nonceBefore: 7 },
    ]);
    const chain: ChainReader = {
      getTransactionReceipt: async () => {
        throw new Error("RPC down");
      },
      getTransactionCount: async () => 7,
      getTokenBalance: async () => "0",
    };

    const result = await reconcileJournal(journal, chain);

    expect(result.legs[0].verdict).toBe("pending");
    expect(result.action).toBe("wait");
  });
});
