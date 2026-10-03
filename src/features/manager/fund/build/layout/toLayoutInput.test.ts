/**
 * @id PP-MGR-LIB-023
 * @name toLayoutInput tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a pure mapping: nothing here is rendered or tracked.
 *
 * `toLayoutInput` is the only bridge from the stored plan (S1) to the layout: it keeps order, ids and
 * shares, names the hub, and says whether each block is configured (HU2: `config !== null`; a pill
 * counts as configured, as the C17 port rule reads it). Covered against every plan of the S1 test
 * kit, plus the cross-check that the kit's Collect fees plan lays out as Build state 5.
 */
import { describe, expect, it } from "vitest";
import { buildState5 } from "@/mocks/data/buildCanvasFixtures";
import { HUB_NETWORK } from "../../mandateDraft";
import type { BuildPlan } from "../plan/buildPlan";
import {
  emptyPlan,
  emptySpokePlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  spokePoolPlan,
  supplyBorrowPlan,
  VALID_TEST_PLANS,
} from "../plan/planTestKit";
import { layoutGraph } from "./layoutGraph";
import { toLayoutInput } from "./toLayoutInput";

const OPTIONS = { startHereWidth: 420 };

describe("toLayoutInput", () => {
  it("names the hub network", () => {
    expect(toLayoutInput(emptyPlan()).hubNetwork).toBe(HUB_NETWORK);
  });

  it("maps the empty plan to no chain and no spoke", () => {
    expect(toLayoutInput(emptyPlan())).toEqual({
      hubNetwork: HUB_NETWORK,
      hub: { chains: [] },
      spokes: [],
    });
  });

  it("keeps ids, order, kinds and shares of a hub chain, a pill being configured", () => {
    expect(toLayoutInput(hubPoolWithFeesPlan()).hub.chains).toEqual([
      {
        id: "hub-pool",
        sharePct: 60,
        steps: [
          { id: "hub-pool-swap", family: "flow", kind: "swap", auto: true, configured: true },
          {
            id: "hub-pool-pool",
            family: "position",
            kind: "uniswapV4Pool",
            auto: false,
            configured: true,
          },
          {
            id: "hub-pool-fees",
            family: "flow",
            kind: "collectFees",
            auto: false,
            configured: true,
          },
        ],
      },
    ]);
  });

  // @rule HU2
  it("[HU2] reads configured from config: an empty block is not configured", () => {
    const plan = hubPoolPlan();
    const chain = plan.hub.chains[0];
    const block = chain?.steps[1];
    if (!chain || block?.family !== "position") throw new Error("kit changed");
    chain.steps[1] = { ...block, config: null } as typeof block;
    const steps = toLayoutInput(plan).hub.chains[0]?.steps ?? [];
    expect(steps.map((s) => s.configured)).toEqual([true, false]);
  });

  it("keeps Aave Supply and Borrow as two position steps", () => {
    const steps = toLayoutInput(supplyBorrowPlan()).hub.chains[0]?.steps ?? [];
    expect(steps.map((s) => [s.family, s.kind, s.auto])).toEqual([
      ["flow", "swap", true],
      ["position", "aaveSupply", false],
      ["position", "aaveBorrow", false],
    ]);
  });

  it("maps spokes with their network, share and chains, an empty spoke included", () => {
    expect(toLayoutInput(spokePoolPlan()).spokes).toEqual([
      {
        network: "robinhood",
        sharePct: 40,
        chains: [
          {
            id: "rh-pool",
            sharePct: 40,
            steps: [
              { id: "rh-pool-swap", family: "flow", kind: "swap", auto: true, configured: true },
              {
                id: "rh-pool-pool",
                family: "position",
                kind: "uniswapV4Pool",
                auto: false,
                configured: true,
              },
            ],
          },
        ],
      },
    ]);
    expect(toLayoutInput(emptySpokePlan()).spokes).toEqual([
      { network: "robinhood", sharePct: 0, chains: [] },
    ]);
  });

  it.each(Object.entries(VALID_TEST_PLANS))("keeps every step of %s, in order", (_name, make) => {
    const plan = make();
    const input = toLayoutInput(plan);
    const planIds = [...plan.hub.chains, ...plan.spokes.flatMap((s) => s.chains)].flatMap((c) =>
      c.steps.map((s) => s.id),
    );
    const inputIds = [...input.hub.chains, ...input.spokes.flatMap((s) => s.chains)].flatMap((c) =>
      c.steps.map((s) => s.id),
    );
    expect(inputIds).toEqual(planIds);
    expect(input.spokes.map((s) => s.network)).toEqual(plan.spokes.map((s) => s.network));
  });

  it.each(Object.entries(VALID_TEST_PLANS))("never mutates %s", (_name, make) => {
    const plan: BuildPlan = make();
    const before = structuredClone(plan);
    toLayoutInput(plan);
    expect(plan).toEqual(before);
  });

  it.each(Object.entries(VALID_TEST_PLANS))("lays %s out without throwing", (_name, make) => {
    const layout = layoutGraph(toLayoutInput(make()), OPTIONS);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("lays the kit's Collect fees plan out exactly as Build state 5 (same structure)", () => {
    const fromPlan = layoutGraph(toLayoutInput(hubPoolWithFeesPlan()), OPTIONS);
    const fromFixture = layoutGraph(buildState5.input, OPTIONS);
    expect(fromPlan.width).toBe(fromFixture.width);
    expect(fromPlan.height).toBe(fromFixture.height);
    expect(fromPlan.blocks.map((b) => b.rect)).toEqual(fromFixture.blocks.map((b) => b.rect));
    expect(fromPlan.spine).toEqual(fromFixture.spine);
  });

  it("keeps a Supply chain's single card with both ports once laid out (C17 via portSlotsOf)", () => {
    const layout = layoutGraph(toLayoutInput(hubSupplyPlan()), OPTIONS);
    expect(layout.ports.map((p) => [p.target.side, p.target.blockId])).toEqual([
      ["before", "hub-supply-supply"],
      ["after", "hub-supply-supply"],
    ]);
  });
});
