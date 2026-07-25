/**
 * @id PP-CORE-LIB-018
 * @name provisioningView — tests
 * @implements-rules-version v2 (POO-1037 rules v1) · v1
 * Plan → view mapping across the canonical scenarios: ordered rows, 1-based badges, amount visibility
 * (bridge + zero-amount omitted), the gas + op + paybis flags, and the title key per variant. Plus
 * POO-1037 [R2]: the bridge leg's ETA copy, which comes from the quote or says nothing at all.
 */
import { describe, expect, it } from "vitest";
import { mockComputePlan, SCENARIOS } from "@/lib/provisioning";
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
