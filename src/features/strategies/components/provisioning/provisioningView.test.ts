/**
 * @id PP-CORE-LIB-018
 * @name provisioningView — tests
 * @implements-rules-version v3 (POO-1041 rules v1) · v2 (POO-1037 rules v1) · v1
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
import { apiNetworkForChain, chainDisplayName } from "@/lib/chains/config";
import { mockComputePlan, SCENARIOS } from "@/lib/provisioning";
import {
  REAL_STEPS,
  realProvisioningPlan,
} from "../../../../../tests/fixtures/realProvisioningPlan";
import { planRailSteps } from "../../lib/buildPlanSteps";
import { bridgeEtaCopy, buildPlanView } from "./provisioningView";

const NOW = "2026-06-30T12:00:00.000Z";
const view = (
  key: keyof typeof SCENARIOS,
  gas?: { presetUsd: 10 | 25 | null; amountUsd: number },
) => buildPlanView(mockComputePlan(SCENARIOS[key], { nowIso: NOW, gas }));

describe("buildPlanView", () => {
  it("gas-only: swap-gas (with amount, gas flag) → op (no amount), titleGasOnly", () => {
    const v = view("gasOnly");
    expect(v.titleKey).toBe("provisioning.plan.titleGasOnly");
    expect(v.rows.map((r) => r.type)).toEqual(["swap-gas", "op"]);
    expect(v.rows.map((r) => r.index)).toEqual([1, 2]);
    const swap = v.rows[0];
    expect(swap?.isGas).toBe(true);
    expect(swap?.amountUsd).toBeGreaterThan(0);
    const op = v.rows[1];
    expect(op?.isOp).toBe(true);
    expect(op?.amountUsd).toBeUndefined(); // opRequiredUsdc = 0 → omitted
  });

  it("gas-only no USDC: buy-usdc (paybis) → swap-gas → op", () => {
    const v = view("gasOnlyNoUsdc");
    expect(v.rows.map((r) => r.type)).toEqual(["buy-usdc", "swap-gas", "op"]);
    expect(v.rows[0]?.poweredByPaybis).toBe(true);
    expect(v.rows[0]?.amountUsd).toBeGreaterThan(0);
  });

  it("usdc-only: buy-usdc → op, multi title, op shows its amount", () => {
    const v = view("usdcOnly");
    expect(v.titleKey).toBe("provisioning.plan.title");
    expect(v.rows.map((r) => r.type)).toEqual(["buy-usdc", "op"]);
    expect(v.rows[1]?.amountUsd).toBeGreaterThan(0); // opRequiredUsdc = 100
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
    expect(v.rows.map((r) => r.type)).toEqual(["buy-usdc", "bridge", "swap-gas", "op"]);
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
    expect(swapRow?.tokenSymbol).toBe("USDC");
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
