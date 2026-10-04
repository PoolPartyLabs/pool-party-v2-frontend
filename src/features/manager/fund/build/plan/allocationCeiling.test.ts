/**
 * @id PP-MGR-LIB-027
 * @name allocationCeiling tests
 * @implements-rules-version v1 (POO-2184 rules v1)
 * @analytics-events none, a test of a pure function.
 *
 * Handoff P8 (POO-2171, murilo 2026-10-03), the ceiling of a chain's Allocation slider:
 *
 * - [P8a] the mandate caps from Limits are TOTALS: the room under a protocol cap is the cap minus
 *   the shares of the other blocks of that protocol, under a network cap the cap minus the other
 *   blocks on that network;
 * - [P8b] the room of the strategy is 100 minus every other chain, on the hub and inside the spokes;
 * - [P8c] the ceiling is the lowest room and names what stopped it; on a tie it names the mandate
 *   cap; a ceiling that is not a multiple of 5 is a valid stop;
 * - [P8d] per token caps are not applied (open point 11).
 */
import { describe, expect, it } from "vitest";
import type { MandateCaps, MandateDraft } from "../../mandateDraft";
import { allocationCeiling } from "./allocationCeiling";
import type { BuildPlan, Chain } from "./buildPlan";
import {
  hubPoolPlan,
  hubSupplyPlan,
  makeTestDraft,
  spokePoolPlan,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
} from "./planTestKit";

/** The test draft with some caps replaced. */
function withCaps(caps: Partial<MandateCaps>): MandateDraft {
  const draft = makeTestDraft();
  return { ...draft, caps: { ...draft.caps, ...caps } };
}

/** A hub pool chain (Swap · auto, pool) at `pct`, with fresh ids. */
function poolChain(id: string, pct: number, poolId: string = TEST_POOL_IDS.arbitrum): Chain {
  return {
    id,
    sharePct: pct,
    steps: [
      { id: `${id}-swap`, family: "flow", kind: "swap", auto: true },
      { id: `${id}-pool`, family: "position", kind: "uniswapV4Pool", config: { poolId } },
    ],
  };
}

/** A hub Supply USDC chain at `pct`, with fresh ids. */
function supplyChain(id: string, pct: number): Chain {
  return {
    id,
    sharePct: pct,
    steps: [
      {
        id: `${id}-supply`,
        family: "position",
        kind: "aaveSupply",
        config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum },
      },
    ],
  };
}

function hubOf(...chains: Chain[]): BuildPlan {
  return { version: 1, hub: { chains }, spokes: [] };
}

const UNCAPPED = makeTestDraft();

describe("allocationCeiling: the room of the strategy (P8b)", () => {
  it("[P8b] is 100 minus every other hub chain, and says what the others take", () => {
    // @rule P8b
    const plan = hubOf(poolChain("a", 60), supplyChain("b", 30));
    expect(allocationCeiling(plan, { draft: UNCAPPED }, "b")).toEqual({
      max: 40,
      reason: "strategyRoom",
      otherPct: 60,
    });
  });

  it("[P8b] counts the chains inside the spokes, and a lone chain may take everything", () => {
    // @rule P8b
    const plan = spokePoolPlan();
    plan.hub.chains.push(supplyChain("hub-supply", 0));
    expect(allocationCeiling(plan, { draft: UNCAPPED }, "hub-supply")).toMatchObject({
      max: 60,
      reason: "strategyRoom",
      otherPct: 40,
    });
    expect(allocationCeiling(hubSupplyPlan(), { draft: UNCAPPED }, "hub-supply")).toMatchObject({
      max: 100,
      reason: "strategyRoom",
      otherPct: 0,
    });
  });

  it("[P8b] inside a spoke counts the sibling chains, not the spoke's own stored share", () => {
    // @rule P8b
    const plan = spokePoolPlan();
    const spoke = plan.spokes[0];
    if (!spoke) throw new Error("fixture: no spoke");
    spoke.chains.push({ ...poolChain("rh-2", 10, TEST_POOL_IDS.robinhood) });
    spoke.sharePct = 50;
    plan.hub.chains.push(supplyChain("hub-supply", 20));
    const draft = withCaps({ networks: { arbitrum: { noCap: true, pct: 0 } } });
    expect(allocationCeiling(plan, { draft }, "rh-pool")).toEqual({
      max: 70,
      reason: "strategyRoom",
      otherPct: 30,
    });
  });

  it("[P8c] stops at a ceiling that is not a multiple of 5", () => {
    // @rule P8c
    const plan = hubOf(poolChain("a", 63), supplyChain("b", 0));
    expect(allocationCeiling(plan, { draft: UNCAPPED }, "b")?.max).toBe(37);
  });
});

describe("allocationCeiling: the mandate caps are totals (P8a, P8c)", () => {
  it("[P8a] a protocol cap counts the other blocks of that protocol only", () => {
    // @rule P8a
    const draft = withCaps({
      protocols: { "uniswap-v4": { noCap: false, pct: 70 }, "aave-v3": { noCap: true, pct: 0 } },
    });
    const plan = hubOf(poolChain("a", 0), poolChain("b", 30), supplyChain("c", 10));
    expect(allocationCeiling(plan, { draft }, "a")).toEqual({
      max: 40,
      reason: "protocolCap",
      protocol: "uniswap-v4",
      capPct: 70,
      otherPct: 30,
    });
  });

  it("[P8a] a network cap counts the other blocks on that network only", () => {
    // @rule P8a
    const plan = spokePoolPlan();
    const spoke = plan.spokes[0];
    if (!spoke) throw new Error("fixture: no spoke");
    spoke.chains.push(poolChain("rh-2", 0, TEST_POOL_IDS.robinhood));
    plan.hub.chains.push(supplyChain("hub-supply", 20));
    // The test mandate caps Robinhood Chain at 50%.
    expect(allocationCeiling(plan, { draft: UNCAPPED }, "rh-2")).toEqual({
      max: 10,
      reason: "networkCap",
      network: "robinhood",
      capPct: 50,
      otherPct: 40,
    });
  });

  it("[P8c] names the mandate cap when it ties with the room of the strategy", () => {
    // @rule P8c
    const draft = withCaps({
      protocols: { "uniswap-v4": { noCap: false, pct: 70 }, "aave-v3": { noCap: true, pct: 0 } },
    });
    const plan = hubOf(poolChain("a", 0), poolChain("b", 30), supplyChain("c", 30));
    expect(allocationCeiling(plan, { draft }, "a")).toMatchObject({
      max: 40,
      reason: "protocolCap",
    });
  });

  it("[P8c] names the protocol cap when it ties with a network cap", () => {
    // @rule P8c
    const draft = withCaps({
      networks: { arbitrum: { noCap: false, pct: 60 } },
      protocols: { "uniswap-v4": { noCap: false, pct: 50 }, "aave-v3": { noCap: true, pct: 0 } },
    });
    const plan = hubOf(poolChain("a", 0), poolChain("b", 10), supplyChain("c", 10));
    expect(allocationCeiling(plan, { draft }, "a")).toMatchObject({
      max: 40,
      reason: "protocolCap",
    });
  });

  it("[P8a] ignores a cap row marked no cap, and a protocol with no cap row", () => {
    // @rule P8a
    const draft = withCaps({ protocols: {} });
    const plan = hubOf(poolChain("a", 0), poolChain("b", 30));
    expect(allocationCeiling(plan, { draft }, "a")).toMatchObject({
      max: 70,
      reason: "strategyRoom",
    });
  });

  it("[P8a] never goes below 0 when the others already pass the cap", () => {
    // @rule P8a
    const draft = withCaps({
      protocols: { "uniswap-v4": { noCap: false, pct: 20 }, "aave-v3": { noCap: true, pct: 0 } },
    });
    const plan = hubOf(poolChain("a", 0), poolChain("b", 30));
    expect(allocationCeiling(plan, { draft }, "a")).toMatchObject({
      max: 0,
      reason: "protocolCap",
      otherPct: 30,
    });
  });
});

describe("allocationCeiling: what it leaves out (P8d)", () => {
  it("[P8d] applies no per token cap", () => {
    // @rule P8d
    const draft = withCaps({
      tokens: { [TEST_ASSET_KEYS.usdcArbitrum]: { noCap: false, pct: 5 } },
    });
    expect(allocationCeiling(hubSupplyPlan(), { draft }, "hub-supply")).toMatchObject({
      max: 100,
      reason: "strategyRoom",
    });
  });

  it("answers null for a chain the plan does not hold", () => {
    expect(allocationCeiling(hubPoolPlan(), { draft: UNCAPPED }, "gone")).toBeNull();
  });
});
