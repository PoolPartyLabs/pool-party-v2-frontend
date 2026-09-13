/**
 * @id PP-CORE-LIB-018 (POO-1596)
 * @name provisioningView — tests
 * @implements-rules-version v6 (POO-1596 rules v1) · v5 (POO-1575 rules v2) · v4 (POO-1136 / POO-1129 rules v3) · v3 (POO-1041 rules v1) · v2 (POO-1037 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Plan → view mapping across the canonical scenarios: ordered rows, 1-based badges, amount visibility
 * (bridge + zero-amount omitted), the gas + op + paybis flags, and the title key per variant. Plus
 * POO-1037 [R2]: the bridge leg's ETA copy, which comes from the quote or says nothing at all.
 *
 * POO-1041 (rules v1) adds the REAL-step half, which a mock plan structurally cannot exercise:
 *   [R1] per-step status comes from the rail, in the vocabulary `WalletSteps` consumes
 *   [R2] a bridge row carries its ETA and, once broadcast, what an explorer link needs
 *   [R3] network names derive from `src/lib/chains/config.ts`, never a local literal
 *   [R4] a missing network or hash renders NO link
 *   [R5] the mapper stays pure: keys and interpolation values only
 *   [R6] the rail expands one plan step into an approval PLUS the leg, so everything matches by KEY
 */
import { describe, expect, it } from "vitest";
import { apiNetworkForChain, chainDisplayName, getUsdcAddress } from "@/lib/chains/config";
import type { ProvisioningLeg, ProvisioningLegToken, ProvisioningStep } from "@/lib/provisioning";
import { mockComputePlan, NATIVE_TOKEN_ADDRESS, SCENARIOS } from "@/lib/provisioning";
import {
  gasTopUpStep,
  REAL_STEPS,
  realProvisioningPlan,
  USDC_ARBITRUM,
  USDC_POLYGON,
  USDG_ROBINHOOD,
} from "../../../../../tests/fixtures/realProvisioningPlan";
import type { BuyRouteQuoteState } from "../../hooks/useBuyRouteQuote";
import { planRailSteps } from "../../lib/buildPlanSteps";
import { settledSafe } from "./executionCopy";
import {
  type BuyPaymentMethods,
  bridgeEtaCopy,
  buildPlanView,
  formatPaymentMethods,
} from "./provisioningView";

/** Base USDC endpoint (POO-1136): the token a USDC-BASE fiat buy delivers and its downstream bridge spends. */
const USDC_BASE = {
  address: getUsdcAddress(8453) as string,
  symbol: "USDC",
  decimals: 6,
  chainId: 8453,
};

const NOW = "2026-06-30T12:00:00.000Z";
const view = (
  key: keyof typeof SCENARIOS,
  gas?: { presetUsd: 10 | 25 | null; amountUsd: number },
) => buildPlanView(mockComputePlan(SCENARIOS[key], { nowIso: NOW, gas }));

describe("buildPlanView", () => {
  it("gas-only: swap-gas (with amount, gas flag) → op (no amount)", () => {
    const v = view("gasOnly");
    expect(v.rows.map((r) => r.type)).toEqual(["swap-gas", "op"]);
    expect(v.rows.map((r) => r.index)).toEqual([1, 2]);
    const swap = v.rows[0];
    expect(swap?.isGas).toBe(true);
    expect(swap?.amountUsd).toBeGreaterThan(0);
    const op = v.rows[1];
    expect(op?.isOp).toBe(true);
    expect(op?.amountUsd).toBeUndefined(); // opRequiredUsdc = 0 → omitted
  });

  it("gas-only no USDC: buy (paybis) → swap-gas → op", () => {
    const v = view("gasOnlyNoUsdc");
    expect(v.rows.map((r) => r.type)).toEqual(["buy", "swap-gas", "op"]);
    expect(v.rows[0]?.attributionKey).toBe("provisioning.poweredByPaybis");
    expect(v.rows[0]?.amountUsd).toBeGreaterThan(0);
  });

  it("usdc-only: buy → op, op shows its amount", () => {
    const v = view("usdcOnly");
    expect(v.rows.map((r) => r.type)).toEqual(["buy", "op"]);
    expect(v.rows[1]?.amountUsd).toBeGreaterThan(0); // opRequiredUsdc = 100
  });

  // POO-1131: `provisioning.steps.buy` is "Buy {token}". `stepRow` would otherwise fill `{token}`
  // from `fromToken` and render "Buy USD" (the fiat side); a buy names what it DELIVERS instead.
  it("a buy row names the delivered asset, not the fiat it is bought with", () => {
    expect(view("usdcOnly").rows[0]?.tokenSymbol).toBe("USDC");
    expect(view("gasOnlyNoUsdc").rows[0]?.tokenSymbol).toBe("USDC");
  });

  it("usdc+bridge: bridge row omits its amount and carries the network name", () => {
    const v = view("usdcBridge");
    expect(v.rows.map((r) => r.type)).toEqual(["bridge", "op"]);
    const bridge = v.rows[0];
    expect(bridge?.amountUsd).toBeUndefined();
    expect(bridge?.networkName).toBe("Arbitrum");
  });

  it("worst case: buy → bridge → swap-gas → op with badges 1..4", () => {
    const v = view("usdcBridgeGas");
    expect(v.rows.map((r) => r.type)).toEqual(["buy", "bridge", "swap-gas", "op"]);
    expect(v.rows.map((r) => r.index)).toEqual([1, 2, 3, 4]);
    expect(v.rows.find((r) => r.type === "bridge")?.amountUsd).toBeUndefined();
    expect(v.rows.find((r) => r.type === "swap-gas")?.isGas).toBe(true);
  });

  it("every row carries a provisioning.* labelKey and the op is last", () => {
    const v = view("usdcBridgeGas");
    expect(v.rows.at(-1)?.isOp).toBe(true);
    for (const row of v.rows) {
      expect(row.labelKey).toMatch(/^provisioning\.steps\./);
    }
  });

  it("reflects the user-chosen gas amount on the swap-gas row", () => {
    const v = view("gasOnly", { presetUsd: 25, amountUsd: 25 });
    expect(v.rows.find((r) => r.type === "swap-gas")?.amountUsd).toBe(25);
  });
});

describe("bridgeEtaCopy — [R2] the bridge ETA comes from the quote, never from a constant", () => {
  it("reads a sub-90s fill in seconds (Base to Arbitrum USDC measured ~1s live)", () => {
    expect(bridgeEtaCopy(1)).toEqual({
      key: "provisioning.bridge.etaSeconds",
      values: { seconds: 1 },
    });
    expect(bridgeEtaCopy(45)).toEqual({
      key: "provisioning.bridge.etaSeconds",
      values: { seconds: 45 },
    });
  });

  it("switches to minutes once seconds stop reading naturally", () => {
    expect(bridgeEtaCopy(120)).toEqual({
      key: "provisioning.bridge.etaMinutes",
      values: { minutes: 2 },
    });
  });

  it("says nothing numeric when the quote gave no estimate", () => {
    // An invented "about 30 seconds" we cannot keep is worse than admitting we do not know.
    expect(bridgeEtaCopy(undefined)).toEqual({ key: "provisioning.bridge.etaUnknown" });
    expect(bridgeEtaCopy(0)).toEqual({ key: "provisioning.bridge.etaUnknown" });
    expect(bridgeEtaCopy(Number.NaN)).toEqual({ key: "provisioning.bridge.etaUnknown" });
  });

  it("never rounds a real wait down to zero", () => {
    expect(bridgeEtaCopy(0.4)).toEqual({
      key: "provisioning.bridge.etaSeconds",
      values: { seconds: 1 },
    });
  });
});

describe("buildPlanView — real steps (POO-1041)", () => {
  const plan = realProvisioningPlan();
  const rail = planRailSteps(plan);

  // [R6] The whole misalignment, named: the rail runs FOUR steps for a two-leg plan, because each
  // ERC-20 leg needs its allowance granted first. `plan.steps[i]` and the rail's step `i` are
  // therefore different steps, which is why nothing here may be matched by index.
  it("[R6] expands each leg into its approval plus the leg, in execution order", () => {
    const view = buildPlanView(plan, { railSteps: rail });

    expect(view.rows.map((row) => row.key)).toEqual([
      "approve:swap-token-0",
      "swap-token-0",
      "approve:bridge-1",
      "bridge-1",
      "op",
    ]);
    // The badges renumber over what actually runs, and the op anchor stays last.
    expect(view.rows.map((row) => row.index)).toEqual([1, 2, 3, 4, 5]);
    expect(view.rows.at(-1)?.isOp).toBe(true);
  });

  it("[R6] an approval row names the token being approved and carries no amount", () => {
    const [approval] = buildPlanView(plan, { railSteps: rail }).rows;

    expect(approval?.isApproval).toBe(true);
    expect(approval?.labelKey).toBe("sign.steps.approve");
    expect(approval?.tokenSymbol).toBe("WETH");
    // An allowance moves nothing, so pricing it would be a lie about what the user is signing.
    expect(approval?.amountUsd).toBeUndefined();
    // And it must never be mistaken for the gas row (which renders the inline gas selector) or the
    // op anchor, both of which are decided off the plan step it belongs to.
    expect(approval?.isGas).toBe(false);
    expect(approval?.isOp).toBe(false);
  });

  it("[R6] without rail steps the plan's own steps drive the rows (mock mode is unchanged)", () => {
    expect(buildPlanView(plan).rows.map((row) => row.key)).toEqual([
      "swap-token-0",
      "bridge-1",
      "op",
    ]);
  });

  // [R1] The rail's vocabulary, verbatim: idle | active | done | error | skipped.
  it("[R1] takes each row's status from the rail, defaulting to idle", () => {
    const view = buildPlanView(plan, {
      railSteps: rail,
      statusByKey: {
        "approve:swap-token-0": "skipped",
        "swap-token-0": "done",
        "approve:bridge-1": "done",
        "bridge-1": "active",
      },
    });

    expect(view.rows.map((row) => row.status)).toEqual([
      "skipped",
      "done",
      "done",
      "active",
      "idle",
    ]);
  });

  // [R6] The regression this rule exists for. Statuses arrive from `useWalletSignFlow` in RAIL
  // order; reading them positionally against `plan.steps` would paint the bridge's status onto the
  // op anchor. Keyed lookup is the only thing that survives the expansion.
  it("[R6] matches status by key, never by position in plan.steps", () => {
    const railStatuses = ["done", "done", "done", "active"] as const;
    const statusByKey = Object.fromEntries(
      rail.map((step, index) => [step.key, railStatuses[index]]),
    );
    const view = buildPlanView(plan, { railSteps: rail, statusByKey });

    const bridgeRow = view.rows.find((row) => row.key === "bridge-1");
    expect(bridgeRow?.status).toBe("active");
    // Positionally, index 3 of `plan.steps` does not even exist, and index 1 is the bridge STEP
    // while index 1 of the rail is the swap leg. The two orders genuinely disagree.
    expect(rail[1]?.key).toBe("swap-token-0");
    expect(plan.steps[1]?.key).toBe("bridge-1");
  });

  // [R2] Once the leg is broadcast the user can watch the money move, which for a transfer that
  // takes minutes is the difference between "working" and "broken".
  it("[R2] carries the broadcast hash and its explorer network onto the row", () => {
    const txHash = "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f";
    const view = buildPlanView(plan, {
      railSteps: rail,
      txHashByKey: { "bridge-1": txHash },
    });
    const bridgeRow = view.rows.find((row) => row.key === "bridge-1");

    expect(bridgeRow?.txHash).toBe(txHash);
    // The SOURCE chain: that is where the transaction we hold a hash for exists. A bridge's
    // destination chain knows nothing about it until the funds land.
    expect(bridgeRow?.explorerNetwork).toBe(apiNetworkForChain(137));
  });

  // [R4] No hash means no link. Never an explorer home page, and never a network to point it at.
  it("[R4] offers no link target at all for a row that has not broadcast", () => {
    const bridgeRow = buildPlanView(plan, { railSteps: rail }).rows.find(
      (row) => row.key === "bridge-1",
    );

    expect(bridgeRow?.txHash).toBeUndefined();
    expect(bridgeRow?.explorerNetwork).toBeUndefined();
  });

  // [R4] An unsupported chain has no explorer we can name, so the row offers none rather than
  // pointing somewhere plausible-looking and wrong.
  it("[R4] names no explorer network for a chain the app does not support", () => {
    const offChain = realProvisioningPlan({
      steps: REAL_STEPS.map((step) =>
        step.key === "bridge-1"
          ? { ...step, chainId: 1, leg: step.leg && { ...step.leg, chainId: 1 } }
          : step,
      ),
    });
    const view = buildPlanView(offChain, {
      txHashByKey: { "bridge-1": "0xabc" },
    });

    expect(view.rows.find((row) => row.key === "bridge-1")?.explorerNetwork).toBeUndefined();
  });

  // [R2] The ETA rides on the row itself, so the plan card can set expectations BEFORE the user
  // commits, not only once they are watching a step that looks stuck.
  it("[R2] carries the bridge ETA from the quote's own estimate", () => {
    const view = buildPlanView(plan, { railSteps: rail });

    expect(view.rows.find((row) => row.key === "bridge-1")?.eta).toEqual({
      key: "provisioning.bridge.etaMinutes",
      values: { minutes: 3 },
    });
    // Only the bridge waits on another chain; nothing else claims a duration it cannot know.
    expect(view.rows.find((row) => row.key === "swap-token-0")?.eta).toBeUndefined();
  });

  // [R2] A real quote priced this leg, so hiding its figure (the mock-era rule) now hides a real
  // number. A mock bridge row still shows none: there is nothing behind it.
  it("[R2] shows the bridge amount when a real leg priced it, and not when one did not", () => {
    const realBridge = buildPlanView(plan).rows.find((row) => row.type === "bridge");
    expect(realBridge?.amountUsd).toBe(120.4);

    const mockBridge = buildPlanView(
      mockComputePlan(SCENARIOS.usdcBridge, { nowIso: "2026-06-30T12:00:00.000Z" }),
    ).rows.find((row) => row.type === "bridge");
    expect(mockBridge?.amountUsd).toBeUndefined();
  });

  // [R3] The `swapToken` label reads "Convert to {token}" and the mapper never supplied the value, so
  // a real swap step rendered its raw key. The row carries the interpolation value now.
  it("[R5] carries the swap row's token as an interpolation value, not resolved copy", () => {
    const swapRow = buildPlanView(plan).rows.find((row) => row.type === "swap-token");

    expect(swapRow?.labelKey).toBe("provisioning.steps.swapToken");
    // @rule POO-1087 F4-R2 — `fromToken`, what this step spends, not `toToken`.
    expect(swapRow?.tokenSymbol).toBe("WETH");
  });
});

describe("buildPlanView — network names come from the chain config (POO-1041 [R3])", () => {
  it("[R3] names the bridge destination from the single chain config", () => {
    const plan = realProvisioningPlan();
    const bridgeRow = buildPlanView(plan).rows.find((row) => row.type === "bridge");

    expect(bridgeRow?.networkName).toBe(chainDisplayName(42161));
    expect(bridgeRow?.networkName).toBe("Arbitrum");
  });

  // [R3]/[R4] An unsupported destination has no name we can honestly render, and interpolating an
  // unresolved one would ship "Move to undefined".
  it("[R3] leaves the name off a destination the app does not support", () => {
    const offChain = realProvisioningPlan({
      steps: REAL_STEPS.map((step) => (step.key === "bridge-1" ? { ...step, toChainId: 1 } : step)),
    });
    const bridgeRow = buildPlanView(offChain).rows.find((row) => row.type === "bridge");

    expect(bridgeRow?.networkName).toBeUndefined();
  });
});

// POO-1075 — the gas-bridge row's label is "Send fees to {network}". next-intl REJECTS a message
// whose placeholder has no value, and `labelValues` omits `network` entirely when the row carries no
// `networkName`, so a row that fails to set it does not render blank: it throws. The row was keyed
// off `step.type === "bridge"`, which `bridge-gas` fails, so the feature's own step broke the card.
describe("buildPlanView — a gas-bridge row (POO-1075)", () => {
  const GAS_BRIDGE_STEP = {
    type: "bridge-gas" as const,
    key: "bridge-gas-0",
    labelKey: "provisioning.steps.bridgeGas",
    fromToken: "ETH",
    toToken: "ETH",
    fromChainId: 8453,
    toChainId: 42161,
    chainId: 8453,
    amountUsd: 1.05,
    amountToken: "0.0003",
    method: "SEND_TX" as const,
    etaSeconds: 2,
  };

  it("resolves the destination network its label interpolates", () => {
    const plan = realProvisioningPlan({ steps: [GAS_BRIDGE_STEP, ...REAL_STEPS] });
    const row = buildPlanView(plan).rows.find((candidate) => candidate.type === "bridge-gas");

    // The DESTINATION, like any bridge row: `chainId` would name where it departs from.
    expect(row?.networkName).toBe(chainDisplayName(42161));
    expect(row?.networkName).toBe("Arbitrum");
  });

  it("carries the bridge ETA, since the user waits on it like any other bridge", () => {
    const plan = realProvisioningPlan({ steps: [GAS_BRIDGE_STEP, ...REAL_STEPS] });
    const row = buildPlanView(plan).rows.find((candidate) => candidate.type === "bridge-gas");

    expect(row?.eta).toBeDefined();
  });
});

// POO-1131 / POO-1142 — the row carries the two signals settledSafe's grouping reads, both derived
// from the legs' endpoints so the figure and the plan cannot disagree.
describe("buildPlanView — continuesPrevious drives the settled-safe grouping (POO-1142)", () => {
  it("marks a bridge that consumes the previous leg's output as continuing it", () => {
    // The flagship route: swap WETH→USDC on Polygon, then bridge that USDC to Arbitrum. The bridge's
    // input IS the swap's output (same token, same chain), so it continues the route.
    const rows = buildPlanView(realProvisioningPlan()).rows;
    // The first value leg continues nothing before it.
    expect(rows.find((r) => r.type === "swap-token")?.continuesPrevious).toBe(false);
    expect(rows.find((r) => r.type === "bridge")?.continuesPrevious).toBe(true);
  });

  it("marks a foreign bridge whose input is a fresh balance as NOT continuing a target-chain swap", () => {
    // Multi-source: an Arbitrum swap-only source, then a Polygon source that bridges its own USDC in.
    // The planner appends each source contiguously, so the swap lands before the bridge, but the
    // bridge spends a Polygon holding, not the Arbitrum swap's output (USDC@42161 vs USDC@137).
    const swapOnTarget: ProvisioningStep = {
      type: "swap-token",
      key: "swap-token-arb",
      labelKey: "provisioning.steps.swapToken",
      fromToken: "WETH",
      toToken: "USDC",
      fromChainId: 42161,
      toChainId: 42161,
      chainId: 42161,
      amountUsd: 100,
      method: "SEND_TX",
      leg: {
        index: 0,
        kind: "swap-token",
        chainId: 42161,
        tokenIn: {
          address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
          symbol: "WETH",
          decimals: 18,
          chainId: 42161,
        },
        tokenOut: USDC_ARBITRUM,
        amountIn: "40000000000000000",
        amountOutQuoted: "100000000",
        minAmountOut: "98000000",
        routing: "CLASSIC",
        gasUsd: 0.02,
        requoteAtExecution: false,
      },
    };
    const bridgeFromPolygon: ProvisioningStep = {
      type: "bridge",
      key: "bridge-poly",
      labelKey: "provisioning.steps.bridge",
      fromToken: "USDC",
      toToken: "USDC",
      fromChainId: 137,
      toChainId: 42161,
      chainId: 137,
      amountUsd: 200,
      method: "SEND_TX",
      etaSeconds: 180,
      leg: {
        index: 1,
        kind: "bridge",
        chainId: 137,
        tokenIn: USDC_POLYGON,
        tokenOut: USDC_ARBITRUM,
        amountIn: "200000000",
        amountOutQuoted: "199000000",
        minAmountOut: "199000000",
        routing: "BRIDGE",
        gasUsd: 0.01,
        etaSeconds: 180,
        requoteAtExecution: true,
      },
    };
    const opStep = REAL_STEPS[2] as ProvisioningStep;
    const rows = buildPlanView(
      realProvisioningPlan({ steps: [swapOnTarget, bridgeFromPolygon, opStep] }),
    ).rows;
    expect(rows.find((r) => r.key === "swap-token-arb")?.continuesPrevious).toBe(false);
    expect(rows.find((r) => r.key === "bridge-poly")?.continuesPrevious).toBe(false);
  });

  it("flags a buy that delivers native gas, and not one that delivers USDC (POO-1131)", () => {
    // The mock on-ramp buys USDC: spendable, so NOT gas.
    const usdcBuy = buildPlanView(
      mockComputePlan(SCENARIOS.usdcOnly, { nowIso: "2026-06-30T12:00:00.000Z" }),
    ).rows.find((r) => r.type === "buy");
    expect(usdcBuy?.deliversGas).toBeFalsy();

    // A gas-first buy delivers ETH on Base ([R1]): the row must flag it so settledSafe excludes it.
    const gasBuy: ProvisioningStep = {
      type: "buy",
      key: "buy-eth",
      labelKey: "provisioning.steps.buy",
      fromToken: "USD",
      toToken: "ETH",
      toChainId: 8453,
      amountUsd: 12,
    };
    const opStep = REAL_STEPS[2] as ProvisioningStep;
    const row = buildPlanView(realProvisioningPlan({ steps: [gasBuy, opStep] })).rows.find(
      (r) => r.key === "buy-eth",
    );
    expect(row?.deliversGas).toBe(true);
  });
});

describe("buildPlanView — a buy advances the endpoint chain with what it delivers (POO-1136)", () => {
  const opStep = REAL_STEPS[2] as ProvisioningStep;

  /** A USDC-BASE fiat buy. */
  const usdcBuy: ProvisioningStep = {
    type: "buy",
    key: "buy",
    labelKey: "provisioning.steps.buy",
    fromToken: "USD",
    toToken: "USDC",
    toChainId: 8453,
    amountUsd: 120,
  };

  /** The bridge that carries the bought USDC off Base, legged as POO-1136 re-plans it from the delta. */
  const buyBridge: ProvisioningStep = {
    type: "bridge",
    key: "buy-bridge",
    labelKey: "provisioning.steps.bridge",
    fromToken: "USDC",
    toToken: "USDC",
    fromChainId: 8453,
    toChainId: 42161,
    chainId: 8453,
    amountUsd: 120,
    method: "SEND_TX",
    etaSeconds: 120,
    leg: {
      index: 0,
      kind: "bridge",
      chainId: 8453,
      tokenIn: USDC_BASE,
      tokenOut: USDC_ARBITRUM,
      amountIn: "120000000",
      amountOutQuoted: "119000000",
      minAmountOut: "119000000",
      routing: "BRIDGE",
      gasUsd: 0.01,
      etaSeconds: 120,
      requoteAtExecution: true,
    },
  };

  it("marks a legged bridge that carries the bought USDC as CONTINUING the buy", () => {
    const rows = buildPlanView(realProvisioningPlan({ steps: [usdcBuy, buyBridge, opStep] })).rows;
    expect(rows.find((r) => r.key === "buy-bridge")?.continuesPrevious).toBe(true);
  });

  it("does not double-count a settled buy -> bridge: the bridge supersedes the buy in one group", () => {
    // Both settled `done`. Without the carry the bridge reads as a new source and settledSafe reports
    // $240 for money that is a single $120 that moved one leg further.
    const rows = buildPlanView(realProvisioningPlan({ steps: [usdcBuy, buyBridge, opStep] }), {
      statusByKey: { buy: "done", "buy-bridge": "done" },
    }).rows;
    const settled = settledSafe(rows);
    expect(settled).toEqual({ kind: "amount", usd: 120 });
  });

  it("marks a legged swap that converts the bought ETH as CONTINUING the buy", () => {
    const ethBuy: ProvisioningStep = {
      type: "buy",
      key: "buy",
      labelKey: "provisioning.steps.buy",
      fromToken: "USD",
      toToken: "ETH",
      toChainId: 8453,
      amountUsd: 130,
    };
    const ethOnBase: ProvisioningLeg["tokenIn"] = {
      address: NATIVE_TOKEN_ADDRESS,
      symbol: "ETH",
      decimals: 18,
      chainId: 8453,
    };
    const buySwap: ProvisioningStep = {
      type: "swap-token",
      key: "buy-swap",
      labelKey: "provisioning.steps.swapToken",
      fromToken: "ETH",
      toToken: "USDC",
      fromChainId: 8453,
      toChainId: 8453,
      chainId: 8453,
      amountUsd: 120,
      method: "SEND_TX",
      leg: {
        index: 0,
        kind: "swap-token",
        chainId: 8453,
        tokenIn: ethOnBase,
        tokenOut: USDC_BASE,
        amountIn: "40000000000000000",
        amountOutQuoted: "120000000",
        minAmountOut: "118000000",
        routing: "CLASSIC",
        gasUsd: 0.02,
        requoteAtExecution: true,
      },
    };
    const rows = buildPlanView(realProvisioningPlan({ steps: [ethBuy, buySwap, opStep] })).rows;
    expect(rows.find((r) => r.key === "buy-swap")?.continuesPrevious).toBe(true);
  });

  it("a buy RESETS the endpoint, so a legged leg before it never marks a downstream leg as continuing it", () => {
    // Defensive: buildPlan emits the buy first, but a stale endpoint from a leg two steps back must
    // never leak through the buy. Here a Polygon swap sits before the buy; the buy delivers USDC on
    // Base, and the bridge that follows continues the BUY, not the unrelated Polygon swap.
    const polygonSwap: ProvisioningStep = {
      type: "swap-token",
      key: "swap-token-poly",
      labelKey: "provisioning.steps.swapToken",
      fromToken: "WETH",
      toToken: "USDC",
      fromChainId: 137,
      toChainId: 137,
      chainId: 137,
      amountUsd: 50,
      method: "SEND_TX",
      leg: {
        index: 0,
        kind: "swap-token",
        chainId: 137,
        tokenIn: {
          address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
          symbol: "WMATIC",
          decimals: 18,
          chainId: 137,
        },
        tokenOut: USDC_POLYGON,
        amountIn: "10000000000000000000",
        amountOutQuoted: "50000000",
        minAmountOut: "49000000",
        routing: "CLASSIC",
        gasUsd: 0.01,
        requoteAtExecution: false,
      },
    };
    const rows = buildPlanView(
      realProvisioningPlan({ steps: [polygonSwap, usdcBuy, buyBridge, opStep] }),
    ).rows;
    // The bridge continues the buy (USDC@Base), not the Polygon swap (USDC@137).
    expect(rows.find((r) => r.key === "buy-bridge")?.continuesPrevious).toBe(true);
  });
});

// --- POO-1575 rules v2: the buy caption names the methods the buyer can actually use -------------

describe("the buy caption's payment methods (POO-1575 [R1]-[R5], [R8])", () => {
  /**
   * The scenario plan, with its `buy` leg minting whichever pair a case is about (POO-1596).
   *
   * `mockComputePlan` always orders `USDC-BASE`, which is exactly the half of the answer [R8] used to
   * check. A gas-first plan mints `ETH-BASE` (`sizeOnRampOrder`), and that is the leg whose method
   * list a `USDC-BASE` resolution does not describe.
   */
  const planMinting = (currencyCode: string) => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    return {
      ...plan,
      steps: plan.steps.map((step) =>
        step.type === "buy" && step.order !== undefined
          ? { ...step, order: { ...step.order, currencyCode } }
          : step,
      ),
    };
  };

  /**
   * A plan whose first row is the fiat `buy` (Paybis), which is the row under test.
   *
   * The currencies AND the pair default to AGREEING, which is [R8]'s pass case: the list was resolved
   * for the fiat this leg will be charged in, on the pair it will actually mint. The disagreement
   * cases pass them explicitly.
   */
  const buyView = (
    names?: readonly string[],
    listedForCurrency = "EUR",
    chargedCurrency = listedForCurrency,
    listedForPair = "USDC-BASE",
    mintedPair = "USDC-BASE",
  ) =>
    buildPlanView(planMinting(mintedPair), {
      ...(names === undefined
        ? {}
        : { buyPaymentMethods: { names, listedForCurrency, listedForPair, chargedCurrency } }),
    });

  it("[R1] names the resolved methods instead of the shipped 'Card or Pix' caption", () => {
    const buy = buyView(["Credit Card", "Pix"]).rows[0];

    expect(buy?.type).toBe("buy");
    expect(buy?.captionKey).toBe("provisioning.captions.buyMethods");
    expect(buy?.paymentMethodNames).toEqual(["Credit Card", "Pix"]);
  });

  it("[R2] names at most two, in the order given, trimmed, blank-dropped and deduplicated", () => {
    const buy = buyView([" Credit Card ", "", "credit card", "SEPA transfer", "Apple Pay"]).rows[0];

    expect(buy?.paymentMethodNames).toEqual(["Credit Card", "SEPA transfer"]);
  });

  it("[R3] falls back to a caption naming NO method when nothing resolved", () => {
    for (const names of [undefined, [], ["", "   "]]) {
      const buy = buyView(names).rows[0];
      expect(buy?.captionKey).toBe("provisioning.captions.buy");
      // Nothing to interpolate: the neutral message carries no placeholder.
      expect(buy?.paymentMethodNames).toBeUndefined();
    }
  });

  it("[R4] carries a caption key in BOTH branches, so the Paybis attribution cannot drop", () => {
    for (const names of [undefined, ["Pix"]]) {
      const buy = buyView(names).rows[0];
      expect(buy?.attributionKey).toBe("provisioning.poweredByPaybis");
      expect(typeof buy?.captionKey).toBe("string");
    }
  });

  it("[R5] touches no other row: a non-buy step keeps its own caption and carries no methods", () => {
    const rows = buildPlanView(mockComputePlan(SCENARIOS.usdcBridge, { nowIso: NOW }), {
      buyPaymentMethods: {
        names: ["Pix"],
        listedForCurrency: "BRL",
        listedForPair: "USDC-BASE",
        chargedCurrency: "BRL",
      },
    }).rows;

    for (const row of rows.filter((r) => r.type !== "buy")) {
      expect(row.captionKey).not.toBe("provisioning.captions.buyMethods");
      expect(row.paymentMethodNames).toBeUndefined();
    }
  });

  // --- [R8], the POO-1575 review's finding 1 ----------------------------------------------------
  // The list is resolved for the BUYER's currency while a SPEND-fixed leg is pinned to
  // `order.fiatCurrency` ("USD", `sizeOnRampOrder.ts`), so naming the buyer's rails over a widget
  // that will open in dollars is the same overpromise this issue exists to remove, one layer down.

  it("[R8] names nothing when the leg is charged in a currency the list was not resolved for", () => {
    const buy = buyView(["SEPA transfer", "Bizum"], "EUR", "USD").rows[0];

    expect(buy?.captionKey).toBe("provisioning.captions.buy");
    expect(buy?.paymentMethodNames).toBeUndefined();
  });

  it("[R8] still names them when the two agree, whatever the case or padding", () => {
    const buy = buyView(["SEPA transfer"], " eur ", "EUR").rows[0];

    expect(buy?.captionKey).toBe("provisioning.captions.buyMethods");
    expect(buy?.paymentMethodNames).toEqual(["SEPA transfer"]);
  });

  it("[R8] treats two BLANK codes as a mismatch, never as agreement", () => {
    // `"" === ""` would pass an unchecked list as checked, which is the very claim [R8] removes.
    const blankPairs: ReadonlyArray<readonly [string, string]> = [
      ["", ""],
      ["  ", "\t"],
      ["", "EUR"],
      ["EUR", " "],
    ];
    for (const [listed, charged] of blankPairs) {
      const buy = buyView(["SEPA transfer"], listed, charged).rows[0];

      expect(buy?.captionKey).toBe("provisioning.captions.buy");
      expect(buy?.paymentMethodNames).toBeUndefined();
    }
  });

  it("[R8] leaves the Paybis attribution alone on the mismatch branch too", () => {
    const buy = buyView(["Pix"], "BRL", "USD").rows[0];

    expect(buy?.attributionKey).toBe("provisioning.poweredByPaybis");
    expect(typeof buy?.captionKey).toBe("string");
  });

  // --- [R8]'s PAIR half (POO-1596 X3, the cross-lane review's X3) --------------------------------
  // The fiat check alone was safe by accident: before POO-1573 an `ETH-BASE` leg was unconditionally
  // billed in USD, so a mismatched pair showed up as a mismatched fiat. Now that leg adopts the
  // buyer's own currency, so both halves agree for EVERY buyer and the guard passes on a list that
  // describes a pair this leg will not mint.

  it("[R8] names nothing when the list was resolved for a pair this leg will not mint", () => {
    // The live shape: the panel listed `USDC-BASE` while the plan mints `ETH-BASE` gas-first, and
    // both sides resolved the same buyer currency, so the fiat check sees nothing wrong.
    const buy = buyView(["SEPA transfer", "Bizum"], "EUR", "EUR", "USDC-BASE", "ETH-BASE").rows[0];

    expect(buy?.captionKey).toBe("provisioning.captions.buy");
    expect(buy?.paymentMethodNames).toBeUndefined();
  });

  it("[R8] names them when BOTH the fiat and the pair agree, whatever the case or padding", () => {
    const buy = buyView(["SEPA transfer"], "EUR", "EUR", " eth-base ", "ETH-BASE").rows[0];

    expect(buy?.captionKey).toBe("provisioning.captions.buyMethods");
    expect(buy?.paymentMethodNames).toEqual(["SEPA transfer"]);
  });

  it("[R8] names nothing when the leg does not say which pair it mints", () => {
    // A pre-POO-1573 plan or a fixture carries no `order`. "We do not know what this leg buys" and
    // "these are its rails" cannot both be said, so it takes the neutral caption, exactly as a blank
    // currency code does.
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    const orderless = {
      ...plan,
      steps: plan.steps.map((step) => {
        if (step.type !== "buy") return step;
        const { order: _dropped, ...rest } = step;
        return rest;
      }),
    };
    const buy = buildPlanView(orderless, {
      buyPaymentMethods: {
        names: ["SEPA transfer"],
        listedForCurrency: "EUR",
        listedForPair: "USDC-BASE",
        chargedCurrency: "EUR",
      },
    }).rows[0];

    expect(buy?.captionKey).toBe("provisioning.captions.buy");
    expect(buy?.paymentMethodNames).toBeUndefined();
  });

  it("[R8] leaves the Paybis attribution alone on the PAIR mismatch branch too", () => {
    const buy = buyView(["Pix"], "BRL", "BRL", "USDC-BASE", "ETH-BASE").rows[0];

    expect(buy?.attributionKey).toBe("provisioning.poweredByPaybis");
    expect(typeof buy?.captionKey).toBe("string");
  });
});

/**
 * The panel's handoff, COMPILED rather than quoted (POO-1575 review, finding 2).
 *
 * `PlanViewOptions.buyPaymentMethods` carries the wiring line as a `PP-TODO(POO-1576)` because the
 * panel is owned by concurrent work, and the first version of that snippet did not typecheck:
 * `methodLabel` is `string | undefined`, so the spread produced `(string | undefined)[]` where a
 * `readonly string[]` was required. A comment nothing compiles is a comment that can be wrong, and
 * the comment is what the next implementer copies.
 *
 * What this pins is the `names` / `listedForCurrency` half: it is the same expression, type-checked
 * by `pnpm typecheck` against the hook's real return type and exercised by the assertions below.
 * `chargedCurrency` is deliberately a PARAMETER here, because nothing at the panel's render resolves
 * it (the rail settles it at mint time), so that half of the snippet stays hand-maintained. Edit the
 * two texts together.
 *
 * POO-1596: `listedForPair` is a parameter for a DIFFERENT reason. The panel does hold it at render
 * (it is the `currencyCodeTo` it passed the hook, sized by `sizeOnRampOrder`), but the hook does not
 * echo it back, so it cannot be typed off `BuyRouteQuoteState` the way the two fields above are.
 */
function buyPaymentMethodsHandoff(
  quote: BuyRouteQuoteState,
  chargedCurrency: string,
  listedForPair = "USDC-BASE",
): BuyPaymentMethods | undefined {
  if (quote.currencyCodeFrom === undefined) return undefined;
  return {
    names: [quote.methodLabel, ...(quote.methods ?? []).map((method) => method.displayName)].filter(
      (name): name is string => name !== undefined,
    ),
    listedForCurrency: quote.currencyCodeFrom,
    listedForPair,
    chargedCurrency,
  };
}

describe("the documented panel handoff (POO-1575 [R1], [R8])", () => {
  const method = (paymentMethod: string, displayName: string) => ({
    paymentMethod,
    displayName,
    minUsd: 10,
    minCurrencyCode: "EUR",
  });

  it("leads with the PRICED method and drops the hole when nothing was priced", () => {
    const methods = [method("sepa", "SEPA transfer"), method("card", "Credit Card")];

    expect(
      buyPaymentMethodsHandoff(
        { methodLabel: "Credit Card", methods, currencyCodeFrom: "EUR" },
        "EUR",
      ),
    ).toEqual({
      names: ["Credit Card", "SEPA transfer", "Credit Card"],
      listedForCurrency: "EUR",
      listedForPair: "USDC-BASE",
      chargedCurrency: "EUR",
    });
    // `methodLabel` absent (the quote failed but the list answered) leaves no `undefined` behind.
    expect(buyPaymentMethodsHandoff({ methods, currencyCodeFrom: "EUR" }, "EUR")?.names).toEqual([
      "SEPA transfer",
      "Credit Card",
    ]);
  });

  it("hands over nothing at all until the list has said which currency it answered for", () => {
    expect(buyPaymentMethodsHandoff({ methodLabel: "Credit Card" }, "USD")).toBeUndefined();
  });

  it("reaches the row through buildPlanView, deduplicated and capped", () => {
    const handoff = buyPaymentMethodsHandoff(
      {
        methodLabel: "Credit Card",
        methods: [method("card", "Credit Card"), method("sepa", "SEPA transfer")],
        currencyCodeFrom: "EUR",
      },
      "EUR",
    );
    const buy = buildPlanView(mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW }), {
      ...(handoff === undefined ? {} : { buyPaymentMethods: handoff }),
    }).rows[0];

    expect(buy?.paymentMethodNames).toEqual(["Credit Card", "SEPA transfer"]);
  });
});

describe("formatPaymentMethods (POO-1575 [R2])", () => {
  it("joins with the LOCALE's own disjunction, never a hardcoded ' or '", () => {
    expect(formatPaymentMethods(["Card", "Pix"], "en")).toBe("Card or Pix");
    expect(formatPaymentMethods(["Cartão", "Pix"], "pt-BR")).toBe("Cartão ou Pix");
  });

  it("prints a single method as itself, and normalizes before formatting", () => {
    expect(formatPaymentMethods(["Card"], "en")).toBe("Card");
    expect(formatPaymentMethods([" Card ", "card", "Pix", "SEPA"], "en")).toBe("Card or Pix");
  });

  it("[R3] answers undefined when nothing resolved, which is the neutral-caption branch", () => {
    expect(formatPaymentMethods([], "en")).toBeUndefined();
    expect(formatPaymentMethods(undefined, "en")).toBeUndefined();
    expect(formatPaymentMethods(["", "  "], "en")).toBeUndefined();
  });

  it("[R2] names ONE method instead of throwing where Intl.ListFormat does not exist", () => {
    // Safari 12 is still in this app's default browserslist and `Intl.ListFormat` is 14.1+, so an
    // unguarded constructor throws INSIDE render and takes the card down mid money flow.
    const real = Intl.ListFormat;
    const broken = function ListFormat() {
      throw new TypeError("Intl.ListFormat is not a constructor");
    } as unknown as typeof Intl.ListFormat;

    try {
      Object.defineProperty(Intl, "ListFormat", { value: broken, configurable: true });

      expect(formatPaymentMethods(["Credit Card", "Pix"], "en")).toBe("Credit Card");
      // The single-name path takes the same route and still answers, never a separator we invented.
      expect(formatPaymentMethods([" Pix "], "pt-BR")).toBe("Pix");
      // Nothing resolved stays [R3]'s neutral branch: the guard did not turn it into a value.
      expect(formatPaymentMethods([], "en")).toBeUndefined();
    } finally {
      Object.defineProperty(Intl, "ListFormat", { value: real, configurable: true });
    }

    expect(formatPaymentMethods(["Credit Card", "Pix"], "en")).toBe("Credit Card or Pix");
  });
});

/**
 * POO-1779 [R1] — the gas row's caption reads "Paid from your {stable}", and the only fact that can
 * fill `{stable}` is the chain the row RUNS on. `stepRow` carries that chain as an API network slug
 * ({@link PlanRow.sourceNetwork}) so the card can resolve the ticker from the chain config.
 *
 * Worth pinning because the failure is silent rather than loud: a row that fails to carry the slug
 * still renders, and `networkStableSymbol` degrades it to "USDC" ([R2]) — so a Robinhood Chain gas
 * top-up would tell the user their USDG was USDC. Nothing else in this suite exercises
 * `sourceSlugOf`; the rendered other half is covered in `ProvisioningPlanCard.test.tsx`.
 */
describe("buildPlanView — the gas row names the chain whose stable pays for it (POO-1779 [R1])", () => {
  const gasRow = (stable: ProvisioningLegToken) =>
    buildPlanView(realProvisioningPlan({ steps: [gasTopUpStep(stable)] })).rows[0];

  it("[R1] carries Robinhood Chain's slug, the one that resolves the caption to USDG", () => {
    const row = gasRow(USDG_ROBINHOOD);

    expect(row?.type).toBe("swap-gas");
    // The caption key that reads "Paid from your {stable}"; without it the slug interpolates nothing.
    expect(row?.captionKey).toBe("provisioning.captions.swapGas");
    expect(row?.sourceNetwork).toBe("robinhood");
    expect(row?.sourceNetwork).toBe(apiNetworkForChain(USDG_ROBINHOOD.chainId));
  });

  it("[R1] carries a launch chain's slug unchanged, so its caption still reads USDC", () => {
    expect(gasRow(USDC_ARBITRUM)?.sourceNetwork).toBe("arbitrum");
    expect(gasRow(USDC_POLYGON)?.sourceNetwork).toBe("polygon");
  });

  /**
   * [R2] The slug comes from `leg.chainId` — where the step BROADCASTS — falling back to
   * `fromChainId`. A chain the app does not support resolves to NO slug rather than a borrowed one,
   * which is what lets the card degrade to the documented default instead of naming a wrong dollar.
   */
  it("[R2] omits the slug entirely for a chain the app does not support", () => {
    const offChain = gasTopUpStep({ ...USDC_ARBITRUM, chainId: 1 });
    const row = buildPlanView(realProvisioningPlan({ steps: [offChain] })).rows[0];

    expect(row?.sourceNetwork).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1927 [R2]/[R3]: the row's vendor attribution is a KEY resolved from the rail, not a boolean
// named after one vendor.
//
// `poweredByPaybis: boolean` could only ever answer "Paybis, or nothing", so a Privy-brokered charge
// through Stripe or MoonPay printed "Powered by Paybis" on the plan card. `attributionKey` carries
// the copy the row should render instead, decided here rather than in the card, next to `labelKey`
// and `captionKey` which are resolved the same way.
//
// The settled copy decision (issue comment, 2026-09-12) is PROVIDER-NEUTRAL, never rail-aware: on
// the Privy rail no vendor is named at all, because Privy auto-routes between Stripe, MoonPay,
// Coinbase and Meld and our own outcome record does not capture which one served.
// -------------------------------------------------------------------------------------------------

describe("POO-1927: the attribution names the rail that serves [R2]/[R3]", () => {
  /** `usdcOnly` is the plain fiat scenario: a `buy` row and the op anchor, no gas branch. */
  const buyRowOn = (rail?: "paybis" | "privy") => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    const railed = {
      ...plan,
      steps: plan.steps.map((step) =>
        step.type === "buy" && rail !== undefined ? { ...step, poweredBy: rail } : step,
      ),
    };
    return buildPlanView(railed).rows.find((row) => row.type === "buy");
  };

  // @rule R2: the defect itself, a Privy-served leg must not carry the Paybis key, in ANY locale.
  // The key is what decides that, so asserting the key covers all 12 at once.
  it("[R2] gives a privy-served buy leg the provider-neutral key, never the Paybis one", () => {
    expect(buyRowOn("privy")?.attributionKey).toBe("provisioning.secureCheckout");
  });

  // @rule R2: the Paybis rail's copy is honest and stays while that rail exists (POO-1819 keeps it
  // as the 72-hour rollback target after cutover).
  it("[R2] leaves a paybis-served buy leg crediting Paybis", () => {
    expect(buyRowOn("paybis")?.attributionKey).toBe("provisioning.poweredByPaybis");
  });

  // The step's `poweredBy` is what marks a leg attributable AT ALL. Without this the host's rail
  // would stamp an attribution onto every row in the plan, including the op anchor and the bridges.
  it("[R2] attributes ONLY the fiat buy leg, never another row", () => {
    const rows = buildPlanView(mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW }), {
      onRampRail: "privy",
    }).rows;

    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.filter((r) => r.type !== "buy")) {
      expect(row.attributionKey).toBeUndefined();
    }
  });

  /**
   * The host's LIVE rail wins over the one the plan recorded, and this is the case that matters.
   *
   * The plan is built by a `"use server"` action, so `resolveOnRampProvider` there is env-pure and
   * cannot see a Dev-menu override. The panel branches the actual purchase on `useOnRampProvider`,
   * which can (`ProvisioningPanel.tsx:1826`). A tester flipping `privyOnRamp` in the Dev menu
   * therefore runs Privy against a plan that recorded `paybis`, and without this precedence the
   * buyer would read the Paybis credit on a Privy charge, which is the whole defect. The reader
   * divergence itself is POO-1807/POO-1808's to close (`onRampProvider.ts` records it).
   */
  it("[R2] prefers the host's live rail over the rail the plan recorded", () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    const buy = buildPlanView(plan, { onRampRail: "privy" }).rows.find((r) => r.type === "buy");

    expect(plan.steps.find((s) => s.type === "buy")?.poweredBy).toBe("paybis");
    expect(buy?.attributionKey).toBe("provisioning.secureCheckout");
  });

  it("[R2] falls back to the plan's own rail when the host states none", () => {
    const buy = buildPlanView(mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW })).rows.find(
      (r) => r.type === "buy",
    );

    expect(buy?.attributionKey).toBe("provisioning.poweredByPaybis");
  });

  // A plan whose buy leg records no rail at all (a pre-POO-1927 fixture) renders no attribution
  // rather than guessing one, and the host's rail does not manufacture it either.
  it("[R2] renders no attribution for a buy leg that records no rail", () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    const stripped = {
      ...plan,
      steps: plan.steps.map((step) => {
        if (step.type !== "buy") return step;
        const { poweredBy: _dropped, ...rest } = step;
        return rest;
      }),
    };

    expect(
      buildPlanView(stripped, { onRampRail: "privy" }).rows.find((r) => r.type === "buy")
        ?.attributionKey,
    ).toBeUndefined();
  });
});
