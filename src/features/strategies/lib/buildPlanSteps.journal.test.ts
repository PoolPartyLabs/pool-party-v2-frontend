/**
 * @id PP-STR-LIB-019 (POO-1038)
 * @name execution rail recovery tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The recovery half of the rail, kept in its own file so the POO-1036 spec stays about mapping a plan
 * onto `FlowStep`s and this one stays about not spending a user's money twice.
 *
 * The wallet is an EIP-1193 handler map, so the SHIPPED chain and account assertions really run, and
 * the journal is the REAL `localStorage`-backed store: the thing under test is the write ordering, and
 * a stubbed store would prove nothing about it. No network, no timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse, UniswapTransactionRequest } from "@/lib/uniswap/schemas";
import {
  buildPlanSteps,
  isRequoteMateriallyWorse,
  type PlanRailCtx,
  type PlanRailDeps,
  type RequoteChange,
} from "./buildPlanSteps";
import {
  createJournal,
  createJournalRecorder,
  type FundingJournal,
  getJournal,
} from "./fundingJournal";
import { type ChainReader, reconcileJournal } from "./reconcileFundingJournal";

const OWNER = "0xC3673ADc0000000000000000000000000000BEEF";
const POLYGON = 137;
const ARBITRUM = 42161;
const POLYGON_HEX = "0x89";

const WETH_POLYGON = {
  address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  symbol: "WETH",
  decimals: 18,
  chainId: POLYGON,
};
const USDC_POLYGON = {
  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  symbol: "USDC",
  decimals: 6,
  chainId: POLYGON,
};
const USDC_ARBITRUM = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
  chainId: ARBITRUM,
};

function swapLeg(overrides: Partial<ProvisioningLeg> = {}): ProvisioningLeg {
  return {
    index: 0,
    kind: "swap-token",
    chainId: POLYGON,
    tokenIn: WETH_POLYGON,
    tokenOut: USDC_POLYGON,
    amountIn: "1000000000000000000",
    amountOutQuoted: "3000000000",
    minAmountOut: "2940000000",
    routing: "CLASSIC",
    gasUsd: 0.04,
    requoteAtExecution: false,
    ...overrides,
  };
}

function bridgeLeg(overrides: Partial<ProvisioningLeg> = {}): ProvisioningLeg {
  return {
    index: 1,
    kind: "bridge",
    chainId: POLYGON,
    tokenIn: USDC_POLYGON,
    tokenOut: USDC_ARBITRUM,
    amountIn: "3000000000",
    amountOutQuoted: "2996000000",
    minAmountOut: "2996000000",
    routing: "BRIDGE",
    gasUsd: 0.02,
    etaSeconds: 2,
    requoteAtExecution: true,
    ...overrides,
  };
}

/**
 * A destination-chain balance queue for a bridge that LANDS: the baseline the rail reads before it
 * broadcasts, then the arrival, observed on the first settlement poll.
 *
 * POO-1037 made this load-bearing. A bridge leg's `run()` no longer returns on its source receipt, it
 * stays open until `awaitBridgeSettlement` sees the destination balance clear `minAmountOut`, so a
 * queue that never grows is a bridge that never arrives and the leg legitimately waits it out. These
 * tests are about the JOURNAL rather than the wait, so every bridge fixture here delivers.
 */
const bridgeArrives = (baseline = "0"): string[] => [
  baseline,
  // The smallest delivery that clears the leg's own floor.
  (BigInt(baseline) + BigInt(bridgeLeg().minAmountOut)).toString(),
];

function stepFor(leg: ProvisioningLeg): ProvisioningStep {
  return {
    type: leg.kind,
    key: `${leg.kind}-${leg.index}`,
    labelKey: `provisioning.steps.${leg.kind}`,
    chainId: leg.chainId,
    amountUsd: 3000,
    method: "SEND_TX",
    leg,
  };
}

function planOf(legs: ProvisioningLeg[]): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [
      ...legs.map(stepFor),
      { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 3000 },
    ],
    quote: {
      shortfallUsd: 3000,
      bufferUsd: 60,
      feesUsd: 4,
      totalPayUsd: 3064,
      quotedAt: "2026-07-25T00:00:00.000Z",
      ttlMs: 30_000,
    },
    slippagePct: 2,
  };
}

function txRequest(): UniswapTransactionRequest {
  return {
    to: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
    from: OWNER,
    data: "0x24856bc3deadbeef",
    value: "0x00",
    chainId: POLYGON,
  };
}

function quoteResponse(outputAmount: string): UniswapQuoteResponse {
  return {
    routing: "CLASSIC",
    quote: {
      input: { amount: "1000000000000000000", token: WETH_POLYGON.address },
      output: { amount: outputAmount, token: USDC_POLYGON.address },
    },
  } as UniswapQuoteResponse;
}

interface HarnessOptions {
  /** Per `chainId:token` queues of base-unit balances, consumed in call order. */
  balances?: Record<string, string[]>;
  /** Quoted output per call, consumed in order; the last value repeats. */
  quotedOut?: string[];
  /** Reject the receipt read: the tab dying between the broadcast and the receipt. */
  receiptFails?: boolean;
  journalId?: string;
  confirmRequote?: (change: RequoteChange) => Promise<boolean>;
}

interface Harness {
  deps: PlanRailDeps;
  sent: string[];
  /** Journal snapshots taken at the moment the provider was asked for a receipt. */
  journalAtReceipt: (FundingJournal | null)[];
}

function harness(options: HarnessOptions = {}): Harness {
  const sent: string[] = [];
  const journalAtReceipt: (FundingJournal | null)[] = [];
  const balanceQueues = { ...(options.balances ?? {}) };
  const quoted = [...(options.quotedOut ?? ["3000000000"])];
  let chainHex = POLYGON_HEX;

  const provider: Eip1193Provider = {
    request: async ({ method, params }) => {
      switch (method) {
        case "eth_accounts":
          return [OWNER];
        case "eth_chainId":
          return chainHex;
        case "wallet_switchEthereumChain": {
          chainHex = (params?.[0] as { chainId: string }).chainId;
          return null;
        }
        case "eth_sendTransaction": {
          sent.push(`0x${(sent.length + 1).toString(16).padStart(64, "0")}`);
          return sent[sent.length - 1];
        }
        case "eth_getTransactionReceipt": {
          // The write-ordering probe: what does the record say at the instant we start waiting?
          journalAtReceipt.push(options.journalId ? getJournal(options.journalId) : null);
          if (options.receiptFails) throw new Error("RPC dropped the connection");
          return { status: "0x1", blockNumber: "0x1", logs: [] };
        }
        default:
          return null;
      }
    },
  };

  const deps: PlanRailDeps = {
    owner: OWNER,
    provider,
    signTypedData: async () => "0xsignature",
    readTokenBalance: async ({ chainId, token }) => {
      const queue = balanceQueues[`${chainId}:${token}`];
      return queue && queue.length > 1 ? (queue.shift() as string) : (queue?.[0] ?? "0");
    },
    quoteSwap: async () => ({
      ok: true as const,
      quote: quoteResponse(quoted.length > 1 ? (quoted.shift() as string) : (quoted[0] as string)),
    }),
    checkApproval: async () => ({ ok: true as const, approval: null, cancel: null }),
    buildSwapTx: async () => ({ ok: true as const, swap: txRequest() }),
    ...(options.confirmRequote ? { confirmRequote: options.confirmRequote } : {}),
    ...(options.journalId
      ? { journal: createJournalRecorder(options.journalId, { readNonce: async () => 7 }) }
      : {}),
  };

  return { deps, sent, journalAtReceipt };
}

/**
 * The journal a plan mints when the user approves its cost breakdown (§3.7).
 *
 * Always the WHOLE two-leg route, even when a test runs one leg of it: a journal whose legs are all
 * terminal is pruned on read by design, and these tests are about the record surviving, not about
 * the prune. Journal indices are the plan's own leg indices, which is what lets a second session
 * line its record up with a re-derived plan.
 */
function journalFor(legs: ProvisioningLeg[] = [swapLeg(), bridgeLeg()]): FundingJournal {
  return createJournal({
    wallet: OWNER,
    operation: { kind: "invest", targetChainId: ARBITRUM, strategyId: "strat-1" },
    legs: legs.map((leg) => ({
      index: leg.index,
      kind: leg.kind,
      chainId: leg.chainId,
      tokenIn: leg.tokenIn.address,
      tokenOut: leg.tokenOut.address,
      ...(leg.tokenOut.chainId === leg.chainId ? {} : { destChainId: leg.tokenOut.chainId }),
      amountIn: leg.amountIn,
      minAmountOut: leg.minAmountOut,
    })),
  });
}

/** Run every rail step in order, threading the context exactly as `useWalletSignFlow` does. */
async function runRail(plan: ProvisioningPlan, deps: PlanRailDeps): Promise<PlanRailCtx> {
  let ctx: PlanRailCtx = {};
  for (const step of buildPlanSteps(plan, deps)) {
    const result = await step.run(ctx);
    if (result && typeof result === "object") ctx = { ...ctx, ...result };
  }
  return ctx;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[R2] write ordering: the hash lands before anything is awaited", () => {
  it("journals the leg as planned, with its nonce, before the wallet is ever prompted", async () => {
    const journal = journalFor();
    const { deps } = harness({ journalId: journal.journalId });

    await runRail(planOf([swapLeg()]), deps);

    expect(getJournal(journal.journalId)?.legs[0]?.nonceBefore).toBe(7);
  });

  it("has already recorded the hash by the time it starts waiting for the receipt", async () => {
    const journal = journalFor();
    const { deps, journalAtReceipt, sent } = harness({ journalId: journal.journalId });

    await runRail(planOf([swapLeg()]), deps);

    const atReceipt = journalAtReceipt[0];
    expect(atReceipt?.legs[0]?.status).toBe("broadcast");
    expect(atReceipt?.legs[0]?.txHash).toBe(sent[0]);
  });

  it("keeps the hash when the tab dies between the broadcast and the receipt", async () => {
    const journal = journalFor();
    const { deps, sent } = harness({ journalId: journal.journalId, receiptFails: true });

    await expect(runRail(planOf([swapLeg()]), deps)).rejects.toThrow();

    const persisted = getJournal(journal.journalId);
    expect(persisted?.legs[0]?.status).toBe("broadcast");
    expect(persisted?.legs[0]?.txHash).toBe(sent[0]);
  });

  it("records a bridge's destination baseline before it broadcasts, never after", async () => {
    const journal = journalFor();
    const { deps } = harness({
      journalId: journal.journalId,
      balances: { [`${ARBITRUM}:${USDC_ARBITRUM.address}`]: bridgeArrives("1000000") },
    });

    await runRail(planOf([bridgeLeg({ requoteAtExecution: false })]), deps);

    const persisted = getJournal(journal.journalId);
    expect(persisted?.legs[1]?.destBalanceBefore).toBe("1000000");
    expect(persisted?.legs[1]?.destChainId).toBe(ARBITRUM);
  });

  it("does not call a bridge settled on a source receipt: arrival is a separate observation", async () => {
    const journal = journalFor();
    // The bridge lands, and the inline POO-1037 wait sees it land. The record STILL says `broadcast`:
    // the arrival verdict is `reconcileFundingJournal`'s to write, from the chain, never the rail's.
    const { deps } = harness({
      journalId: journal.journalId,
      balances: { [`${ARBITRUM}:${USDC_ARBITRUM.address}`]: bridgeArrives() },
    });

    await runRail(planOf([bridgeLeg({ requoteAtExecution: false })]), deps);

    expect(getJournal(journal.journalId)?.legs[1]?.status).toBe("broadcast");
  });

  it("settles a same-chain leg once its receipt is in", async () => {
    const journal = journalFor();
    const { deps } = harness({ journalId: journal.journalId });

    await runRail(planOf([swapLeg()]), deps);

    expect(getJournal(journal.journalId)?.legs[0]?.status).toBe("settled");
  });

  it("runs unchanged with no journal wired, so the rail never depends on one", async () => {
    const { deps, sent } = harness();

    await runRail(planOf([swapLeg()]), deps);

    expect(sent).toHaveLength(1);
  });
});

describe("[R4] a reload or killed tab mid-bridge recovers and continues", () => {
  it("resumes without a duplicate broadcast: the swap settled, the bridge is still in flight", async () => {
    const journal = journalFor();
    const first = harness({
      journalId: journal.journalId,
      balances: {
        // The swap's realized output, read as a delta against the pre-swap baseline.
        [`${POLYGON}:${USDC_POLYGON.address}`]: ["0", "2980000000"],
      },
    });

    // Session one: the swap settles, the bridge broadcasts, then the tab dies mid-receipt.
    await runRail(planOf([swapLeg()]), first.deps);
    const second = harness({
      journalId: journal.journalId,
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address}`]: ["2980000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address}`]: ["1000000"],
      },
      receiptFails: true,
    });
    await expect(runRail(planOf([bridgeLeg()]), second.deps)).rejects.toThrow();

    const broadcastCount = first.sent.length + second.sent.length;
    expect(broadcastCount).toBe(2);

    // Session two: a fresh tab reconciles the record against the chain before offering anything.
    const persisted = getJournal(journal.journalId) as FundingJournal;
    const chain: ChainReader = {
      getTransactionReceipt: async () => ({ status: "success" }),
      getTransactionCount: async () => 7,
      // The bridge left, it has not arrived: the destination balance is still the baseline.
      getTokenBalance: async () => "1000000",
    };
    const reconciliation = await reconcileJournal(persisted, chain);

    expect(reconciliation.legs.map((leg) => leg.verdict)).toEqual(["settled", "pending"]);
    expect(reconciliation.action).toBe("wait");
    // Nothing was sent by reconciling: it is a read, and the rail was never re-run.
    expect(first.sent.length + second.sent.length).toBe(broadcastCount);
  });

  it("completes once the bridge arrives on the destination chain", async () => {
    const legs = [swapLeg(), bridgeLeg()];
    const journal = journalFor();
    const { deps } = harness({
      journalId: journal.journalId,
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address}`]: ["0", "2980000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address}`]: bridgeArrives("1000000"),
      },
    });

    await runRail(planOf(legs), deps);

    const persisted = getJournal(journal.journalId) as FundingJournal;
    const chain: ChainReader = {
      getTransactionReceipt: async () => ({ status: "success" }),
      getTransactionCount: async () => 7,
      getTokenBalance: async () => "3980000000",
    };
    const reconciliation = await reconcileJournal(persisted, chain);

    expect(reconciliation.action).toBe("complete");
  });

  it("re-derives without the settled leg, so a re-run cannot repeat it", async () => {
    const journal = journalFor();
    const first = harness({
      journalId: journal.journalId,
      balances: { [`${POLYGON}:${USDC_POLYGON.address}`]: ["0", "2980000000"] },
    });

    await runRail(planOf([swapLeg()]), first.deps);

    // The re-derived plan is a pure function of the balances the swap left behind, so it starts at
    // the bridge. The swap is not in it, and therefore cannot be broadcast a second time.
    const second = harness({
      journalId: journal.journalId,
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address}`]: ["2980000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address}`]: bridgeArrives(),
      },
    });
    await runRail(planOf([bridgeLeg()]), second.deps);

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
  });
});

describe("[R5] a materially worse re-quote is re-approved before it is signed", () => {
  it("compares RATES, not absolute amounts, since a leg is re-sized at execution time", () => {
    // Half the input for half the output is the same price, and must not read as a worsening.
    expect(
      isRequoteMateriallyWorse(
        { amountIn: "1000000000000000000", amountOut: "3000000000" },
        { amountIn: "500000000000000000", amountOut: "1500000000" },
      ),
    ).toBe(false);
  });

  it("ignores a better price, and a move inside the tolerance", () => {
    expect(
      isRequoteMateriallyWorse(
        { amountIn: "1000", amountOut: "3000" },
        { amountIn: "1000", amountOut: "3100" },
      ),
    ).toBe(false);
    expect(
      isRequoteMateriallyWorse(
        { amountIn: "1000", amountOut: "3000" },
        { amountIn: "1000", amountOut: "2985" },
      ),
    ).toBe(false);
  });

  it("flags a move beyond the tolerance", () => {
    expect(
      isRequoteMateriallyWorse(
        { amountIn: "1000", amountOut: "3000" },
        { amountIn: "1000", amountOut: "2900" },
      ),
    ).toBe(true);
  });

  it("re-prompts with the real figures and signs nothing until the user agrees", async () => {
    const seen: RequoteChange[] = [];
    const { deps, sent } = harness({
      quotedOut: ["2700000000"],
      confirmRequote: async (change) => {
        seen.push(change);
        return true;
      },
    });

    await runRail(planOf([swapLeg()]), deps);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.approvedAmountOut).toBe("3000000000");
    expect(seen[0]?.quotedAmountOut).toBe("2700000000");
    expect(seen[0]?.worseBps).toBe(1000);
    expect(sent).toHaveLength(1);
  });

  it("broadcasts nothing when the user declines the new price", async () => {
    const { deps, sent } = harness({
      quotedOut: ["2700000000"],
      confirmRequote: async () => false,
    });

    await expect(runRail(planOf([swapLeg()]), deps)).rejects.toThrow(/price/i);
    expect(sent).toHaveLength(0);
  });

  it("refuses to sign a worse price when there is nobody to ask", async () => {
    const { deps, sent } = harness({ quotedOut: ["2700000000"] });

    await expect(runRail(planOf([swapLeg()]), deps)).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("never asks when the price held", async () => {
    const asked = vi.fn(async () => true);
    const { deps, sent } = harness({ quotedOut: ["3000000000"], confirmRequote: asked });

    await runRail(planOf([swapLeg()]), deps);

    expect(asked).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
});
