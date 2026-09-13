/**
 * @id PP-DEP-LIB-004
 * @name standalone on-ramp plan builder — tests
 *
 * Tests the bespoke STANDALONE fiat purchase plan ([R1] standalone gas trigger, [R3] stop at USDC).
 * The sizing itself is exhaustively tested in `sizeOnRampOrder.test.ts`; these tests pin the PLAN
 * mapping this module adds on top: which display steps it emits, that it NEVER bridges or anchors an
 * op, and that the settlement scope token is the one the order bought.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planJournalLegs, planRailSteps } from "@/features/strategies/lib/buildPlanSteps";
import { createJournal } from "@/features/strategies/lib/fundingJournal";
import type { TokenBalance } from "@/lib/balances/types";
import type { TokenDelta } from "@/lib/onramp/tokenDeltas";
import { ONRAMP_CHAIN_ID, PAYBIS_MIN_USD } from "@/lib/provisioning/computeNeed";
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";
import {
  buildStandaloneOnRampPlan,
  buildStandaloneSwapPlan,
  findStandaloneSwapResume,
  readBaseNativeEth,
  STANDALONE_SWAP_LEG_INDEX,
  settledSwapBaseUnits,
} from "./standaloneOnRampPlan";

/** A minimal Base-native holding used to price the gas floor. */
function baseEth(amount: number, usd: number): TokenBalance {
  return {
    symbol: "ETH",
    name: "Ethereum",
    amount,
    decimals: 18,
    usd,
    chainId: ONRAMP_CHAIN_ID,
    logoUrl: "",
    isNative: true,
    address: "0x0000000000000000000000000000000000000000",
  };
}

describe("buildStandaloneOnRampPlan", () => {
  // @rule R1 (standalone): native ETH on Base below the floor => buy ETH-BASE, then swap to USDC.
  it("buys ETH-BASE and emits a swap-to-USDC step when Base gas is below the floor", () => {
    const { plan, order, expectedToken, needsSwapToUsdc } = buildStandaloneOnRampPlan({
      receiveUsd: 100,
      baseNativeEth: 0,
      ethUsd: 3000,
    });

    expect(order.currencyCode).toBe("ETH-BASE");
    expect(expectedToken).toBe("ETH-BASE");
    expect(needsSwapToUsdc).toBe(true);

    const buy = plan.steps.find((s) => s.type === "buy");
    const swap = plan.steps.find((s) => s.type === "swap-token");
    expect(buy).toBeDefined();
    expect(swap).toBeDefined();
    expect(buy?.toToken).toBe("ETH");
    expect(buy?.toChainId).toBe(ONRAMP_CHAIN_ID);
    expect(swap?.fromToken).toBe("ETH");
    expect(swap?.toToken).toBe("USDC");
    expect(swap?.fromChainId).toBe(ONRAMP_CHAIN_ID);
    expect(swap?.toChainId).toBe(ONRAMP_CHAIN_ID);
    // The swap converts the op-funding slice (the entered receive amount), so the rail reserves the
    // gas share of the settled delta from the fraction buy-swap.amountUsd / buy.amountUsd.
    expect(swap?.amountUsd).toBe(100);
  });

  // @rule R1 (standalone): native ETH at/above the floor => buy USDC-BASE directly, no swap leg.
  it("buys USDC-BASE directly with no swap step when Base gas already covers the floor", () => {
    const { plan, order, expectedToken, needsSwapToUsdc } = buildStandaloneOnRampPlan({
      receiveUsd: 100,
      baseNativeEth: NATIVE_RESERVE_ETH + 0.01,
      ethUsd: 3000,
    });

    expect(order.currencyCode).toBe("USDC-BASE");
    expect(expectedToken).toBe("USDC-BASE");
    expect(needsSwapToUsdc).toBe(false);
    expect(plan.steps.find((s) => s.type === "swap-token")).toBeUndefined();
    const buy = plan.steps.find((s) => s.type === "buy");
    expect(buy?.toToken).toBe("USDC");
  });

  // @rule R3: a standalone purchase ALWAYS stops at USDC — never a bridge, never an op anchor, even
  // when the wallet is short on gas (the ETH branch) and would bridge in-flow.
  it("never emits a bridge or op step (stops at USDC on Base)", () => {
    for (const baseNativeEth of [0, NATIVE_RESERVE_ETH + 1]) {
      const { plan } = buildStandaloneOnRampPlan({ receiveUsd: 250, baseNativeEth, ethUsd: 3000 });
      expect(plan.steps.some((s) => s.type === "bridge")).toBe(false);
      expect(plan.steps.some((s) => s.type === "bridge-gas")).toBe(false);
      expect(plan.steps.some((s) => s.type === "op")).toBe(false);
    }
  });

  // @rule R1 (amount): the order pre-fill is the fiat amount sizeOnRampOrder decided; the buy step
  // mirrors it on `amountToken` so the widget pre-fill and the plan card cannot disagree.
  it("carries the order and floors the fiat amount at the Paybis minimum", () => {
    const { plan, order } = buildStandaloneOnRampPlan({
      receiveUsd: 4, // below the $10 Paybis minimum
      baseNativeEth: 5,
      ethUsd: 3000,
    });
    expect(order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
    expect(order.fiatCurrency).toBe("USD");
    const buy = plan.steps.find((s) => s.type === "buy");
    expect(buy?.amountToken).toBe(PAYBIS_MIN_USD.toFixed(2));
    expect(buy?.poweredBy).toBe("paybis");
    expect(buy?.order).toEqual(order);
  });

  // The plan carries the investor default slippage so the reused rail sizes the swap buffer with it.
  it("sets the investor-default slippage on the plan", () => {
    const { plan } = buildStandaloneOnRampPlan({ receiveUsd: 100, baseNativeEth: 0, ethUsd: 3000 });
    expect(plan.slippagePct).toBe(2);
  });

  // A zero/absent ethUsd (an empty wallet cannot price ETH) still buys ETH-BASE below the floor; the
  // gas component collapses to 0 exactly as [R1]'s amount rule states, and the order floors at $10.
  it("still buys ETH-BASE below the floor when ETH cannot be priced", () => {
    const { order, needsSwapToUsdc } = buildStandaloneOnRampPlan({
      receiveUsd: 100,
      baseNativeEth: 0,
      ethUsd: 0,
    });
    expect(order.currencyCode).toBe("ETH-BASE");
    expect(needsSwapToUsdc).toBe(true);
  });
});

describe("readBaseNativeEth", () => {
  // Picks the Base native holding and prices ETH from its usd/amount ratio.
  it("returns the Base native ETH amount and its USD price", () => {
    const { eth, ethUsd } = readBaseNativeEth([
      baseEth(0.5, 1500),
      // A non-Base native and a Base token must not be read as Base gas.
      { ...baseEth(2, 6000), chainId: 42161 },
      { ...baseEth(0, 0), symbol: "USDC", isNative: false, decimals: 6 },
    ]);
    expect(eth).toBe(0.5);
    expect(ethUsd).toBe(3000);
  });

  // A wallet with no Base native holding (the gas-first case) reads a safe zero — below any floor.
  it("returns zeros when the wallet holds no Base native coin", () => {
    expect(readBaseNativeEth([])).toEqual({ eth: 0, ethUsd: 0 });
    expect(readBaseNativeEth([{ ...baseEth(1, 3000), chainId: 42161 }])).toEqual({
      eth: 0,
      ethUsd: 0,
    });
  });

  // A zero-amount native row cannot price ETH; the price degrades to 0 rather than dividing by zero.
  it("does not divide by zero when the native amount is zero", () => {
    expect(readBaseNativeEth([baseEth(0, 0)])).toEqual({ eth: 0, ethUsd: 0 });
  });
});

/** An ETH-first plan: $100 to receive, an empty-ish Base wallet priced at $3000/ETH. */
function ethFirstPlan() {
  return buildStandaloneOnRampPlan({ receiveUsd: 100, baseNativeEth: 0.0001, ethUsd: 3000 }).plan;
}

/** The purchase's observed delta: 0.0343 ETH on Base, worth $103 (the deposit plus its gas share). */
const ETH_DELTA: TokenDelta = {
  chainId: ONRAMP_CHAIN_ID,
  symbol: "ETH",
  decimals: 18,
  address: "0x0000000000000000000000000000000000000000",
  amount: 0.0343,
  usd: 103,
  amountExact: "0.0343",
};

describe("the settled-but-unconverted window", () => {
  const WALLET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  // The fitness function behind the whole record: the journal only reconciles the leg the rail is
  // running if both agree on its index. If `planRailSteps` ever re-numbers the fiat sub-route, this
  // fails here rather than silently splitting one conversion across two journal entries.
  it("pins the swap leg index the rail assigns a standalone plan", () => {
    const swapStep = planRailSteps(ethFirstPlan()).find((step) => step.key === "buy-swap");
    expect(swapStep?.kind).toBe("leg");
    expect(swapStep?.kind === "leg" ? swapStep.leg?.index : undefined).toBe(
      STANDALONE_SWAP_LEG_INDEX,
    );
  });

  // @rule R4/R1: what converts is the FUNDING share of what the purchase actually delivered, so the
  // gas share stays native and the conversion transaction can be paid for.
  it("sizes the recorded conversion from the observed delta, reserving the gas share", () => {
    const amountIn = settledSwapBaseUnits(ethFirstPlan(), [ETH_DELTA]);
    // 0.0343 ETH in wei, times the plan's own 100/103 funding share.
    expect(amountIn).toBe(
      ((BigInt("34300000000000000") * BigInt(9709)) / BigInt(10_000)).toString(),
    );
  });

  // A USDC-direct purchase owes no conversion, so nothing is recorded and nothing is resumable.
  it("records nothing for a purchase that already delivered USDC", () => {
    const { plan } = buildStandaloneOnRampPlan({
      receiveUsd: 100,
      baseNativeEth: NATIVE_RESERVE_ETH + 1,
      ethUsd: 3000,
    });
    expect(settledSwapBaseUnits(plan, [{ ...ETH_DELTA, symbol: "USDC", decimals: 6 }])).toBeNull();
  });

  // A delta in some other token (or on another chain) is not this purchase and never sizes its swap.
  it("ignores a delta that is not native growth on the on-ramp chain", () => {
    expect(settledSwapBaseUnits(ethFirstPlan(), [])).toBeNull();
    expect(settledSwapBaseUnits(ethFirstPlan(), [{ ...ETH_DELTA, chainId: 42161 }])).toBeNull();
  });

  // @rule R3: the resume plan is the conversion ALONE. No buy step is the whole point: a plan with no
  // buy cannot mint a second Paybis request, whatever the wallet's balances now look like.
  it("builds a conversion-only plan with a real, executable leg", () => {
    const plan = buildStandaloneSwapPlan({ amountIn: "33300000000000000" });
    expect(plan.steps.map((step) => step.type)).toEqual(["swap-token"]);
    expect(plan.steps.some((step) => step.type === "buy")).toBe(false);
    expect(plan.steps.some((step) => step.type === "bridge" || step.type === "op")).toBe(false);
    const leg = plan.steps[0]?.leg;
    expect(leg?.chainId).toBe(ONRAMP_CHAIN_ID);
    expect(leg?.tokenIn.symbol).toBe("ETH");
    expect(leg?.tokenOut.symbol).toBe("USDC");
    expect(leg?.amountIn).toBe("33300000000000000");
    // Re-sized against the live balance at execution, so it never spends more than is still there.
    expect(leg?.requoteAtExecution).toBe(true);
    // The rail expands it into exactly one executable step, with no approval (native needs none).
    expect(planRailSteps(plan).map((step) => step.key)).toEqual(["buy-swap"]);
  });

  it("finds nothing when no purchase is awaiting conversion", () => {
    expect(findStandaloneSwapResume(WALLET)).toBeNull();
  });

  // The tab-death guarantee: the record written at settlement is the plan a later mount runs.
  it("resumes a recorded conversion for the same wallet", () => {
    const amountIn = settledSwapBaseUnits(ethFirstPlan(), [ETH_DELTA]) as string;
    const journal = createJournal({
      wallet: WALLET,
      operation: { kind: "deposit", targetChainId: ONRAMP_CHAIN_ID },
      legs: planJournalLegs(buildStandaloneSwapPlan({ amountIn })),
    });

    const resume = findStandaloneSwapResume(WALLET);
    expect(resume?.journalId).toBe(journal.journalId);
    expect(resume?.plan.steps[0]?.leg?.amountIn).toBe(amountIn);
    // Case-insensitive on the address, like every other wallet comparison in the journal.
    expect(findStandaloneSwapResume(WALLET.toLowerCase())?.journalId).toBe(journal.journalId);
  });

  // Another account's money is never resumed, and neither is another operation's route: a strategy
  // funding journal is leg-shaped the same way and would otherwise be run as a deposit conversion.
  it("never resumes another wallet's or another operation's record", () => {
    const amountIn = "33300000000000000";
    createJournal({
      wallet: "0x1111111111111111111111111111111111111111",
      operation: { kind: "deposit", targetChainId: ONRAMP_CHAIN_ID },
      legs: planJournalLegs(buildStandaloneSwapPlan({ amountIn })),
    });
    createJournal({
      wallet: WALLET,
      operation: { kind: "invest", targetChainId: ONRAMP_CHAIN_ID, strategyId: "s-1" },
      legs: planJournalLegs(buildStandaloneSwapPlan({ amountIn })),
    });
    expect(findStandaloneSwapResume(WALLET)).toBeNull();
  });

  // A conversion that already landed is done with, and a record with no usable amount is treated as
  // absent: falling back to a fresh purchase is the pre-POO-1137 behaviour, not a new failure.
  it("does not resume a settled leg or an unsized record", () => {
    createJournal({
      wallet: WALLET,
      operation: { kind: "deposit", targetChainId: ONRAMP_CHAIN_ID },
      legs: planJournalLegs(buildStandaloneSwapPlan({ amountIn: "0" })),
    });
    expect(findStandaloneSwapResume(WALLET)).toBeNull();
  });
});
