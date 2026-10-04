import { describe, expect, it } from "vitest";
import { isPlanBlocked } from "../../build/plan/buildPlan";
import { applyBlockConfig } from "../../build/plan/planReducers";
import {
  hubPoolPlan,
  hubSupplyPlan,
  makeTestContext,
  TEST_ASSET_KEYS,
} from "../../build/plan/planTestKit";
import { makeRealModeDraft, REAL_POOL_ID } from "../../build/plan/realPoolTestKit";
import type { FundLaunchDraft } from "../contracts";
import { getLaunchSteps } from "../journey";
import { fallbackAllocations } from "./allocation";
import { applyFallbackExecutionAtLaunch, fallbackLaunchPreview } from "./execution";

describe("applied panel allocation parity", () => {
  it("preserves idle hub capital accepted by the public launch preview", () => {
    const draft = fixture();
    draft.plan.spokes = [];
    draft.plan.hub.chains = [
      {
        id: "supply-root",
        sharePct: 35,
        steps: [
          {
            id: "supply",
            family: "position",
            kind: "aaveSupply",
            config: { assetKey: `arbitrum:${usdc}` },
          },
        ],
      },
    ];
    expect(getLaunchSteps(draft).length).toBeGreaterThan(0);
    const snapshot = applyFallbackExecutionAtLaunch(draft, {}, `arbitrum:${usdc}`);
    expect(snapshot.plan.hub.chains[0]?.sharePct).toBe(35);
    expect(fallbackLaunchPreview(draft, {}, `arbitrum:${usdc}`).blockers).toEqual([]);
  });
  it("preserves an included zero-share empty spoke instead of treating its cap as allocation", () => {
    const draft = fixture();
    draft.plan.spokes = [{ network: "robinhood", sharePct: 0, chains: [] }];
    draft.plan.hub.chains = [
      {
        id: "supply-root",
        sharePct: 35,
        steps: [
          {
            id: "supply",
            family: "position",
            kind: "aaveSupply",
            config: { assetKey: `arbitrum:${usdc}` },
          },
        ],
      },
    ];
    const snapshot = applyFallbackExecutionAtLaunch(draft, {}, `arbitrum:${usdc}`);
    expect(snapshot.plan.spokes[0]?.sharePct).toBe(0);
    expect(getLaunchSteps(snapshot).some((step) => step.kind === "bridge")).toBe(false);
  });
});

const usdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const hubPool = "0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653";
const spokePool = "0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593";
const fixture = () =>
  ({
    id: "fund2",
    networks: ["arbitrum", "robinhood"],
    spokeCapPercent: 50,
    tokens: [{ network: "arbitrum", address: usdc }],
    aaveV3Reserves: [usdc],
    pools: [
      {
        poolId: hubPool,
        network: "arbitrum",
        protocol: "uniswap-v4",
        hasHook: false,
        poolKey: { tickSpacing: 60 },
      },
      {
        poolId: spokePool,
        network: "robinhood",
        protocol: "uniswap-v4",
        hasHook: false,
        poolKey: { tickSpacing: 60 },
      },
    ],
    plan: {
      version: 1,
      hub: {
        chains: [
          {
            id: "hub",
            sharePct: 0,
            steps: [
              { id: "hubPool", family: "position", kind: "uniswapV4Pool", config: null },
              { id: "aave", family: "position", kind: "aaveSupply", config: null },
              { id: "fees", family: "flow", kind: "collectFees" },
            ],
          },
        ],
      },
      spokes: [
        {
          network: "robinhood",
          sharePct: 0,
          chains: [
            {
              id: "spoke",
              sharePct: 0,
              steps: [{ id: "spokePool", family: "position", kind: "uniswapV4Pool", config: null }],
            },
          ],
        },
      ],
    },
    review: {},
  }) as unknown as FundLaunchDraft;

describe("fallback allocations for today's canvas", () => {
  it("preserves #51 atomic panel config and root shares with the real catalog row shape", () => {
    const draft = makeRealModeDraft();
    draft.networks = ["arbitrum"];
    draft.aaveV3Reserves = [TEST_ASSET_KEYS.usdcArbitrum.split(":")[1] ?? ""];
    const poolPlan = hubPoolPlan();
    poolPlan.hub.chains.push(...hubSupplyPlan().hub.chains);
    const config = {
      poolId: REAL_POOL_ID,
      tickLower: -199370,
      tickUpper: -195370,
      fullRange: false,
      displayInverted: false,
      slippagePct: 2,
    };
    const plan = applyBlockConfig(poolPlan, makeTestContext(draft), "hub-pool-pool", config, 60);
    if (isPlanBlocked(plan)) throw new Error(plan.blocked.reason);
    const launchDraft = { ...draft, plan, review: {} } as unknown as FundLaunchDraft;
    const snapshot = applyFallbackExecutionAtLaunch(
      launchDraft,
      { "hub-pool-pool": { tickLower: -600 } },
      TEST_ASSET_KEYS.usdcArbitrum,
      { chains: { "hub-pool": 10, "hub-supply": 90 } },
    );
    expect(snapshot.plan.hub.chains.map((chain) => chain.sharePct)).toEqual([60, 40]);
    expect(
      snapshot.plan.hub.chains[0]?.steps.find((step) => step.family === "position"),
    ).toMatchObject({ config });
    expect(fallbackLaunchPreview(launchDraft, {}, TEST_ASSET_KEYS.usdcArbitrum).blockers).toEqual(
      [],
    );
    expect(launchDraft.plan).toEqual(plan);
  });
  it("preserves the duplicate reserve blocker through fallback readiness", () => {
    const draft = fixture();
    const chain = draft.plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps = [
      { id: "first", family: "position", kind: "aaveSupply", config: null },
      { id: "second", family: "position", kind: "aaveSupply", config: null },
    ];
    expect(fallbackLaunchPreview(draft, {}, `arbitrum:${usdc}`).blockers).toEqual([
      "DUPLICATE_AAVE_RESERVE",
    ]);
  });
  it("takes fund2 zero shares and empty configs through the immutable adapter to the exact signature journey without signing", () => {
    const draft = fixture();
    expect(() => getLaunchSteps(draft)).toThrow();
    const snapshot = applyFallbackExecutionAtLaunch(draft, {}, `arbitrum:${usdc}`);
    expect(snapshot.plan.hub.chains[0]?.sharePct).toBe(50);
    expect(snapshot.plan.spokes[0]?.sharePct).toBe(50);
    expect(snapshot.plan.spokes[0]?.chains[0]?.sharePct).toBe(50);
    expect(snapshot.launchExecution?.hubPool?.leafSharePct).toBe(50);
    expect(snapshot.launchExecution?.aave?.leafSharePct).toBe(50);
    expect(snapshot.launchExecution?.spokePool?.leafSharePct).toBe(100);
    const steps = getLaunchSteps(snapshot);
    expect(
      steps.filter((step) => step.countsAsSignature).map((step) => `${step.id}@${step.chainId}`),
    ).toEqual([
      "approve@42161",
      "create@42161",
      "spoke@4663",
      "profile@42161",
      "allocate@42161",
      "hubPool:swap@42161",
      "hubPool:open@42161",
      "aave:open@42161",
      "bridge@42161",
      "spokePool:swap@4663",
      "spokePool:open@4663",
    ]);
    expect(draft.plan.hub.chains[0]?.sharePct).toBe(0);
    expect(draft.plan.spokes[0]?.sharePct).toBe(0);
    expect(draft.launchExecution).toBeUndefined();
  });
  it("keeps panel config, root and leaf shares authoritative despite fallback edits", () => {
    const draft = fixture();
    const hub = draft.plan.hub.chains[0];
    if (!hub) throw new Error("fixture");
    hub.sharePct = 50;
    const pool = hub.steps[0];
    if (pool?.family !== "position") throw new Error("fixture");
    pool.config = {
      poolId: hubPool,
      tickLower: -120,
      tickUpper: 120,
      slippagePct: 0.5,
    } as typeof pool.config;
    draft.launchExecution = { hubPool: { leafSharePct: 60 }, aave: { leafSharePct: 40 } };
    const snapshot = applyFallbackExecutionAtLaunch(
      draft,
      { hubPool: { tickLower: -600 } },
      `arbitrum:${usdc}`,
      { chains: { hub: 10 }, leaves: { hubPool: 10, aave: 90 } },
    );
    expect(snapshot.plan.hub.chains[0]?.sharePct).toBe(50);
    expect(snapshot.plan.hub.chains[0]?.steps[0]).toEqual(pool);
    expect(snapshot.launchExecution?.hubPool).toEqual({ leafSharePct: 60 });
    expect(getLaunchSteps(snapshot).length).toBeGreaterThan(0);
  });
  it("splits integer remainder into the first position, excluding flow blocks", () => {
    const draft = fixture();
    draft.networks = ["arbitrum"];
    draft.plan.spokes = [];
    const chain = draft.plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps.push({ id: "third", family: "position", kind: "aaveSupply", config: null });
    expect(fallbackAllocations(draft).leaves).toMatchObject({ hubPool: 34, aave: 33, third: 33 });
  });
  it("shows equal defaults even when the parent makes fractional budgets, but blocks launch until edited", () => {
    const draft = fixture();
    const chain = draft.plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps.push({ id: "third", family: "position", kind: "aaveSupply", config: null });
    expect(fallbackAllocations(draft, {}, false).leaves).toMatchObject({
      hubPool: 34,
      aave: 33,
      third: 33,
    });
    expect(() => fallbackAllocations(draft)).toThrow("INVALID_ALLOCATION");
    expect(
      fallbackAllocations(draft, { leaves: { hubPool: 40, aave: 30, third: 30 } }).leaves,
    ).toMatchObject({ hubPool: 40, aave: 30, third: 30 });
  });
  it("refuses guessed network splits, invalid sums and non-integer budgets", () => {
    const draft = fixture();
    draft.spokeCapPercent = null;
    expect(() => fallbackAllocations(draft)).toThrow();
    draft.spokeCapPercent = 50;
    expect(() => fallbackAllocations(draft, { leaves: { hubPool: 70, aave: 70 } })).toThrow();
    expect(() => fallbackAllocations(draft, { leaves: { hubPool: 51, aave: 49 } })).toThrow();
    expect(() => fallbackAllocations(draft, { chains: { hub: -1 } })).toThrow();
    expect(() => fallbackAllocations(draft, { leaves: { hubPool: NaN } })).toThrow();
  });
  it("distributes remaining root budget and never overrides a written root share", () => {
    const draft = fixture();
    const root = draft.plan.hub.chains[0];
    if (!root) throw new Error("fixture");
    root.sharePct = 20;
    root.steps = [root.steps[0]] as typeof root.steps;
    draft.plan.hub.chains.push({
      ...root,
      id: "other",
      sharePct: 0,
      steps: [{ id: "otherPool", family: "position", kind: "uniswapV4Pool", config: null }],
    });
    expect(fallbackAllocations(draft).chains).toEqual({ hub: 20, other: 30, spoke: 50 });
  });
});
