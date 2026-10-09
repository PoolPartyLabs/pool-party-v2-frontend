/**
 * @id PP-MGR-LIB-044 (POO-2177; POO-2301 regression)
 * @name FundLaunchContractsRegression
 * @implements-rules-version v1
 * @analytics-events none (type/runtime contract regression, no product event emitter)
 * Local Build descriptors must not widen the EVM launch contract. Compile-time assertions run
 * under typecheck; runtime checks retain fail-closed execution.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import type { FundLaunchDraft } from "./contracts";
import { type CanvasChain, type CanvasPlan, deriveLaunchSteps } from "./plan";

describe("EVM launch plan boundary (POO-2301)", () => {
  // @rule R1: replacing the optional Build plan exposes exactly the launch adapter contract.
  it("keeps launch chains independent of the broader local Build plan union", () => {
    expectTypeOf<FundLaunchDraft["plan"]>().toEqualTypeOf<CanvasPlan>();
    expectTypeOf<FundLaunchDraft["plan"]["spokes"][number]["chains"]>().toEqualTypeOf<
      CanvasChain[]
    >();
    expectTypeOf<CanvasPlan>().toMatchTypeOf<FundLaunchDraft["plan"]>();
  });

  // @rule R2: local descriptor configuration supplies no EVM execution configuration.
  it("excludes local descriptor settings from launch configuration", () => {
    expectTypeOf<SolanaLocalBlockConfig>().not.toMatchTypeOf<
      NonNullable<CanvasChain["steps"][number]["config"]>
    >();
  });

  // @rule R3: untrusted local position kinds and Solana spokes remain blocked at runtime.
  it.each([
    "solanaOrcaPool",
    "solanaRaydiumPool",
    "solanaKaminoSupply",
    "solanaHolding",
  ])("refuses the local %s kind before deriving execution steps", (kind) => {
    const plan: CanvasPlan = {
      version: 1,
      hub: {
        chains: [
          {
            id: "local",
            sharePct: 100,
            steps: [{ id: "local", family: "position", kind, config: null }],
          },
        ],
      },
      spokes: [],
    };
    expect(() => deriveLaunchSteps(plan, {}, true, false)).toThrow("UNSUPPORTED_POSITION");
    expect(() =>
      deriveLaunchSteps(
        {
          ...plan,
          hub: { chains: [] },
          spokes: [{ network: "solana", sharePct: 100, chains: plan.hub.chains }],
        },
        {},
        true,
        true,
      ),
    ).toThrow("INVALID_BUILD");
  });
});
