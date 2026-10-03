/**
 * @id PP-MGR-LIB-021
 * @name buildPlan tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module; refusals are reported by the Build screen (S7).
 *
 * Covers G5 and HU2 (the plan shape, `config` null as the empty block) and C22 (the availability
 * table is data). The Borrow entry of the table is deliberately NOT pinned here: whether Aave v3
 * Borrow is enabled is coordinator default D29, overturnable by the product owner, so flipping it is
 * one line of data and no test rewrite. The tests that depend on it set it explicitly.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../../mandateDraft";
import {
  BLOCK_KIND_PROTOCOL,
  BLOCK_KIND_STATUS,
  type BlockKind,
  BUILD_PLAN_VERSION,
  type BuildPlan,
  createEmptyPlan,
  isPlanBlocked,
  planOf,
} from "./buildPlan";

const ALL_KINDS: readonly BlockKind[] = [
  "uniswapV4Pool",
  "aaveSupply",
  "aaveBorrow",
  "uniswapV3Pool",
  "pendle",
  "gmxPerp",
];

describe("the plan shape", () => {
  it("starts empty: version 1, no hub chain, no spoke", () => {
    // @rule G5
    expect(BUILD_PLAN_VERSION).toBe(1);
    expect(createEmptyPlan()).toEqual({ version: 1, hub: { chains: [] }, spokes: [] });
  });

  it("hands out a fresh empty plan on every call, so no caller can mutate a shared one", () => {
    // @rule G5
    const a = createEmptyPlan();
    const b = createEmptyPlan();
    expect(a).not.toBe(b);
    expect(a.hub.chains).not.toBe(b.hub.chains);
  });

  it("reads a draft with no plan as the empty plan, and a draft with one as that plan", () => {
    // @rule G5
    const draft = createEmptyDraft("2026-10-03T00:00:00.000Z", "d1");
    expect(planOf(draft)).toEqual(createEmptyPlan());
    const plan: BuildPlan = {
      version: 1,
      hub: {
        chains: [
          {
            id: "c1",
            sharePct: 0,
            steps: [{ id: "b1", family: "position", kind: "aaveSupply", config: null }],
          },
        ],
      },
      spokes: [],
    };
    expect(planOf({ ...draft, plan })).toBe(plan);
  });

  it("keeps config null as the one marker of an empty block", () => {
    // @rule HU2
    const plan = createEmptyPlan();
    const withEmpty: BuildPlan = {
      ...plan,
      hub: {
        chains: [
          {
            id: "c1",
            sharePct: 0,
            steps: [{ id: "b1", family: "position", kind: "uniswapV4Pool", config: null }],
          },
        ],
      },
    };
    const block = withEmpty.hub.chains[0]?.steps[0];
    expect(block?.family === "position" ? block.config : "not a position").toBeNull();
  });
});

describe("isPlanBlocked", () => {
  it("narrows a refusal and nothing else", () => {
    // @rule G5
    expect(isPlanBlocked({ blocked: { reason: "coming_soon", targetId: null } })).toBe(true);
    expect(isPlanBlocked(createEmptyPlan())).toBe(false);
    expect(isPlanBlocked(null)).toBe(false);
    expect(isPlanBlocked("blocked")).toBe(false);
  });
});

describe("the availability table (C22)", () => {
  it("enables Uniswap v4 pools and Aave v3 Supply", () => {
    // @rule C22
    expect(BLOCK_KIND_STATUS.uniswapV4Pool).toBe("enabled");
    expect(BLOCK_KIND_STATUS.aaveSupply).toBe("enabled");
  });

  it("lists Uniswap v3 positions, Pendle and GMX as coming soon", () => {
    // @rule C22
    expect(BLOCK_KIND_STATUS.uniswapV3Pool).toBe("comingSoon");
    expect(BLOCK_KIND_STATUS.pendle).toBe("comingSoon");
    expect(BLOCK_KIND_STATUS.gmxPerp).toBe("comingSoon");
  });

  it("gives every kind, Borrow included, one of the two statuses (Borrow's value is D29)", () => {
    // @rule C22
    for (const kind of ALL_KINDS) {
      expect(["enabled", "comingSoon"]).toContain(BLOCK_KIND_STATUS[kind]);
    }
    expect(Object.keys(BLOCK_KIND_STATUS).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("maps each kind to the mandate protocol it needs, and Pendle and GMX to none", () => {
    // @rule C22
    expect(BLOCK_KIND_PROTOCOL).toEqual({
      uniswapV4Pool: "uniswap-v4",
      uniswapV3Pool: "uniswap-v3",
      aaveSupply: "aave-v3",
      aaveBorrow: "aave-v3",
      pendle: null,
      gmxPerp: null,
    });
  });
});
