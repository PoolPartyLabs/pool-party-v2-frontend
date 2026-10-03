/**
 * @id PP-MGR-SCR-002
 * @name buildScreenModel tests
 * @implements-rules-version v1 (POO-2157 rules v1)
 * @analytics-events none, a test of pure functions; the reasons it returns are asserted, not emitted
 *
 * The two decisions of the Build screen that do not need a DOM (slice S7, POO-2157):
 *
 * - [AN4, D19] Next: Review checks the plan in a fixed order (empty plan, blocks no longer in the
 *   mandate, coming-soon blocks, empty blocks, shares over the parent) and answers with ONE refusal,
 *   the first that applies, plus the block to bring into view; a plan that passes them all is refused
 *   with "Review is not available yet" in this batch. Each refusal has exactly one notice key.
 * - [I9] after a change, which rect the viewport reveals: the new or newly selected block, a new
 *   network's group, or nothing (a remove clears the selection, so nothing is revealed).
 */
import { describe, expect, it } from "vitest";
import { buildMandateCatalog } from "../mandateCatalog";
import type { MandateDraft } from "../mandateDraft";
import {
  REVIEW_NOTICE_KEY,
  REVIEW_REFUSALS,
  revealTarget,
  reviewVerdict,
  targetRect,
} from "./buildScreenModel";
import { layoutGraph } from "./layout/layoutGraph";
import { toLayoutInput } from "./layout/toLayoutInput";
import type { BuildPlan, PositionBlock } from "./plan/buildPlan";
import { validatePlan } from "./plan/planInvariants";
import {
  emptyPlan,
  emptySpokePlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestDraft,
  spokePoolPlan,
  TEST_POOL_IDS,
} from "./plan/planTestKit";

const catalog = buildMandateCatalog();

function verdictOf(plan: BuildPlan, draft: MandateDraft = makeTestDraft()) {
  return reviewVerdict(plan, validatePlan(plan, { draft, catalog }));
}

function layoutOf(plan: BuildPlan) {
  return layoutGraph(toLayoutInput(plan), { startHereWidth: 420 });
}

/** Two hub chains, configured: the pool chain and the Supply chain, at the given shares. */
function twoChains(poolPct: number, supplyPct: number): BuildPlan {
  const pool = hubPoolPlan().hub.chains[0];
  const supply = hubSupplyPlan().hub.chains[0];
  if (!pool || !supply) throw new Error("fixture: missing chain");
  return {
    ...emptyPlan(),
    hub: {
      chains: [
        { ...pool, sharePct: poolPct },
        { ...supply, sharePct: supplyPct },
      ],
    },
  };
}

/** The hub pool chain with its pool emptied, as a manager-added block arrives (G6). */
function emptyPoolPlan(): BuildPlan {
  const plan = hubPoolPlan();
  const chain = plan.hub.chains[0];
  if (!chain) throw new Error("fixture: missing chain");
  const steps = chain.steps.map((step) =>
    step.family === "position" ? ({ ...step, config: null } as PositionBlock) : step,
  );
  return { ...plan, hub: { chains: [{ ...chain, steps }] } };
}

describe("reviewVerdict: Next: Review checks the plan in order (AN4, D19)", () => {
  it("[AN4] refuses an empty plan first, with nothing to reveal", () => {
    // @rule AN4
    expect(verdictOf(emptyPlan())).toEqual({ refusal: "review_empty_plan", target: null });
  });

  it("[AN4] reads a plan whose only spoke has no chain as an empty plan", () => {
    // @rule AN4
    expect(verdictOf(emptySpokePlan())).toEqual({ refusal: "review_empty_plan", target: null });
  });

  it("[AN4, D6] refuses a block the mandate no longer holds, and names that block", () => {
    // @rule AN4
    // @rule D6
    const draft = { ...makeTestDraft(), pools: [] };
    expect(verdictOf(hubPoolPlan(), draft)).toEqual({
      refusal: "review_invalid_block",
      target: { kind: "block", blockId: "hub-pool-pool" },
    });
  });

  it("[AN4, D6] refuses a spoke whose network left the mandate, and names the network", () => {
    // @rule AN4
    // @rule D6
    const draft = { ...makeTestDraft(), networks: ["arbitrum" as const] };
    expect(verdictOf(spokePoolPlan(), draft)).toEqual({
      refusal: "review_invalid_block",
      target: { kind: "network", network: "robinhood" },
    });
  });

  it("[AN4] checks the mandate before coming soon, coming soon before empty blocks", () => {
    // @rule AN4
    const plan = emptyPoolPlan();
    const chain = plan.hub.chains[0];
    if (!chain) throw new Error("fixture: missing chain");
    const pendle: PositionBlock = { id: "soon", family: "position", kind: "pendle", config: null };
    const withSoon: BuildPlan = {
      ...plan,
      hub: { chains: [chain, { id: "soon-chain", sharePct: 0, steps: [pendle] }] },
    };
    expect(verdictOf(withSoon)).toEqual({
      refusal: "review_coming_soon_block",
      target: { kind: "block", blockId: "soon" },
    });
    const noPools = { ...makeTestDraft(), pools: [] };
    const invalidToo = hubPoolPlan();
    invalidToo.hub.chains.push({ id: "soon-chain", sharePct: 0, steps: [pendle] });
    expect(verdictOf(invalidToo, noPools).refusal).toBe("review_invalid_block");
  });

  it("[AN4, G6] refuses an empty block, and names the first one in reading order", () => {
    // @rule AN4
    // @rule G6
    expect(verdictOf(emptyPoolPlan())).toEqual({
      refusal: "review_empty_block",
      target: { kind: "block", blockId: "hub-pool-pool" },
    });
  });

  it("[AN4, C8] refuses shares that add up to more than the capital above them", () => {
    // @rule AN4
    // @rule C8
    expect(verdictOf(twoChains(60, 50))).toEqual({ refusal: "review_over_share", target: null });
  });

  it("[AN4, C8] names the spoke whose chains add up to more than its own share", () => {
    // @rule AN4
    // @rule C8
    const plan = spokePoolPlan();
    const spoke = plan.spokes[0];
    if (!spoke) throw new Error("fixture: missing spoke");
    spoke.sharePct = 20;
    expect(verdictOf(plan)).toEqual({
      refusal: "review_over_share",
      target: { kind: "network", network: "robinhood" },
    });
  });

  it("[AN4, D19] answers a plan that passes every check with Review not available yet", () => {
    // @rule AN4
    // @rule D19
    expect(verdictOf(twoChains(60, 40))).toEqual({ refusal: "review_unavailable", target: null });
    expect(verdictOf(hubPoolWithFeesPlan())).toEqual({
      refusal: "review_unavailable",
      target: null,
    });
  });

  it("[AN4] gives each refusal exactly one notice key, and no key twice", () => {
    // @rule AN4
    expect(Object.keys(REVIEW_NOTICE_KEY).sort()).toEqual([...REVIEW_REFUSALS].sort());
    const keys = Object.values(REVIEW_NOTICE_KEY);
    expect(new Set(keys).size).toBe(keys.length);
    expect(REVIEW_REFUSALS).toEqual([
      "review_empty_plan",
      "review_invalid_block",
      "review_coming_soon_block",
      "review_empty_block",
      "review_over_share",
      "review_unavailable",
    ]);
  });
});

describe("targetRect: where an offending block is on the canvas (AN4)", () => {
  it("[AN4] finds a block, a chain's first block and a spoke's group", () => {
    // @rule AN4
    const plan = spokePoolPlan();
    const layout = layoutOf(plan);
    const pool = layout.blocks.find((block) => block.id === "rh-pool-pool");
    const first = layout.blocks.find((block) => block.chainId === "rh-pool");
    const group = layout.groups.find((g) => g.network === "robinhood");
    expect(targetRect(layout, { kind: "block", blockId: "rh-pool-pool" })).toEqual(pool?.rect);
    expect(targetRect(layout, { kind: "chain", chainId: "rh-pool" })).toEqual(first?.rect);
    expect(targetRect(layout, { kind: "network", network: "robinhood" })).toEqual(group?.rect);
    expect(targetRect(layout, null)).toBeNull();
    expect(targetRect(layout, { kind: "block", blockId: "gone" })).toBeNull();
  });
});

describe("revealTarget: what the viewport brings into view after a change (I9)", () => {
  it("[I9] reveals a block that is new and selected", () => {
    // @rule I9
    const before = { layout: layoutOf(emptyPlan()), selectedId: null };
    const after = { layout: layoutOf(hubPoolPlan()), selectedId: "hub-pool-pool" };
    const pool = after.layout.blocks.find((block) => block.id === "hub-pool-pool");
    expect(revealTarget(before, after)).toEqual(pool?.rect);
  });

  it("[I9] reveals an inserted flow block that nobody selected", () => {
    // @rule I9
    const before = { layout: layoutOf(hubPoolPlan()), selectedId: null };
    const after = { layout: layoutOf(hubPoolWithFeesPlan()), selectedId: null };
    const fees = after.layout.blocks.find((block) => block.id === "hub-pool-fees");
    expect(revealTarget(before, after)).toEqual(fees?.rect);
  });

  it("[I9] reveals the group of a network just added", () => {
    // @rule I9
    const before = { layout: layoutOf(emptyPlan()), selectedId: null };
    const after = { layout: layoutOf(emptySpokePlan()), selectedId: null };
    const group = after.layout.groups.find((g) => g.network === "robinhood");
    expect(revealTarget(before, after)).toEqual(group?.rect);
  });

  it("[I9] reveals a block the manager selected without changing the plan", () => {
    // @rule I9
    const layout = layoutOf(twoChains(60, 40));
    const supply = layout.blocks.find((block) => block.id === "hub-supply-supply");
    expect(
      revealTarget({ layout, selectedId: null }, { layout, selectedId: "hub-supply-supply" }),
    ).toEqual(supply?.rect);
  });

  it("[I9] reveals nothing after a remove, which clears the selection", () => {
    // @rule I9
    const before = { layout: layoutOf(twoChains(60, 40)), selectedId: "hub-supply-supply" };
    const after = { layout: layoutOf(hubPoolPlan()), selectedId: null };
    expect(revealTarget(before, after)).toBeNull();
  });

  it("[I9] reveals nothing when nothing changed", () => {
    // @rule I9
    const layout = layoutOf(hubPoolPlan());
    expect(revealTarget({ layout, selectedId: null }, { layout, selectedId: null })).toBeNull();
  });

  it("[I9] the pool id the fixtures configure is the arbitrum one", () => {
    // Guards the fixture assumption the cases above share.
    const pool = hubPoolPlan().hub.chains[0]?.steps[1];
    expect(pool?.family === "position" && pool.config).toEqual({ poolId: TEST_POOL_IDS.arbitrum });
  });
});
