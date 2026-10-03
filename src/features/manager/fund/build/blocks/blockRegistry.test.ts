/**
 * @id PP-MGR-LIB-024
 * @name blockRegistry tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a pure module under test
 *
 * The block registry (slice S5, POO-2155): one definition per kind, the card and pill content
 * derived from `config` (HU2), the card states (empty, invalid, coming soon; D27, C22) and the
 * palette sections (AN8, D25). Every test names its rule with `// @rule`.
 */
import { describe, expect, it } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import {
  BLOCK_KIND_STATUS,
  type BlockKind,
  type BuildPlan,
  createEmptyPlan,
  isPlanBlocked,
} from "../plan/buildPlan";
import { addChain } from "../plan/planReducers";
import { insertOptions } from "../plan/planRules";
import {
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestContext,
  makeTestDraft,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
} from "../plan/planTestKit";
import {
  BLOCK_REGISTRY,
  describeBlock,
  describeFlow,
  describePanelHead,
  paletteModel,
} from "./blockRegistry";
import { catalogWithAaveOnSpoke, makeDescribeContext, makeTestCopy } from "./blockTestKit";

const ALL_KINDS: BlockKind[] = [
  "uniswapV4Pool",
  "aaveSupply",
  "aaveBorrow",
  "uniswapV3Pool",
  "pendle",
  "gmxPerp",
];

/** A hub plan with one chain holding one empty card of `kind`. */
function oneEmpty(kind: BlockKind): BuildPlan {
  return {
    ...createEmptyPlan(),
    hub: {
      chains: [
        {
          id: "c",
          sharePct: 0,
          steps: [
            {
              id: "b",
              family: "position",
              kind,
              config: null,
            } as BuildPlan["hub"]["chains"][number]["steps"][number],
          ],
        },
      ],
    },
  };
}

describe("BLOCK_REGISTRY", () => {
  it("has exactly one definition per block kind, keyed by its kind", () => {
    // @rule HU2
    expect(Object.keys(BLOCK_REGISTRY).sort()).toEqual([...ALL_KINDS].sort());
    for (const kind of ALL_KINDS) expect(BLOCK_REGISTRY[kind].kind).toBe(kind);
  });

  it("reads its status from the S1 availability table, never a copy of its own", () => {
    // @rule C22
    for (const kind of ALL_KINDS) {
      expect(BLOCK_REGISTRY[kind].status).toBe(BLOCK_KIND_STATUS[kind]);
      expect(BLOCK_REGISTRY[kind].paletteSection).toBe(
        BLOCK_KIND_STATUS[kind] === "comingSoon" ? "comingSoon" : "mandate",
      );
    }
  });

  it("gives pools the layers icon and Aave blocks the bank icon", () => {
    // @rule HU2
    expect(BLOCK_REGISTRY.uniswapV4Pool.icon).toBe("layers");
    expect(BLOCK_REGISTRY.uniswapV3Pool.icon).toBe("layers");
    expect(BLOCK_REGISTRY.aaveSupply.icon).toBe("bank");
    expect(BLOCK_REGISTRY.aaveBorrow.icon).toBe("bank");
  });

  it("states placements and companions that agree with the S1 reducers", () => {
    // @rule C13
    // @rule C14
    const ctx = makeTestContext();
    expect(BLOCK_REGISTRY.uniswapV4Pool.placement).toBe("newChain");
    expect(BLOCK_REGISTRY.aaveSupply.placement).toBe("newChain");
    expect(BLOCK_REGISTRY.aaveBorrow.placement).toBe("afterSupply");
    // A Borrow never heads a chain...
    const refused = addChain(createEmptyPlan(), ctx, "arbitrum", "aaveBorrow");
    expect(isPlanBlocked(refused) && refused.blocked.reason).toBe("borrow_needs_supply");
    // ...and is offered after a configured Supply.
    expect(
      insertOptions(hubSupplyPlan(), { side: "after", blockId: "hub-supply-supply" }),
    ).toContainEqual({ family: "position", kind: "aaveBorrow" });
    // A pool always arrives with its Swap · auto; a Supply does not on the hub.
    const pool = addChain(createEmptyPlan(), ctx, "arbitrum", "uniswapV4Pool");
    const supply = addChain(createEmptyPlan(), ctx, "arbitrum", "aaveSupply");
    expect(BLOCK_REGISTRY.uniswapV4Pool.swapAuto).toBe("always");
    expect(BLOCK_REGISTRY.aaveSupply.swapAuto).toBe("whenAssetDiffers");
    expect(BLOCK_REGISTRY.aaveBorrow.swapAuto).toBe("never");
    expect(!isPlanBlocked(pool) && pool.hub.chains[0]?.steps.map((s) => s.kind)).toEqual([
      "swap",
      "uniswapV4Pool",
    ]);
    expect(!isPlanBlocked(supply) && supply.hub.chains[0]?.steps.map((s) => s.kind)).toEqual([
      "aaveSupply",
    ]);
  });

  it("names the field an empty block waits for", () => {
    // @rule HU2
    expect(BLOCK_REGISTRY.uniswapV4Pool.configField).toBe("pool");
    expect(BLOCK_REGISTRY.uniswapV3Pool.configField).toBe("pool");
    expect(BLOCK_REGISTRY.aaveSupply.configField).toBe("asset");
    expect(BLOCK_REGISTRY.aaveBorrow.configField).toBe("asset");
    expect(BLOCK_REGISTRY.pendle.configField).toBeNull();
    expect(BLOCK_REGISTRY.gmxPerp.configField).toBeNull();
  });
});

describe("describeBlock", () => {
  it("titles a configured pool with its pair and captions it with the protocol and the fee", () => {
    // @rule HU2
    const content = describeBlock("hub-pool-pool", makeDescribeContext(hubPoolPlan()));
    expect(content.title).toBe("WETH / USDC");
    expect(content.caption).toBe("Uniswap v4 · 0.05%");
    expect(content.icon).toBe("layers");
    expect(content.state).toBe("default");
  });

  it("titles a configured Supply and Borrow with their asset, captioned Aave v3 on the hub", () => {
    // @rule HU2
    const ctx = makeDescribeContext(supplyBorrowPlan());
    expect(describeBlock("hub-aave-supply", ctx)).toMatchObject({
      title: "Supply WETH",
      caption: "Aave v3",
      icon: "bank",
      state: "default",
    });
    expect(describeBlock("hub-aave-borrow", ctx)).toMatchObject({
      title: "Borrow USDC",
      caption: "Aave v3",
      state: "default",
    });
  });

  it("captions a Supply on a spoke with the network: Aave v3 · Robinhood Chain", () => {
    // @rule HU2
    const plan: BuildPlan = {
      ...createEmptyPlan(),
      spokes: [
        {
          network: "robinhood",
          sharePct: 30,
          chains: [
            {
              id: "rh-aave",
              sharePct: 30,
              steps: [
                {
                  id: "rh-supply",
                  family: "position",
                  kind: "aaveSupply",
                  config: { assetKey: TEST_ASSET_KEYS.usdgRobinhood },
                },
              ],
            },
          ],
        },
      ],
    };
    const ctx = makeDescribeContext(plan, makeTestDraft(), catalogWithAaveOnSpoke());
    expect(ctx.violations).toEqual([]);
    expect(describeBlock("rh-supply", ctx)).toMatchObject({
      title: "Supply USDG",
      caption: "Aave v3 · Robinhood Chain",
      state: "default",
    });
  });

  it("gives an empty block its empty title and the pick caption", () => {
    // @rule HU2
    // @rule G6
    expect(describeBlock("b", makeDescribeContext(oneEmpty("uniswapV4Pool")))).toMatchObject({
      title: "Uniswap v4",
      caption: "Pick a pool",
      state: "empty",
    });
    expect(describeBlock("b", makeDescribeContext(oneEmpty("aaveSupply")))).toMatchObject({
      title: "Aave v3 Supply",
      caption: "Pick an asset",
      state: "empty",
    });
    expect(describeBlock("b", makeDescribeContext(oneEmpty("aaveBorrow")))).toMatchObject({
      title: "Aave v3 Borrow",
      caption: "Pick an asset",
    });
  });

  it("shows a block whose pool left the mandate as invalid, never deleting it", () => {
    // @rule HU2
    // @rule D6
    const draft: MandateDraft = { ...makeTestDraft(), pools: [] };
    const content = describeBlock("hub-pool-pool", makeDescribeContext(hubPoolPlan(), draft));
    expect(content.state).toBe("invalid");
    expect(content.caption).toBe("No longer in your mandate");
    expect(content.title).toBe("Uniswap v4");
  });

  it("shows a block whose protocol left the mandate as invalid", () => {
    // @rule HU2
    const draft: MandateDraft = {
      ...makeTestDraft(),
      protocols: ["uniswap-v3-swap", "across", "uniswap-v4"],
    };
    const content = describeBlock("hub-supply-supply", makeDescribeContext(hubSupplyPlan(), draft));
    expect(content.state).toBe("invalid");
    expect(content.title).toBe("Supply USDC");
    expect(content.caption).toBe("No longer in your mandate");
  });

  it("shows every block of a spoke whose network left the mandate as invalid", () => {
    // @rule HU2
    const draft: MandateDraft = { ...makeTestDraft(), networks: ["arbitrum"] };
    const content = describeBlock("rh-pool-pool", makeDescribeContext(spokePoolPlan(), draft));
    expect(content.state).toBe("invalid");
  });

  it("shows a coming-soon kind with the Soon tag, whatever its config", () => {
    // @rule C22
    // @rule D27
    const v3 = describeBlock("b", makeDescribeContext(oneEmpty("uniswapV3Pool")));
    expect(v3).toMatchObject({ title: "Uniswap v3", state: "comingSoon", soonTag: "Soon" });
    const pendle = describeBlock("b", makeDescribeContext(oneEmpty("pendle")));
    expect(pendle).toMatchObject({
      title: "Pendle",
      caption: "Yield position",
      state: "comingSoon",
    });
    const gmx = describeBlock("b", makeDescribeContext(oneEmpty("gmxPerp")));
    expect(gmx).toMatchObject({ title: "GMX", caption: "Perp position", state: "comingSoon" });
  });

  it("names a card by its place: title, caption, network and the chain's share", () => {
    // @rule I10
    const content = describeBlock("hub-pool-pool", makeDescribeContext(hubPoolPlan()));
    expect(content.accessibleName).toBe(
      "WETH / USDC, Uniswap v4 · 0.05%, on Arbitrum, 60% of the capital",
    );
    const spoke = describeBlock("rh-pool-pool", makeDescribeContext(spokePoolPlan()));
    expect(spoke.accessibleName).toMatch(/, on Robinhood Chain, 40% of the capital$/);
  });

  it("re-renders from config: the same block reads differently once configured", () => {
    // @rule HU2
    const empty = oneEmpty("uniswapV4Pool");
    const configured = structuredClone(empty);
    const step = configured.hub.chains[0]?.steps[0];
    if (step?.family === "position" && step.kind === "uniswapV4Pool") {
      step.config = { poolId: "arb-v4-weth-usdc-5" };
    }
    expect(describeBlock("b", makeDescribeContext(empty)).title).toBe("Uniswap v4");
    expect(describeBlock("b", makeDescribeContext(configured)).title).toBe("WETH / USDC");
  });

  it("answers an unknown id with a neutral invalid card instead of throwing", () => {
    // @rule HU2
    expect(describeBlock("nope", makeDescribeContext(hubPoolPlan())).state).toBe("invalid");
  });
});

describe("describeFlow", () => {
  it("explains the Swap · auto before a pool with the token that arrives", () => {
    // @rule C13
    // @rule D7
    expect(describeFlow("hub-pool-swap", makeDescribeContext(hubPoolPlan()))).toEqual({
      text: "Swap · auto",
      tooltip: "The app swaps USDC into the pool tokens",
      icon: "swap",
    });
    expect(describeFlow("rh-pool-swap", makeDescribeContext(spokePoolPlan())).tooltip).toBe(
      "The app swaps USDG into the pool tokens",
    );
  });

  it("explains the Swap · auto before a Supply with the asset it buys", () => {
    // @rule C13
    expect(describeFlow("hub-aave-swap", makeDescribeContext(supplyBorrowPlan())).tooltip).toBe(
      "The app swaps USDC into WETH",
    );
  });

  it("explains Collect fees and a manager Swap", () => {
    // @rule C12
    expect(describeFlow("hub-pool-fees", makeDescribeContext(hubPoolWithFeesPlan()))).toEqual({
      text: "Collect fees",
      tooltip: "Claims the pool fees into Income (fees)",
      icon: "coins",
    });
    const plan = supplyBorrowPlan();
    plan.hub.chains[0]?.steps.push({ id: "m-swap", family: "flow", kind: "swap", auto: false });
    expect(describeFlow("m-swap", makeDescribeContext(plan))).toEqual({
      text: "Swap",
      tooltip: "Swaps into another token of your mandate",
      icon: "swap",
    });
  });
});

describe("paletteModel", () => {
  const copy = makeTestCopy();

  function names(model: ReturnType<typeof paletteModel>, section: string): string[] {
    return model.sections.find((s) => s.id === section)?.items.map((i) => i.id) ?? [];
  }

  it("lists the enabled kinds of the mandate, the flow blocks, then the coming-soon rows", () => {
    // @rule AN8
    // @rule D25
    const model = paletteModel(makeTestDraft(), copy);
    expect(model.sections.map((s) => s.id)).toEqual(["mandate", "flow", "comingSoon"]);
    expect(model.sections.map((s) => s.label)).toEqual([
      "From your mandate",
      "Flow blocks",
      "Coming soon",
    ]);
    expect(names(model, "mandate")).toEqual(["uniswapV4Pool", "aaveSupply", "aaveBorrow"]);
    expect(names(model, "flow")).toEqual(["swap", "collectFees"]);
    expect(names(model, "comingSoon")).toEqual(["uniswapV3Pool", "pendle", "gmxPerp"]);
    expect(model.caption).toBe(
      "Drag a block onto the canvas. It arrives empty: pick the pool, asset or market on the right.",
    );
    expect(model.soonTag).toBe("Soon");
    expect(model.soonTooltip).toBe("Coming soon");
  });

  it("prints protocol name over block type, and the flow rows by their name", () => {
    // @rule AN8
    const model = paletteModel(makeTestDraft(), copy);
    const mandate = model.sections[0]?.items ?? [];
    expect(mandate.map((i) => [i.name, i.caption])).toEqual([
      ["Uniswap v4", "Liquidity position"],
      ["Aave v3", "Supply"],
      ["Aave v3", "Borrow"],
    ]);
    expect(model.sections[1]?.items.map((i) => [i.name, i.caption])).toEqual([
      ["Swap", null],
      ["Collect fees", null],
    ]);
  });

  it("makes every mandate and flow row draggable and no coming-soon row", () => {
    // @rule AN8
    // @rule I3
    const model = paletteModel(makeTestDraft(), copy);
    for (const item of [...(model.sections[0]?.items ?? []), ...(model.sections[1]?.items ?? [])]) {
      expect(item.drag).not.toBeNull();
    }
    for (const item of model.sections[2]?.items ?? []) expect(item.drag).toBeNull();
    expect(model.sections[0]?.items[0]?.drag).toEqual({
      family: "position",
      kind: "uniswapV4Pool",
    });
    expect(model.sections[1]?.items[1]?.drag).toEqual({ family: "flow", kind: "collectFees" });
  });

  it("drops the Aave cards when Aave v3 is not in the mandate", () => {
    // @rule D25
    const draft: MandateDraft = {
      ...makeTestDraft(),
      protocols: ["uniswap-v3-swap", "across", "uniswap-v4"],
    };
    const model = paletteModel(draft, copy);
    expect(names(model, "mandate")).toEqual(["uniswapV4Pool"]);
    expect(names(model, "flow")).toEqual(["swap", "collectFees"]);
  });

  it("drops the v4 card and Collect fees when Uniswap v4 is not in the mandate", () => {
    // @rule D25
    const draft: MandateDraft = {
      ...makeTestDraft(),
      protocols: ["uniswap-v3-swap", "across", "aave-v3"],
    };
    const model = paletteModel(draft, copy);
    expect(names(model, "mandate")).toEqual(["aaveSupply", "aaveBorrow"]);
    expect(names(model, "flow")).toEqual(["swap"]);
  });

  it("drops the empty mandate section and keeps the coming-soon rows when no position protocol is in", () => {
    // @rule AN8
    const draft: MandateDraft = { ...makeTestDraft(), protocols: ["uniswap-v3-swap", "across"] };
    const model = paletteModel(draft, copy);
    expect(model.sections.map((s) => s.id)).toEqual(["flow", "comingSoon"]);
    expect(names(model, "comingSoon")).toEqual(["uniswapV3Pool", "pendle", "gmxPerp"]);
  });

  it("never lists a Bridge or an Output", () => {
    // @rule AN8
    const model = paletteModel(makeTestDraft(), copy);
    const all = model.sections.flatMap((s) => s.items);
    const text = all.map((i) => `${i.id} ${i.name} ${i.caption ?? ""}`.toLowerCase()).join("|");
    expect(text).not.toMatch(/bridge/);
    expect(text).not.toMatch(/output|withdraw|deposit|idle/);
  });
});

describe("describePanelHead", () => {
  it("heads a configured block with its protocol, its type and its network", () => {
    // @rule AN10
    expect(describePanelHead("hub-pool-pool", makeDescribeContext(hubPoolPlan()))).toEqual({
      blockKind: "uniswapV4Pool",
      protocolName: "Uniswap v4",
      blockType: "Liquidity position",
      network: "arbitrum",
      networkName: "Arbitrum",
    });
    expect(describePanelHead("rh-pool-pool", makeDescribeContext(spokePoolPlan()))).toMatchObject({
      network: "robinhood",
      networkName: "Robinhood Chain",
    });
  });

  it("says what an empty block still lacks: no pool yet, no asset yet", () => {
    // @rule AN10
    // @rule G6
    expect(describePanelHead("b", makeDescribeContext(oneEmpty("uniswapV4Pool")))?.blockType).toBe(
      "Liquidity position · no pool yet",
    );
    expect(describePanelHead("b", makeDescribeContext(oneEmpty("aaveSupply")))?.blockType).toBe(
      "Supply · no asset yet",
    );
    expect(describePanelHead("b", makeDescribeContext(oneEmpty("aaveBorrow")))).toMatchObject({
      protocolName: "Aave v3",
      blockType: "Borrow · no asset yet",
    });
  });

  it("heads nothing for a pill or an unknown id", () => {
    // @rule I5
    expect(describePanelHead("hub-pool-swap", makeDescribeContext(hubPoolPlan()))).toBeNull();
    expect(describePanelHead("nope", makeDescribeContext(hubPoolPlan()))).toBeNull();
  });
});
