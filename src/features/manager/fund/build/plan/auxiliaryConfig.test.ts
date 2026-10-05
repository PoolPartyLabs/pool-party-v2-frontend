/** @id PP-MGR-LIB-057 @implements-rules-version v1 (POO-2237)
 * @analytics-events none, pure rule regression tests. */
import { describe, expect, it } from "vitest";
import { tokenKey } from "../../mandateDraft";
import {
  applyPanelConfig,
  manualSwapTokens,
  spokeAllocationBounds,
  validManualSwapConfig,
} from "./auxiliaryConfig";
import { isPlanBlocked } from "./buildPlan";
import { normalizePlan } from "./planStorage";
import {
  emptySpokePlan,
  hubPoolPlan,
  makeTestContext,
  makeTestDraft,
  spokePoolPlan,
  TEST_ASSET_KEYS,
} from "./planTestKit";

const config = {
  tokenInKey: TEST_ASSET_KEYS.usdcArbitrum,
  tokenOutKey: TEST_ASSET_KEYS.wethArbitrum,
  slippagePct: 2,
};
describe("POO-2237 configuration boundaries", () => {
  it("offers only mandate tokens from the block network, with canonical keys and logos", () => {
    const draft = makeTestDraft();
    expect(manualSwapTokens(draft, "arbitrum").map(tokenKey)).toEqual([
      config.tokenInKey,
      config.tokenOutKey,
    ]);
    expect(manualSwapTokens({ ...draft, networks: ["robinhood"] }, "arbitrum")).toEqual([]);
  });
  it("rejects identical, cross-network, missing and out-of-range token configurations", () => {
    const draft = makeTestDraft();
    expect(validManualSwapConfig(config, draft, "arbitrum")).toBe(true);
    for (const value of [
      { ...config, tokenOutKey: config.tokenInKey },
      { ...config, tokenOutKey: TEST_ASSET_KEYS.wethRobinhood },
      { ...config, tokenOutKey: "" },
      { ...config, slippagePct: 5.1 },
      { ...config, slippagePct: Number.NaN },
    ])
      expect(validManualSwapConfig(value, draft, "arbitrum")).toBe(false);
  });
  it("persists a manual Swap and never edits app-owned conversion blocks", () => {
    const plan = hubPoolPlan();
    const swap = plan.hub.chains[0]?.steps[0];
    if (swap?.family !== "flow") throw new Error("Expected swap");
    expect(isPlanBlocked(applyPanelConfig(plan, makeTestContext(), swap.id, config))).toBe(true);
    swap.auto = false;
    const original = structuredClone(plan);
    const next = applyPanelConfig(plan, makeTestContext(), swap.id, {
      ...config,
      tokenOutKey: config.tokenOutKey.toUpperCase(),
    });
    expect(isPlanBlocked(next)).toBe(false);
    if (isPlanBlocked(next)) throw new Error("Expected configured plan");
    expect(next.hub.chains[0]?.steps[0]).toMatchObject({ config });
    expect(normalizePlan(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(plan).toEqual(original);
  });
  it("keeps spoke allocation above children and within mandate/root caps without scaling children", () => {
    const ctx = makeTestContext();
    const plan = spokePoolPlan();
    expect(spokeAllocationBounds(plan, ctx.draft, "robinhood")).toEqual({ min: 40, max: 50 });
    for (const share of [0, 39, 51, Number.NaN]) {
      expect(
        isPlanBlocked(applyPanelConfig(plan, ctx, "spoke:robinhood", { spoke: true }, share)),
      ).toBe(true);
    }
    const next = applyPanelConfig(plan, ctx, "spoke:robinhood", { spoke: true }, 50);
    if (isPlanBlocked(next)) throw new Error("Expected allocated plan");
    expect(next.spokes[0]?.sharePct).toBe(50);
    expect(next.spokes[0]?.chains).toEqual(plan.spokes[0]?.chains);
    expect(
      spokeAllocationBounds({ ...plan, hub: hubPoolPlan().hub }, ctx.draft, "robinhood"),
    ).toEqual({ min: 40, max: 40 });
    const empty = applyPanelConfig(emptySpokePlan(), ctx, "spoke:robinhood", { spoke: true }, 0);
    expect(isPlanBlocked(empty)).toBe(false);
  });
});
