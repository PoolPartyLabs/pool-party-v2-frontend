/**
 * @id PP-MGR-LIB-021
 * @name planReducers tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module; refusals are reported by the Build screen (S7).
 *
 * Covers I1, I2, I4, I6, I7, C3, C4, C8, C12, C13, C14, C18, C22, HU2, HU5, INV1, INV3 to INV6,
 * A6 and the purity rule (no mutation, no clock, no randomness, a refusal changes nothing).
 *
 * The Aave v3 Borrow status is SET here (enabled by default, coming soon where a test says so)
 * instead of read from the table, so coordinator default D29 can flip without a test rewrite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import {
  type BlockKindStatus,
  type BuildPlan,
  type Chain,
  isPlanBlocked,
  type PlanBlockReason,
  type PlanContext,
  type PlanReducerResult,
  type Step,
} from "./buildPlan";
import {
  addChain,
  addSpoke,
  insertAt,
  reconcileAutoBlocks,
  removeBlock,
  removeSpoke,
  setBlockConfig,
  setChainShare,
  setSpokeShare,
} from "./planReducers";
import type { InsertChoice } from "./planRules";
import {
  emptyPlan,
  emptySpokePlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeIdFactory,
  makeTestContext,
  makeTestDraft,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
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

let ctx: PlanContext;

beforeEach(() => {
  kinds.aaveBorrow = "enabled";
  ctx = makeTestContext();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The plan a reducer produced, failing the test when it refused. */
function ok(result: PlanReducerResult): BuildPlan {
  if (isPlanBlocked(result)) throw new Error(`refused: ${result.blocked.reason}`);
  return result;
}

/** The reason a reducer refused, failing the test when it did not. */
function reason(result: PlanReducerResult): PlanBlockReason {
  if (!isPlanBlocked(result)) throw new Error("expected a refusal");
  return result.blocked.reason;
}

/** The steps of a chain as `family:kind[:auto]` labels, which is what the rules talk about. */
function labels(chain: Chain | undefined): string[] {
  return (chain?.steps ?? []).map((step) =>
    step.family === "flow"
      ? `${step.kind}${step.auto ? ":auto" : ""}`
      : `${step.kind}${step.config === null ? ":empty" : ""}`,
  );
}

function hubChain(plan: BuildPlan, index = 0): Chain | undefined {
  return plan.hub.chains[index];
}

/** The test draft with Robinhood Chain on the canvas as a spoke. */
function withRobinhoodSpoke(plan: BuildPlan = emptyPlan()): BuildPlan {
  return { ...plan, spokes: [{ network: "robinhood", sharePct: 0, chains: [] }] };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ---------------------------------------------------------------------------
// addChain
// ---------------------------------------------------------------------------

describe("addChain (I1, C13, C22)", () => {
  it("adds a pool chain as [Swap · auto, empty pool] with share 0", () => {
    // @rule I1
    const plan = ok(addChain(emptyPlan(), ctx, "arbitrum", "uniswapV4Pool"));
    expect(plan.hub.chains).toHaveLength(1);
    expect(hubChain(plan)?.sharePct).toBe(0);
    expect(labels(hubChain(plan))).toEqual(["swap:auto", "uniswapV4Pool:empty"]);
  });

  it("adds a Supply chain as [empty Supply], with no Swap · auto while its asset is unknown", () => {
    // @rule C13
    const plan = ok(addChain(emptyPlan(), ctx, "arbitrum", "aaveSupply"));
    expect(labels(hubChain(plan))).toEqual(["aaveSupply:empty"]);
  });

  it("appends at the right end of the row and leaves the chains already there untouched", () => {
    // @rule I1
    const before = hubSupplyPlan();
    const plan = ok(addChain(before, ctx, "arbitrum", "uniswapV4Pool"));
    expect(plan.hub.chains).toHaveLength(2);
    expect(plan.hub.chains[0]).toBe(before.hub.chains[0]);
    expect(labels(hubChain(plan, 1))).toEqual(["swap:auto", "uniswapV4Pool:empty"]);
  });

  it("adds to a spoke's row when the network is a spoke on the canvas", () => {
    // @rule I1
    const plan = ok(addChain(withRobinhoodSpoke(), ctx, "robinhood", "uniswapV4Pool"));
    expect(plan.hub.chains).toEqual([]);
    expect(labels(plan.spokes[0]?.chains[0])).toEqual(["swap:auto", "uniswapV4Pool:empty"]);
    expect(plan.spokes[0]?.chains[0]?.sharePct).toBe(0);
  });

  it("never adds Collect fees with a pool (coordinator default D2)", () => {
    // @rule I1
    const plan = ok(addChain(emptyPlan(), ctx, "arbitrum", "uniswapV4Pool"));
    expect(labels(hubChain(plan))).not.toContain("collectFees");
  });

  it("refuses a coming-soon kind", () => {
    // @rule C22
    const draft: MandateDraft = {
      ...makeTestDraft(),
      protocols: [...makeTestDraft().protocols, "uniswap-v3"],
    };
    expect(reason(addChain(emptyPlan(), { ...ctx, draft }, "arbitrum", "uniswapV3Pool"))).toBe(
      "coming_soon",
    );
    expect(reason(addChain(emptyPlan(), ctx, "arbitrum", "pendle"))).toBe("coming_soon");
  });

  it("refuses a kind whose protocol is not in the mandate, or not on that network, as not_in_mandate", () => {
    // @rule I1
    const draft: MandateDraft = {
      ...makeTestDraft(),
      protocols: ["uniswap-v3-swap", "across", "uniswap-v4"],
    };
    expect(reason(addChain(emptyPlan(), { ...ctx, draft }, "arbitrum", "aaveSupply"))).toBe(
      "not_in_mandate",
    );
    // Aave v3 is offered on Arbitrum only.
    expect(reason(addChain(withRobinhoodSpoke(), ctx, "robinhood", "aaveSupply"))).toBe(
      "not_in_mandate",
    );
  });

  it("refuses a network that has no row on the canvas", () => {
    // @rule I1
    expect(reason(addChain(emptyPlan(), ctx, "robinhood", "uniswapV4Pool"))).toBe("unknown_target");
  });

  it("refuses a spoke whose network has left the mandate since it was placed", () => {
    // @rule C6
    const draft: MandateDraft = { ...makeTestDraft(), networks: ["arbitrum"] };
    expect(
      reason(addChain(withRobinhoodSpoke(), { ...ctx, draft }, "robinhood", "uniswapV4Pool")),
    ).toBe("not_in_mandate");
  });

  it("refuses a Borrow as a new chain: it needs a Supply above it (Borrow enabled)", () => {
    // @rule C14
    kinds.aaveBorrow = "enabled";
    expect(reason(addChain(emptyPlan(), ctx, "arbitrum", "aaveBorrow"))).toBe(
      "borrow_needs_supply",
    );
  });

  it("refuses a Borrow as coming soon when the table says so", () => {
    // @rule C22
    kinds.aaveBorrow = "comingSoon";
    expect(reason(addChain(emptyPlan(), ctx, "arbitrum", "aaveBorrow"))).toBe("coming_soon");
  });
});

// ---------------------------------------------------------------------------
// addSpoke and removeSpoke
// ---------------------------------------------------------------------------

describe("addSpoke (I2, INV1, C3, C4)", () => {
  it("appends the spoke at the right with share 0 and no chain", () => {
    // @rule I2
    const plan = ok(addSpoke(hubPoolPlan(), ctx, "robinhood"));
    expect(plan.spokes).toEqual([{ network: "robinhood", sharePct: 0, chains: [] }]);
  });

  it("stores no Bridge: the spoke holds its network, its share and its chains, nothing else", () => {
    // @rule C4
    const plan = ok(addSpoke(emptyPlan(), ctx, "robinhood"));
    expect(Object.keys(plan.spokes[0] ?? {}).sort()).toEqual(["chains", "network", "sharePct"]);
  });

  it("refuses the hub", () => {
    // @rule INV1
    expect(reason(addSpoke(emptyPlan(), ctx, "arbitrum"))).toBe("not_in_mandate");
  });

  it("refuses a network outside the mandate", () => {
    // @rule INV1
    const draft: MandateDraft = { ...makeTestDraft(), networks: ["arbitrum"] };
    expect(reason(addSpoke(emptyPlan(), { ...ctx, draft }, "robinhood"))).toBe("not_in_mandate");
  });

  it("refuses a network already on the canvas", () => {
    // @rule C3
    expect(reason(addSpoke(emptySpokePlan(), ctx, "robinhood"))).toBe("network_on_canvas");
  });
});

describe("removeSpoke (I7)", () => {
  it("removes a spoke with no chain", () => {
    // @rule I7
    expect(ok(removeSpoke(emptySpokePlan(), ctx, "robinhood")).spokes).toEqual([]);
  });

  it("refuses a spoke that still has a chain", () => {
    // @rule I7
    expect(reason(removeSpoke(spokePoolPlan(), ctx, "robinhood"))).toBe("spoke_not_empty");
  });

  it("refuses a network that is not a spoke on the canvas", () => {
    // @rule I7
    expect(reason(removeSpoke(emptyPlan(), ctx, "robinhood"))).toBe("unknown_target");
  });
});

// ---------------------------------------------------------------------------
// insertAt
// ---------------------------------------------------------------------------

const SWAP: InsertChoice = { family: "flow", kind: "swap" };
const FEES: InsertChoice = { family: "flow", kind: "collectFees" };
const BORROW: InsertChoice = { family: "position", kind: "aaveBorrow" };

describe("insertAt (I4, C12, C13, C14, INV5)", () => {
  it("inserts a manager Swap before a card", () => {
    // @rule I4
    const plan = ok(
      insertAt(hubSupplyPlan(), ctx, { side: "before", blockId: "hub-supply-supply" }, SWAP),
    );
    expect(labels(hubChain(plan))).toEqual(["swap", "aaveSupply"]);
  });

  it("inserts Collect fees after a pool", () => {
    // @rule C12
    const plan = ok(
      insertAt(hubPoolPlan(), ctx, { side: "after", blockId: "hub-pool-pool" }, FEES),
    );
    expect(labels(hubChain(plan))).toEqual(["swap:auto", "uniswapV4Pool", "collectFees"]);
  });

  it("inserts an empty Borrow after a Supply", () => {
    // @rule C14
    const plan = ok(
      insertAt(hubSupplyPlan(), ctx, { side: "after", blockId: "hub-supply-supply" }, BORROW),
    );
    expect(labels(hubChain(plan))).toEqual(["aaveSupply", "aaveBorrow:empty"]);
  });

  it("inserts a Swap after a Supply and after a Borrow", () => {
    // @rule C13
    const afterSupply = ok(
      insertAt(hubSupplyPlan(), ctx, { side: "after", blockId: "hub-supply-supply" }, SWAP),
    );
    expect(labels(hubChain(afterSupply))).toEqual(["aaveSupply", "swap"]);
    const afterBorrow = ok(
      insertAt(supplyBorrowPlan(), ctx, { side: "after", blockId: "hub-aave-borrow" }, SWAP),
    );
    expect(labels(hubChain(afterBorrow))).toEqual([
      "swap:auto",
      "aaveSupply",
      "aaveBorrow",
      "swap",
    ]);
  });

  it("refuses anything the slot does not offer", () => {
    // @rule INV5
    // A pool has no top port: its Swap · auto sits there.
    expect(
      reason(insertAt(hubPoolPlan(), ctx, { side: "before", blockId: "hub-pool-pool" }, SWAP)),
    ).toBe("slot_not_allowed");
    // A Swap is not what fits after a pool.
    expect(
      reason(insertAt(hubPoolPlan(), ctx, { side: "after", blockId: "hub-pool-pool" }, SWAP)),
    ).toBe("slot_not_allowed");
  });

  it("changes no other chain and no spoke", () => {
    // @rule I4
    const before: BuildPlan = { ...hubPoolPlan(), spokes: spokePoolPlan().spokes };
    before.hub.chains.push(...hubSupplyPlan().hub.chains);
    const plan = ok(insertAt(before, ctx, { side: "after", blockId: "hub-pool-pool" }, FEES));
    expect(plan.hub.chains[1]).toBe(before.hub.chains[1]);
    expect(plan.spokes).toBe(before.spokes);
  });

  it("refuses a block the plan does not hold", () => {
    // @rule I4
    expect(reason(insertAt(hubPoolPlan(), ctx, { side: "after", blockId: "nope" }, FEES))).toBe(
      "unknown_target",
    );
  });

  it("refuses a Borrow at its own slot when the table lists Borrow as coming soon", () => {
    // @rule C22
    kinds.aaveBorrow = "comingSoon";
    expect(
      reason(
        insertAt(hubSupplyPlan(), ctx, { side: "after", blockId: "hub-supply-supply" }, BORROW),
      ),
    ).toBe("coming_soon");
  });
});

// ---------------------------------------------------------------------------
// removeBlock
// ---------------------------------------------------------------------------

/** One hub chain [Supply USDC, Swap · auto, pool, Collect fees] (canvas A's Supply then pool). */
function supplyThenPoolPlan(): BuildPlan {
  return {
    ...emptyPlan(),
    hub: {
      chains: [
        {
          id: "mix",
          sharePct: 50,
          steps: [
            {
              id: "mix-supply",
              family: "position",
              kind: "aaveSupply",
              config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum },
            },
            { id: "mix-auto", family: "flow", kind: "swap", auto: true },
            {
              id: "mix-pool",
              family: "position",
              kind: "uniswapV4Pool",
              config: { poolId: TEST_POOL_IDS.arbitrum },
            },
            { id: "mix-fees", family: "flow", kind: "collectFees", auto: false },
          ],
        },
      ],
    },
  };
}

describe("removeBlock (I6, INV4, INV6, C18)", () => {
  it("takes a pool's Swap · auto and its Collect fees with it", () => {
    // @rule I6
    const plan = ok(removeBlock(supplyThenPoolPlan(), ctx, "mix-pool"));
    expect(labels(hubChain(plan))).toEqual(["aaveSupply"]);
  });

  it("takes a Supply's Swap · auto and the Borrow under it", () => {
    // @rule I6
    const before = supplyBorrowPlan();
    hubChain(before)?.steps.push(
      { id: "mine", family: "flow", kind: "swap", auto: false },
      { id: "pool-auto", family: "flow", kind: "swap", auto: true },
      {
        id: "pool",
        family: "position",
        kind: "uniswapV4Pool",
        config: { poolId: TEST_POOL_IDS.arbitrum },
      },
    );
    const plan = ok(removeBlock(before, ctx, "hub-aave-supply"));
    expect(labels(hubChain(plan))).toEqual(["swap", "swap:auto", "uniswapV4Pool"]);
  });

  it("removes only the Borrow when the Borrow is removed", () => {
    // @rule I6
    const plan = ok(removeBlock(supplyBorrowPlan(), ctx, "hub-aave-borrow"));
    expect(labels(hubChain(plan))).toEqual(["swap:auto", "aaveSupply"]);
  });

  it("removes the chain with its last position", () => {
    // @rule INV4
    expect(ok(removeBlock(hubPoolPlan(), ctx, "hub-pool-pool")).hub.chains).toEqual([]);
  });

  it("leaves the spoke, empty, when its last chain goes", () => {
    // @rule I6
    const plan = ok(removeBlock(spokePoolPlan(), ctx, "rh-pool-pool"));
    expect(plan.spokes).toEqual([{ network: "robinhood", sharePct: 40, chains: [] }]);
  });

  it("refuses an app-owned block", () => {
    // @rule INV6
    expect(reason(removeBlock(hubPoolPlan(), ctx, "hub-pool-swap"))).toBe("auto_owned");
  });

  it("removes a manager flow block on its own", () => {
    // @rule I6
    const plan = ok(removeBlock(hubPoolWithFeesPlan(), ctx, "hub-pool-fees"));
    expect(labels(hubChain(plan))).toEqual(["swap:auto", "uniswapV4Pool"]);
  });

  it("closes the gap in the edited chain and leaves every other chain as it was", () => {
    // @rule C18
    const before = supplyThenPoolPlan();
    before.hub.chains.push(...hubSupplyPlan().hub.chains);
    const plan = ok(removeBlock(before, ctx, "mix-fees"));
    expect(labels(hubChain(plan))).toEqual(["aaveSupply", "swap:auto", "uniswapV4Pool"]);
    expect(plan.hub.chains[1]).toBe(before.hub.chains[1]);
  });

  it("refuses an id the plan does not hold", () => {
    // @rule I6
    expect(reason(removeBlock(hubPoolPlan(), ctx, "nope"))).toBe("unknown_target");
  });
});

// ---------------------------------------------------------------------------
// setBlockConfig and reconcileAutoBlocks
// ---------------------------------------------------------------------------

/** One hub chain [empty Supply]. */
function emptySupplyPlan(): BuildPlan {
  return ok(addChain(emptyPlan(), makeTestContext(), "arbitrum", "aaveSupply"));
}

function firstPositionId(plan: BuildPlan): string {
  const block = hubChain(plan)?.steps.find((step) => step.family === "position");
  if (!block) throw new Error("fixture: no position");
  return block.id;
}

describe("setBlockConfig (HU2, C13)", () => {
  it("configures a pool with a mandate pool of its network and protocol", () => {
    // @rule HU2
    const added = ok(addChain(emptyPlan(), ctx, "arbitrum", "uniswapV4Pool"));
    const id = firstPositionId(added);
    const plan = ok(setBlockConfig(added, ctx, id, { poolId: TEST_POOL_IDS.arbitrum }));
    expect(labels(hubChain(plan))).toEqual(["swap:auto", "uniswapV4Pool"]);
  });

  it("refuses a pool outside the mandate or on another network", () => {
    // @rule C6
    const added = ok(addChain(emptyPlan(), ctx, "arbitrum", "uniswapV4Pool"));
    const id = firstPositionId(added);
    expect(reason(setBlockConfig(added, ctx, id, { poolId: "not-a-mandate-pool" }))).toBe(
      "not_in_mandate",
    );
    expect(reason(setBlockConfig(added, ctx, id, { poolId: TEST_POOL_IDS.robinhood }))).toBe(
      "not_in_mandate",
    );
  });

  it("refuses an asset that is not a mandate token of the block's network", () => {
    // @rule C6
    const added = emptySupplyPlan();
    const id = firstPositionId(added);
    expect(
      reason(setBlockConfig(added, ctx, id, { assetKey: TEST_ASSET_KEYS.wethRobinhood })),
    ).toBe("not_in_mandate");
  });

  it("refuses a config whose shape does not match the block's kind", () => {
    // @rule HU2
    const supply = emptySupplyPlan();
    expect(
      reason(
        setBlockConfig(supply, ctx, firstPositionId(supply), { poolId: TEST_POOL_IDS.arbitrum }),
      ),
    ).toBe("unknown_target");
    const pool = ok(addChain(emptyPlan(), ctx, "arbitrum", "uniswapV4Pool"));
    expect(
      reason(
        setBlockConfig(pool, ctx, firstPositionId(pool), {
          assetKey: TEST_ASSET_KEYS.usdcArbitrum,
        }),
      ),
    ).toBe("unknown_target");
  });

  it("refuses a flow block and an unknown id", () => {
    // @rule HU2
    expect(
      reason(
        setBlockConfig(hubPoolPlan(), ctx, "hub-pool-swap", { poolId: TEST_POOL_IDS.arbitrum }),
      ),
    ).toBe("unknown_target");
    expect(reason(setBlockConfig(hubPoolPlan(), ctx, "nope", null))).toBe("unknown_target");
  });

  it("places a Swap · auto before a Supply whose asset differs from the arriving USDC, and takes it away again", () => {
    // @rule C13
    const added = emptySupplyPlan();
    const id = firstPositionId(added);
    const weth = ok(setBlockConfig(added, ctx, id, { assetKey: TEST_ASSET_KEYS.wethArbitrum }));
    expect(labels(hubChain(weth))).toEqual(["swap:auto", "aaveSupply"]);
    const usdc = ok(setBlockConfig(weth, ctx, id, { assetKey: TEST_ASSET_KEYS.usdcArbitrum }));
    expect(labels(hubChain(usdc))).toEqual(["aaveSupply"]);
    const emptied = ok(setBlockConfig(weth, ctx, id, null));
    expect(labels(hubChain(emptied))).toEqual(["aaveSupply:empty"]);
  });
});

describe("reconcileAutoBlocks (C13, INV6)", () => {
  /** A one-chain hub plan from raw steps. */
  function chainOf(...steps: Step[]): BuildPlan {
    return { ...emptyPlan(), hub: { chains: [{ id: "c", sharePct: 0, steps }] } };
  }
  const supplyOf = (id: string, assetKey: string | null): Step => ({
    id,
    family: "position",
    kind: "aaveSupply",
    config: assetKey ? { assetKey } : null,
  });

  it("puts a Swap · auto directly before a pool that lacks one, with an id from ctx.newId", () => {
    // @rule C13
    const plan = reconcileAutoBlocks(
      chainOf({ id: "p", family: "position", kind: "uniswapV4Pool", config: null }),
      { draft: ctx.draft, newId: makeIdFactory("auto") },
    );
    expect(hubChain(plan)?.steps[0]).toEqual({
      id: "auto-1",
      family: "flow",
      kind: "swap",
      auto: true,
    });
  });

  it("leaves a Supply without one after a manager Swap, where the arriving token is unknown", () => {
    // @rule C13
    const plan = reconcileAutoBlocks(
      chainOf(
        { id: "m", family: "flow", kind: "swap", auto: false },
        supplyOf("s", TEST_ASSET_KEYS.wethArbitrum),
      ),
      ctx,
    );
    expect(labels(hubChain(plan))).toEqual(["swap", "aaveSupply"]);
  });

  it("reads a Borrow's asset as the token arriving after it", () => {
    // @rule C13
    const borrow: Step = {
      id: "b",
      family: "position",
      kind: "aaveBorrow",
      config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum },
    };
    const same = reconcileAutoBlocks(
      chainOf(
        supplyOf("s1", TEST_ASSET_KEYS.usdcArbitrum),
        borrow,
        supplyOf("s2", TEST_ASSET_KEYS.usdcArbitrum),
      ),
      ctx,
    );
    expect(labels(hubChain(same))).toEqual(["aaveSupply", "aaveBorrow", "aaveSupply"]);
    const other = reconcileAutoBlocks(
      chainOf(
        supplyOf("s1", TEST_ASSET_KEYS.usdcArbitrum),
        borrow,
        supplyOf("s2", TEST_ASSET_KEYS.wethArbitrum),
      ),
      ctx,
    );
    expect(labels(hubChain(other))).toEqual([
      "aaveSupply",
      "aaveBorrow",
      "swap:auto",
      "aaveSupply",
    ]);
  });

  it("takes a Swap · auto away from everywhere else", () => {
    // @rule INV6
    const plan = reconcileAutoBlocks(
      chainOf(
        { id: "a1", family: "flow", kind: "swap", auto: true },
        supplyOf("s", TEST_ASSET_KEYS.usdcArbitrum),
        { id: "a2", family: "flow", kind: "swap", auto: true },
        { id: "a3", family: "flow", kind: "collectFees", auto: true },
      ),
      ctx,
    );
    expect(labels(hubChain(plan))).toEqual(["aaveSupply"]);
  });

  it("keeps the id of a Swap · auto that stays, and the plan itself when nothing changes", () => {
    // @rule INV6
    const before = hubPoolPlan();
    const plan = reconcileAutoBlocks(before, ctx);
    expect(plan).toBe(before);
    expect(hubChain(plan)?.steps[0]?.id).toBe("hub-pool-swap");
  });
});

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

/** Hub pool chain at 60% beside the Robinhood spoke at 40% (its chain at 40%). */
function fullPlan(): BuildPlan {
  return { ...hubPoolPlan(), spokes: spokePoolPlan().spokes };
}

describe("setChainShare and setSpokeShare (HU5, C8, INV3)", () => {
  it("accepts any share from 0 to 100 that fits under its parent", () => {
    // @rule HU5
    expect(hubChain(ok(setChainShare(hubPoolPlan(), ctx, "hub-pool", 100)))?.sharePct).toBe(100);
    expect(hubChain(ok(setChainShare(hubPoolPlan(), ctx, "hub-pool", 0)))?.sharePct).toBe(0);
  });

  it("refuses a hub chain that takes the hub chains plus the spokes past 100", () => {
    // @rule INV3
    expect(reason(setChainShare(fullPlan(), ctx, "hub-pool", 61))).toBe("share_exceeds_parent");
    expect(hubChain(ok(setChainShare(fullPlan(), ctx, "hub-pool", 60)))?.sharePct).toBe(60);
  });

  it("refuses a spoke chain above its spoke's share", () => {
    // @rule C8
    expect(reason(setChainShare(fullPlan(), ctx, "rh-pool", 41))).toBe("share_exceeds_parent");
  });

  it("refuses a spoke that takes the total past 100, or drops below its own chains", () => {
    // @rule C8
    expect(reason(setSpokeShare(fullPlan(), ctx, "robinhood", 41))).toBe("share_exceeds_parent");
    expect(reason(setSpokeShare(fullPlan(), ctx, "robinhood", 39))).toBe("share_exceeds_parent");
    const lowered = ok(setChainShare(fullPlan(), ctx, "rh-pool", 20));
    expect(ok(setSpokeShare(lowered, ctx, "robinhood", 20)).spokes[0]?.sharePct).toBe(20);
  });

  it("refuses a share above 100 or below 0, and one that is not a number", () => {
    // @rule HU5
    expect(reason(setChainShare(hubPoolPlan(), ctx, "hub-pool", 101))).toBe("share_exceeds_parent");
    expect(reason(setChainShare(hubPoolPlan(), ctx, "hub-pool", -1))).toBe("unknown_target");
    expect(reason(setSpokeShare(emptySpokePlan(), ctx, "robinhood", Number.NaN))).toBe(
      "unknown_target",
    );
  });

  it("refuses a chain or a spoke the plan does not hold", () => {
    // @rule HU5
    expect(reason(setChainShare(hubPoolPlan(), ctx, "nope", 10))).toBe("unknown_target");
    expect(reason(setSpokeShare(hubPoolPlan(), ctx, "robinhood", 10))).toBe("unknown_target");
  });

  describe("rounding slack (SHARE_EPSILON)", () => {
    /** Two hub chains holding `a` and `b`, plus the Supply chain the test sets. */
    function twoPlusOne(a: number, b: number): BuildPlan {
      const plan = hubSupplyPlan();
      const chain = (id: string, sharePct: number): Chain => ({
        id,
        sharePct,
        steps: [
          {
            id: `${id}-s`,
            family: "position",
            kind: "aaveSupply",
            config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum },
          },
        ],
      });
      return { ...plan, hub: { chains: [chain("x", a), chain("y", b), ...plan.hub.chains] } };
    }

    it("accepts shares that add up to 100 in decimal, even when floating point lands above it", () => {
      // @rule INV3
      expect(
        hubChain(ok(setChainShare(twoPlusOne(33.3, 33.3), ctx, "hub-supply", 33.4)), 2)?.sharePct,
      ).toBe(33.4);
      // 0.2 + 83.9 + 15.9 is 100.00000000000001 in floating point.
      expect(
        hubChain(ok(setChainShare(twoPlusOne(0.2, 83.9), ctx, "hub-supply", 15.9)), 2)?.sharePct,
      ).toBe(15.9);
    });

    it("refuses a sum that passes 100 by more than the slack", () => {
      // @rule INV3
      expect(reason(setChainShare(twoPlusOne(0.2, 83.9), ctx, "hub-supply", 15.900001))).toBe(
        "share_exceeds_parent",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// A6: the three handoff acceptance rules
// ---------------------------------------------------------------------------

describe("A6", () => {
  it("a Borrow cannot be added without a Supply directly above it", () => {
    // @rule A6
    kinds.aaveBorrow = "enabled";
    expect(reason(addChain(emptyPlan(), ctx, "arbitrum", "aaveBorrow"))).toBe(
      "borrow_needs_supply",
    );
    expect(
      reason(insertAt(hubPoolPlan(), ctx, { side: "after", blockId: "hub-pool-pool" }, BORROW)),
    ).toBe("borrow_needs_supply");
    expect(
      reason(
        insertAt(hubSupplyPlan(), ctx, { side: "before", blockId: "hub-supply-supply" }, BORROW),
      ),
    ).toBe("borrow_needs_supply");
  });

  it("Collect fees cannot be added anywhere but directly after a pool", () => {
    // @rule A6
    expect(
      reason(insertAt(hubSupplyPlan(), ctx, { side: "after", blockId: "hub-supply-supply" }, FEES)),
    ).toBe("slot_not_allowed");
    expect(
      reason(
        insertAt(supplyBorrowPlan(), ctx, { side: "after", blockId: "hub-aave-borrow" }, FEES),
      ),
    ).toBe("slot_not_allowed");
    expect(
      reason(
        insertAt(hubSupplyPlan(), ctx, { side: "before", blockId: "hub-supply-supply" }, FEES),
      ),
    ).toBe("slot_not_allowed");
  });

  it("the Bridge cannot be added or removed alone: it comes and goes with its spoke", () => {
    // @rule A6
    const added = ok(addSpoke(emptyPlan(), ctx, "robinhood"));
    const stored = JSON.stringify(added);
    expect(stored).not.toContain("bridge");
    const bridge = { family: "flow", kind: "bridge" } as unknown as InsertChoice;
    expect(
      reason(
        insertAt(hubSupplyPlan(), ctx, { side: "after", blockId: "hub-supply-supply" }, bridge),
      ),
    ).toBe("slot_not_allowed");
    expect(reason(removeBlock(added, ctx, "bridge"))).toBe("unknown_target");
    expect(reason(removeBlock(added, ctx, "robinhood"))).toBe("unknown_target");
    expect(ok(removeSpoke(added, ctx, "robinhood")).spokes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("purity", () => {
  /** Every reducer once, on frozen input. */
  function runAll(context: PlanContext): PlanReducerResult[] {
    const plan = deepFreeze({ ...supplyThenPoolPlan(), spokes: spokePoolPlan().spokes });
    return [
      addChain(plan, context, "arbitrum", "uniswapV4Pool"),
      addSpoke(deepFreeze(hubPoolPlan()), context, "robinhood"),
      removeSpoke(deepFreeze(emptySpokePlan()), context, "robinhood"),
      insertAt(plan, context, { side: "before", blockId: "mix-supply" }, SWAP),
      removeBlock(plan, context, "mix-pool"),
      setBlockConfig(plan, context, "mix-supply", { assetKey: TEST_ASSET_KEYS.wethArbitrum }),
      setChainShare(plan, context, "mix", 10),
      setSpokeShare(plan, context, "robinhood", 50),
      reconcileAutoBlocks(plan, context),
    ];
  }

  it("never mutates its input", () => {
    // @rule Purity
    const context = { ...makeTestContext(deepFreeze(makeTestDraft())) };
    expect(() => runAll(context)).not.toThrow();
    for (const result of runAll(context)) expect(isPlanBlocked(result)).toBe(false);
  });

  it("reads no clock and no randomness, so equal input gives equal output", () => {
    // @rule Purity
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random read");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now read");
    });
    const first = runAll(makeTestContext());
    const second = runAll(makeTestContext());
    expect(second).toEqual(first);
  });

  it("returns a refusal and leaves the plan exactly as it was", () => {
    // @rule Purity
    const before = hubPoolPlan();
    const snapshot = JSON.stringify(before);
    const result = removeBlock(before, ctx, "hub-pool-swap");
    expect(result).toEqual({ blocked: { reason: "auto_owned", targetId: "hub-pool-swap" } });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
