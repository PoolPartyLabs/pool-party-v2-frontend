/**
 * @id PP-STR-HOK-020 (POO-1043)
 * @name useProvisioningRail — journal + re-quote binding tests
 * @implements-rules-version v2 (POO-1043 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The two loose ends POO-1042 left on the bound rail, closed here:
 *
 *   [R7] the rail gets a REAL recovery journal, minted at the confirm. Without it POO-1038's
 *        idempotency machinery does not run in production at all, and a killed tab mid-bridge has no
 *        in-flight record to reconcile.
 *   [R8] a materially worse re-quote reaches a CONFIRMER instead of aborting the leg. Refusing is the
 *        correct default with nobody to ask; it is a dead end once there is somebody.
 *
 * The rail runs for real: the wallet is an EIP-1193 handler map (so the shipped chain and account
 * assertions execute), and the journal is the real `localStorage` store, because the property under
 * test IS the persistence and its ordering. No network, no timers.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse } from "@/lib/uniswap/schemas";
import type { RequoteChange } from "../lib/buildPlanSteps";
import { FUNDING_JOURNAL_KEY, type FundingJournal } from "../lib/fundingJournal";

const OWNER = "0xC3673ADc0000000000000000000000000000BEEF";
const POLYGON = 137;
const POLYGON_HEX = "0x89";
const ARBITRUM = 42161;

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

const mocks = vi.hoisted(() => ({
  activeAddress: "0xC3673ADc0000000000000000000000000000BEEF" as string | undefined,
  /** Base-unit output the fresh `/quote` offers. Worsened per-test to trip the re-quote gate. */
  quotedOut: "3000000000",
  nonce: 7,
  sent: [] as string[],
  /** Journal snapshots taken the instant the provider is asked for a receipt (the §3.4 probe). */
  journalAtReceipt: [] as (FundingJournal | undefined)[],
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({
    wallets: [
      {
        address: OWNER,
        getEthereumProvider: async (): Promise<Eip1193Provider> => provider,
      },
    ],
  }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0xsignature" }) }),
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.activeAddress }) }));

// PP-INTEGRATION-POINT (ADR 0003): the three Uniswap calls are `"use server"` actions. The rail
// injects them, so the suite replaces functions rather than a transport, and no key is involved.
vi.mock("@/lib/uniswap/actions", () => ({
  quoteSwap: async () => ({
    ok: true as const,
    quote: {
      routing: "CLASSIC",
      quote: {
        input: { amount: "1000000000000000000", token: WETH_POLYGON.address },
        output: { amount: mocks.quotedOut, token: USDC_POLYGON.address },
      },
    } as UniswapQuoteResponse,
  }),
  checkApproval: async () => ({ ok: true as const, approval: null, cancel: null }),
  buildSwapTx: async () => ({
    ok: true as const,
    swap: {
      to: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
      from: OWNER,
      data: "0x24856bc3deadbeef",
      value: "0x00",
      chainId: POLYGON,
    },
  }),
}));

// The chain reads the rail and the journal make. Balances are irrelevant to these rules (the swap
// leg is not re-sized), so one flat figure is honest; the NONCE is what §3.4 step 1 turns on.
vi.mock("@/lib/tokens/readErc20", () => ({
  readErc20Balance: async () => BigInt("1000000000000000000"),
  readNativeBalance: async () => BigInt("1000000000000000000"),
  readTransactionCount: async () => mocks.nonce,
}));

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
        mocks.sent.push(`0x${(mocks.sent.length + 1).toString(16).padStart(64, "0")}`);
        return mocks.sent[mocks.sent.length - 1];
      }
      case "eth_getTransactionReceipt": {
        mocks.journalAtReceipt.push(storedJournals()[0]);
        return { status: "0x1", blockNumber: "0x1", logs: [] };
      }
      default:
        return null;
    }
  },
};
let chainHex = POLYGON_HEX;

import { useProvisioningRail } from "./useProvisioningRail";

/** Read the store WITHOUT `readJournals`, which prunes a fully-terminal record on sight. */
function storedJournals(): FundingJournal[] {
  const raw = localStorage.getItem(FUNDING_JOURNAL_KEY);
  return raw ? (JSON.parse(raw) as { journals: FundingJournal[] }).journals : [];
}

const SWAP_LEG: ProvisioningLeg = {
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
};

const SWAP_STEP: ProvisioningStep = {
  type: "swap-token",
  key: "swap-token-0",
  labelKey: "provisioning.steps.swapToken",
  chainId: POLYGON,
  amountUsd: 3000,
  method: "SEND_TX",
  leg: SWAP_LEG,
};

function plan(): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [
      SWAP_STEP,
      { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 3000 },
    ],
    quote: {
      shortfallUsd: 3000,
      bufferUsd: 60,
      feesUsd: 4,
      totalPayUsd: 3064,
      quotedAt: "2026-07-25T12:00:00.000Z",
      ttlMs: 30_000,
    },
    slippagePct: 2,
  };
}

const OPERATION = { kind: "invest" as const, targetChainId: ARBITRUM, strategyId: "strat-1" };

/** Run every rail step in order, threading the context exactly as `useWalletSignFlow` does. */
async function runRail(
  steps: { key: string; run: (ctx: Record<string, unknown>) => Promise<unknown> }[],
): Promise<void> {
  let ctx: Record<string, unknown> = {};
  for (const step of steps) {
    const result = (await step.run(ctx)) as Record<string, unknown> | undefined;
    const { txHash: _hash, skipped: _skipped, ...partial } = result ?? {};
    ctx = { ...ctx, ...partial };
  }
}

function mountRail(options: Parameters<typeof useProvisioningRail>[0] = {}) {
  return renderHook(() => useProvisioningRail(options)).result;
}

beforeEach(() => {
  localStorage.clear();
  chainHex = POLYGON_HEX;
  mocks.activeAddress = OWNER;
  mocks.quotedOut = "3000000000";
  mocks.nonce = 7;
  mocks.sent = [];
  mocks.journalAtReceipt = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useProvisioningRail — the recovery journal [R7]", () => {
  it("mints nothing until the user confirms the route", () => {
    const rail = mountRail({ operation: OPERATION });
    // Building the steps is what happens when the PLAN resolves, which is not consent (§3.7).
    rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} });

    expect(storedJournals()).toEqual([]);
  });

  it("mints a journal carrying every leg of the approved route", () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());

    const [journal] = storedJournals();
    expect(journal?.wallet).toBe(OWNER.toLowerCase());
    expect(journal?.operation).toEqual(OPERATION);
    expect(journal?.legs).toHaveLength(1);
    expect(journal?.legs[0]).toMatchObject({
      index: 0,
      kind: "swap-token",
      chainId: POLYGON,
      tokenIn: WETH_POLYGON.address,
      tokenOut: USDC_POLYGON.address,
      amountIn: SWAP_LEG.amountIn,
      status: "planned",
    });
  });

  it("records the executed leg, which is the whole point of binding it", async () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());
    await runRail(rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} }) ?? []);

    expect(storedJournals()[0]?.legs[0]).toMatchObject({
      status: "settled",
      nonceBefore: 7,
      txHash: mocks.sent[0],
    });
  });

  it("holds the §3.4 ordering: the hash is durable BEFORE the receipt is awaited", async () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());
    await runRail(rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} }) ?? []);

    // The probe fires inside `eth_getTransactionReceipt`, i.e. the instant the rail starts waiting.
    // A hash written after that await is a hash a closed tab loses, and for a bridge that is a
    // second deposit of the same money.
    expect(mocks.journalAtReceipt).toHaveLength(1);
    expect(mocks.journalAtReceipt[0]?.legs[0]).toMatchObject({
      status: "broadcast",
      txHash: mocks.sent[0],
    });
  });

  it("retires the journal when the route completes, so nothing reads as in flight", async () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());
    await runRail(rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} }) ?? []);
    rail.current.closeJournal();

    expect(storedJournals()).toEqual([]);
  });

  it("mints nothing for a host that never said what the operation is", () => {
    const rail = mountRail();
    rail.current.openJournal(plan());

    expect(storedJournals()).toEqual([]);
  });
});

describe("useProvisioningRail — the re-quote confirmer [R8]", () => {
  it("asks the user before signing a materially worse price", async () => {
    // 10% worse than the 3,000,000,000 the plan was approved at, i.e. far past the 100 bps gate.
    mocks.quotedOut = "2700000000";
    const confirmRequote = vi.fn(async (_change: RequoteChange) => true);
    const rail = mountRail({ operation: OPERATION });

    await runRail(
      rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {}, confirmRequote }) ?? [],
    );

    expect(confirmRequote).toHaveBeenCalledTimes(1);
    expect(confirmRequote.mock.calls[0]?.[0]).toMatchObject({ legIndex: 0 });
    // Approved, so the leg went through: the prompt is a decision point, not a dead end.
    expect(mocks.sent).toHaveLength(1);
  });

  it("sends nothing when the user declines the new price", async () => {
    mocks.quotedOut = "2700000000";
    const rail = mountRail({ operation: OPERATION });

    await expect(
      runRail(
        rail.current.buildSteps?.(plan(), {
          onLegBroadcast: () => {},
          confirmRequote: async () => false,
        }) ?? [],
      ),
    ).rejects.toMatchObject({ cause: { code: "PROVISIONING_REQUOTE_REJECTED" } });
    expect(mocks.sent).toEqual([]);
  });

  it("never prompts when the price did not move against the user", async () => {
    const confirmRequote = vi.fn(async (_change: RequoteChange) => true);
    const rail = mountRail({ operation: OPERATION });

    await runRail(
      rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {}, confirmRequote }) ?? [],
    );

    // Re-prompting on every basis point trains people to click through the prompt.
    expect(confirmRequote).not.toHaveBeenCalled();
    expect(mocks.sent).toHaveLength(1);
  });
});
