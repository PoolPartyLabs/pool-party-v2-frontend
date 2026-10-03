/**
 * @id PP-MGR-LIB-021
 * @name planRules tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module.
 *
 * Covers C22 and INV2 (`kindAvailability`, one test per branch and one for the precedence), C17
 * (`portSlotsOf`), I4 (`insertOptions`, the I4 list only, coordinator default D1) and the arriving
 * token C13 reads (`arrivingTokenKey`).
 *
 * The Aave v3 Borrow status is SET here (enabled in one block, coming soon in another) instead of
 * read from the table, so coordinator default D29 can flip without a test rewrite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import type { BlockKindStatus, BuildPlan, Step } from "./buildPlan";
import {
  arrivingTokenKey,
  insertOptions,
  kindAvailability,
  type PortStepShape,
  portSlotsOf,
} from "./planRules";
import {
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestContext,
  makeTestDraft,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
} from "./planTestKit";

const kinds = vi.hoisted(() => ({ aaveBorrow: "enabled" as BlockKindStatus }));
vi.mock("./buildPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildPlan")>();
  return {
    ...actual,
    BLOCK_KIND_STATUS: {
      ...actual.BLOCK_KIND_STATUS,
      get aaveBorrow() {
        return kinds.aaveBorrow;
      },
    },
  };
});

beforeEach(() => {
  kinds.aaveBorrow = "enabled";
});

const ctx = makeTestContext();

/** The test draft with a different protocol list. */
function withProtocols(protocols: MandateDraft["protocols"]): MandateDraft {
  return { ...makeTestDraft(), protocols };
}

describe("kindAvailability (C22, INV2)", () => {
  it("is enabled for an enabled kind whose protocol is in the mandate and runs on the network", () => {
    // @rule C22
    expect(kindAvailability("uniswapV4Pool", "robinhood", ctx)).toBe("enabled");
    expect(kindAvailability("aaveSupply", "arbitrum", ctx)).toBe("enabled");
  });

  it("is coming_soon for a kind the table lists as coming soon, whatever the mandate", () => {
    // @rule C22
    const draft = withProtocols([...makeTestDraft().protocols, "uniswap-v3"]);
    expect(kindAvailability("uniswapV3Pool", "arbitrum", { ...ctx, draft })).toBe("coming_soon");
    expect(kindAvailability("pendle", "arbitrum", ctx)).toBe("coming_soon");
    expect(kindAvailability("gmxPerp", "arbitrum", ctx)).toBe("coming_soon");
  });

  it("is not_in_mandate when the kind's protocol is not in the mandate", () => {
    // @rule INV2
    const draft = withProtocols(["uniswap-v3-swap", "across", "uniswap-v4"]);
    expect(kindAvailability("aaveSupply", "arbitrum", { ...ctx, draft })).toBe("not_in_mandate");
  });

  it("is not_on_network when the catalog does not offer the protocol on that network", () => {
    // @rule INV2
    // Aave v3 runs on Arbitrum only in the catalog.
    expect(kindAvailability("aaveSupply", "robinhood", ctx)).toBe("not_on_network");
  });

  it("answers coming_soon before not_in_mandate, and not_in_mandate before not_on_network", () => {
    // @rule C22
    const noAave = withProtocols(["uniswap-v3-swap", "across", "uniswap-v4"]);
    // uniswap-v3 is not in the mandate either: coming soon still wins.
    expect(kindAvailability("uniswapV3Pool", "arbitrum", { ...ctx, draft: noAave })).toBe(
      "coming_soon",
    );
    // Aave v3 is neither in the mandate nor offered on Robinhood Chain: the mandate wins.
    expect(kindAvailability("aaveSupply", "robinhood", { ...ctx, draft: noAave })).toBe(
      "not_in_mandate",
    );
  });

  describe("Aave v3 Borrow, status set explicitly (D29)", () => {
    it("is enabled when the table enables it", () => {
      // @rule C22
      kinds.aaveBorrow = "enabled";
      expect(kindAvailability("aaveBorrow", "arbitrum", ctx)).toBe("enabled");
    });

    it("is coming_soon when the table lists it as coming soon", () => {
      // @rule C22
      kinds.aaveBorrow = "comingSoon";
      expect(kindAvailability("aaveBorrow", "arbitrum", ctx)).toBe("coming_soon");
    });
  });
});

/** A port shape, configured unless said otherwise. */
function shape(family: "position" | "flow", kind: string, configured = true): PortStepShape {
  return { family, kind, configured };
}

describe("portSlotsOf (C17)", () => {
  it("gives a configured card alone in its chain a top and a bottom port", () => {
    // @rule C17
    expect(portSlotsOf([shape("position", "aaveSupply")])).toEqual([
      { index: 0, top: true, bottom: true },
    ]);
  });

  it("gives an empty block no port at all", () => {
    // @rule C17
    expect(portSlotsOf([shape("position", "aaveSupply", false)])).toEqual([
      { index: 0, top: false, bottom: false },
    ]);
  });

  it("puts no top port under a pill and no bottom port over a pill", () => {
    // @rule C17
    expect(
      portSlotsOf([
        shape("flow", "swap"),
        shape("position", "uniswapV4Pool"),
        shape("flow", "collectFees"),
      ]),
    ).toEqual([{ index: 1, top: false, bottom: false }]);
    expect(portSlotsOf([shape("flow", "swap"), shape("position", "uniswapV4Pool")])).toEqual([
      { index: 1, top: false, bottom: true },
    ]);
  });

  it("puts no port between a Supply and the Borrow directly under it", () => {
    // @rule C17
    expect(portSlotsOf([shape("position", "aaveSupply"), shape("position", "aaveBorrow")])).toEqual(
      [
        { index: 0, top: true, bottom: false },
        { index: 1, top: false, bottom: true },
      ],
    );
  });

  it("lists every card and no pill", () => {
    // @rule C17
    const slots = portSlotsOf([
      shape("flow", "swap"),
      shape("position", "aaveSupply"),
      shape("position", "aaveBorrow"),
      shape("flow", "swap"),
    ]);
    expect(slots.map((slot) => slot.index)).toEqual([1, 2]);
  });
});

describe("insertOptions (I4, D1)", () => {
  it("offers Swap before a card", () => {
    // @rule I4
    expect(
      insertOptions(hubSupplyPlan(), { side: "before", blockId: "hub-supply-supply" }),
    ).toEqual([{ family: "flow", kind: "swap" }]);
  });

  it("offers Collect fees after a pool, and nothing else", () => {
    // @rule I4
    expect(insertOptions(hubPoolPlan(), { side: "after", blockId: "hub-pool-pool" })).toEqual([
      { family: "flow", kind: "collectFees" },
    ]);
  });

  it("offers Borrow and Swap after a Supply", () => {
    // @rule I4
    expect(insertOptions(hubSupplyPlan(), { side: "after", blockId: "hub-supply-supply" })).toEqual(
      [
        { family: "position", kind: "aaveBorrow" },
        { family: "flow", kind: "swap" },
      ],
    );
  });

  it("offers Swap after a Borrow", () => {
    // @rule I4
    expect(
      insertOptions(supplyBorrowPlan(), { side: "after", blockId: "hub-aave-borrow" }),
    ).toEqual([{ family: "flow", kind: "swap" }]);
  });

  it("offers nothing where the card has no port", () => {
    // @rule I4
    // A pool always has its Swap · auto above it.
    expect(insertOptions(hubPoolPlan(), { side: "before", blockId: "hub-pool-pool" })).toEqual([]);
    // A pool that already has its Collect fees.
    expect(
      insertOptions(hubPoolWithFeesPlan(), { side: "after", blockId: "hub-pool-pool" }),
    ).toEqual([]);
    // Nothing between a Supply and its Borrow.
    expect(
      insertOptions(supplyBorrowPlan(), { side: "after", blockId: "hub-aave-supply" }),
    ).toEqual([]);
  });

  it("offers nothing on an empty block, a pill or an unknown id", () => {
    // @rule I4
    const plan = hubSupplyPlan();
    const chain = plan.hub.chains[0];
    if (chain) chain.steps = [{ id: "s", family: "position", kind: "aaveSupply", config: null }];
    expect(insertOptions(plan, { side: "after", blockId: "s" })).toEqual([]);
    expect(insertOptions(hubPoolPlan(), { side: "after", blockId: "hub-pool-swap" })).toEqual([]);
    expect(insertOptions(hubPoolPlan(), { side: "after", blockId: "nope" })).toEqual([]);
  });
});

describe("arrivingTokenKey (C13)", () => {
  it("is the hub's USDC at the head of a hub chain, past any Swap · auto", () => {
    // @rule C13
    expect(arrivingTokenKey(hubSupplyPlan(), ctx, "hub-supply-supply")).toBe(
      TEST_ASSET_KEYS.usdcArbitrum,
    );
    expect(arrivingTokenKey(hubPoolPlan(), ctx, "hub-pool-pool")).toBe(
      TEST_ASSET_KEYS.usdcArbitrum,
    );
  });

  it("is the spoke's deposit token at the head of a spoke chain (USDG on Robinhood Chain)", () => {
    // @rule C13
    expect(arrivingTokenKey(spokePoolPlan(), ctx, "rh-pool-pool")).toBe(
      TEST_ASSET_KEYS.usdgRobinhood,
    );
  });

  it("is the Borrow's asset after a configured Borrow, and unknown after an empty one", () => {
    // @rule C13
    const plan = supplyBorrowPlan();
    const swap: Step = { id: "after-borrow", family: "flow", kind: "swap", auto: false };
    plan.hub.chains[0]?.steps.push(swap);
    expect(arrivingTokenKey(plan, ctx, "after-borrow")).toBe(TEST_ASSET_KEYS.usdcArbitrum);
    const borrow = plan.hub.chains[0]?.steps[2];
    if (borrow?.family === "position") borrow.config = null;
    expect(arrivingTokenKey(plan, ctx, "after-borrow")).toBeNull();
  });

  it("is unknown after a manager Swap", () => {
    // @rule C13
    const plan: BuildPlan = hubSupplyPlan();
    plan.hub.chains[0]?.steps.unshift({ id: "mine", family: "flow", kind: "swap", auto: false });
    expect(arrivingTokenKey(plan, ctx, "hub-supply-supply")).toBeNull();
  });

  it("is unknown for a block the plan does not hold", () => {
    // @rule C13
    expect(arrivingTokenKey(hubSupplyPlan(), ctx, "nope")).toBeNull();
  });
});
