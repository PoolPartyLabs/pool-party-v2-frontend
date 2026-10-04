import { describe, expect, it } from "vitest";
import type { FundLaunchDraft } from "../contracts";
import {
  alignTick,
  applyFallbackExecutionAtLaunch,
  fallbackLaunchPreview,
  fullRangeTicks,
} from "./execution";

const poolId = `0x${"12".repeat(32)}`;
const asset = `0x${"34".repeat(20)}`;
const fixture = () =>
  ({
    id: "draft",
    networks: ["arbitrum"],
    aaveV3Reserves: [asset],
    tokens: [{ network: "arbitrum", address: asset }],
    pools: [
      {
        poolId,
        network: "arbitrum",
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
            id: "root",
            sharePct: 100,
            steps: [{ id: "position", family: "position", kind: "uniswapV4Pool", config: {} }],
          },
        ],
      },
      spokes: [],
    },
    review: {},
  }) as unknown as FundLaunchDraft;

describe("fallback execution [R2, R3, R4, R5]", () => {
  it.each([1, 10, 60, 200])("aligns finite full range inward for spacing %i", (spacing) => {
    const range = fullRangeTicks(spacing);
    expect(range.tickLower).toBeGreaterThanOrEqual(-887272);
    expect(range.tickUpper).toBeLessThanOrEqual(887272);
    expect(range.tickLower % spacing).toBeCloseTo(0);
    expect(range.tickUpper % spacing).toBe(0);
    expect(range.tickLower - spacing).toBeLessThan(-887272);
    expect(range.tickUpper + spacing).toBeGreaterThan(887272);
  });
  it("aligns negative ticks using mathematical floor and ceil", () => {
    expect(alignTick(-61, 60, "up")).toBe(-60);
    expect(alignTick(-61, 60, "down")).toBe(-120);
    expect(fullRangeTicks(200)).toEqual({ tickLower: -887200, tickUpper: 887200 });
  });
  it.each([0, -1, 1.5, NaN, Infinity, 887273])("rejects invalid spacing %s", (spacing) => {
    expect(() => fullRangeTicks(spacing)).toThrow();
  });
  it("applies defaults to an immutable launch snapshot, not canvas storage", () => {
    const draft = fixture();
    const snapshot = applyFallbackExecutionAtLaunch(draft, {});
    expect(snapshot.plan.hub.chains[0]?.steps[0]?.config).toEqual({
      poolId,
      ...fullRangeTicks(60),
      fullRange: true,
      displayInverted: false,
      slippagePct: 1,
    });
    expect(draft.plan.hub.chains[0]?.steps[0]?.config).toEqual({});
    expect(fallbackLaunchPreview(draft, {}).steps.length).toBeGreaterThan(0);
  });
  it("lets nonempty panel config win over fallback and stale execution overrides", () => {
    const draft = fixture();
    const block = draft.plan.hub.chains[0]?.steps[0];
    if (!block) throw new Error("fixture");
    block.config = { poolId, tickLower: -120, tickUpper: 120, slippagePct: 0.5 };
    draft.launchExecution = { position: { tickLower: -600, tickUpper: 600, maxLossBps: 400 } };
    const snapshot = applyFallbackExecutionAtLaunch(draft, { position: { tickLower: -60 } });
    expect(snapshot.plan.hub.chains[0]?.steps[0]?.config).toEqual(block.config);
    expect(snapshot.launchExecution?.position).toEqual({});
  });
  it("derives Aave Supply identity only from the Mandate and blocks unsupported assets", () => {
    const draft = fixture();
    const block = draft.plan.hub.chains[0]?.steps[0];
    if (!block) throw new Error("fixture");
    block.kind = "aaveSupply";
    expect(
      applyFallbackExecutionAtLaunch(draft, {}, `arbitrum:${asset}`).plan.hub.chains[0]?.steps[0]
        ?.config,
    ).toEqual({ assetKey: `arbitrum:${asset}` });
    expect(fallbackLaunchPreview(draft, {}, "arbitrum:other").blockers).toContain(
      "EXECUTION_UNAVAILABLE",
    );
  });
  it("requires explicit selection for ambiguous pools and reserves", () => {
    const draft = fixture();
    draft.pools.push({
      ...draft.pools[0],
      poolId: `0x${"56".repeat(32)}`,
    } as (typeof draft.pools)[number]);
    expect(fallbackLaunchPreview(draft, {}).blockers).toContain("EXECUTION_UNAVAILABLE");
    expect(fallbackLaunchPreview(draft, { position: { poolId } }).blockers).toEqual([]);
  });
  it.each([
    { tickLower: -61, tickUpper: 120 },
    { tickLower: 120, tickUpper: -120 },
    { slippagePct: 0.09 },
    { slippagePct: 5.01 },
    { tickUpper: Infinity },
  ])("blocks invalid manager settings %j", (settings) => {
    expect(
      fallbackLaunchPreview(fixture(), { position: { fullRange: false, ...settings } }).blockers,
    ).toContain("EXECUTION_UNAVAILABLE");
  });
  it("keeps missing leaf budgets and partial panel configs fail closed", () => {
    const draft = fixture();
    const chain = draft.plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps.push({ ...chain.steps[0], id: "second" } as (typeof chain.steps)[number]);
    expect(fallbackLaunchPreview(draft, {}).blockers).toContain("BUILD_EXECUTION_GAP");
    chain.steps.pop();
    if (chain.steps[0]) chain.steps[0].config = { poolId };
    expect(fallbackLaunchPreview(draft, {}).blockers).toContain("EXECUTION_UNAVAILABLE");
  });
});
