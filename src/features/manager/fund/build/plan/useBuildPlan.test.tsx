/**
 * @id PP-MGR-HOK-007
 * @name useBuildPlan tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a state hook; the Build screen (S7) owns the canvas events.
 *
 * Covers the Purity rule on the React side (a refusal keeps the previous draft, `apply` reads the
 * CURRENT draft so two applies in one event never use a stale one), G5 (the plan read from the
 * draft) and coordinator default D6 (violations are listed, memoised, never fixed silently).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import { MANDATE_DRAFTS_KEY, upsertDraft } from "../../mandateDraftStore";
import { useMandateDraft } from "../../useMandateDraft";
import { createEmptyPlan } from "./buildPlan";
import { addChain, addSpoke, removeBlock, setChainShare } from "./planReducers";
import { hubPoolPlan, makeTestDraft, spokePoolPlan, TEST_POOL_IDS } from "./planTestKit";
import { useBuildPlan } from "./useBuildPlan";

/** The mandate hook and the plan hook together, as the Build screen will mount them. */
function useHarness(draftId: string) {
  const mandate = useMandateDraft(draftId);
  const build = useBuildPlan({
    draft: mandate.draft,
    catalog: mandate.catalog,
    update: mandate.update,
  });
  return { mandate, build };
}

function seed(over: Partial<MandateDraft> = {}): string {
  const stored = upsertDraft({ ...makeTestDraft(), ...over });
  if (!stored) throw new Error("fixture: seed write failed");
  return stored.id;
}

async function mount(over: Partial<MandateDraft> = {}) {
  const id = seed(over);
  const hook = renderHook(() => useHarness(id));
  await waitFor(() => expect(hook.result.current.mandate.hydrated).toBe(true));
  return hook;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useBuildPlan", () => {
  it("reads the draft's plan, and the empty plan for a draft that has none", async () => {
    // @rule G5
    const { result } = await mount();
    expect(result.current.build.plan).toEqual(createEmptyPlan());
    const { result: withPlan } = await mount({ plan: hubPoolPlan() });
    expect(withPlan.current.build.plan).toEqual(hubPoolPlan());
  });

  it("applies a reducer into the draft and reports ok", async () => {
    // @rule Purity
    const { result } = await mount();
    let outcome: unknown;
    act(() => {
      outcome = result.current.build.apply((plan, ctx) =>
        addChain(plan, ctx, "arbitrum", "aaveSupply"),
      );
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.build.plan.hub.chains).toHaveLength(1);
    expect(result.current.mandate.draft.plan?.hub.chains).toHaveLength(1);
    expect(result.current.mandate.isDirty).toBe(true);
  });

  it("keeps the previous draft, by identity, when a reducer refuses", async () => {
    // @rule Purity
    const { result } = await mount({ plan: hubPoolPlan() });
    const before = result.current.mandate.draft;
    let outcome: unknown;
    act(() => {
      outcome = result.current.build.apply((plan, ctx) => removeBlock(plan, ctx, "hub-pool-swap"));
    });
    expect(outcome).toEqual({
      ok: false,
      blocked: { reason: "auto_owned", targetId: "hub-pool-swap" },
    });
    expect(result.current.mandate.draft).toBe(before);
  });

  it("runs every apply on the current draft, so two in one event both land", async () => {
    // @rule Purity
    const { result } = await mount();
    act(() => {
      const { apply } = result.current.build;
      apply((plan, ctx) => addSpoke(plan, ctx, "robinhood"));
      apply((plan, ctx) => addChain(plan, ctx, "robinhood", "uniswapV4Pool"));
      apply((plan, ctx) => addChain(plan, ctx, "arbitrum", "aaveSupply"));
    });
    const plan = result.current.build.plan;
    expect(plan.spokes.map((spoke) => spoke.network)).toEqual(["robinhood"]);
    expect(plan.spokes[0]?.chains).toHaveLength(1);
    expect(plan.hub.chains).toHaveLength(1);
  });

  it("gives every new block a distinct id", async () => {
    // @rule Purity
    const { result } = await mount();
    act(() => {
      result.current.build.apply((plan, ctx) => addChain(plan, ctx, "arbitrum", "uniswapV4Pool"));
      result.current.build.apply((plan, ctx) => addChain(plan, ctx, "arbitrum", "uniswapV4Pool"));
    });
    const ids = result.current.build.plan.hub.chains.flatMap((chain) => [
      chain.id,
      ...chain.steps.map((step) => step.id),
    ]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("never writes storage: the plan reaches it only through the mandate's save", async () => {
    // @rule Storage
    const { result } = await mount();
    const stored = window.localStorage.getItem(MANDATE_DRAFTS_KEY);
    act(() => {
      result.current.build.apply((plan, ctx) => addChain(plan, ctx, "arbitrum", "aaveSupply"));
    });
    expect(window.localStorage.getItem(MANDATE_DRAFTS_KEY)).toBe(stored);
  });

  it("lists what a loaded plan violates, without changing it (D6)", async () => {
    // @rule INV2
    const { result } = await mount({ plan: hubPoolPlan(), pools: [] });
    expect(result.current.build.violations).toEqual([
      { invariant: 2, code: "config_not_in_mandate", targetId: "hub-pool-pool" },
    ]);
    expect(result.current.build.plan).toEqual(hubPoolPlan());
  });

  it("keeps the same violations list while nothing it depends on changes", async () => {
    // @rule INV1
    const { result, rerender } = await mount({ plan: hubPoolPlan() });
    const first = result.current.build.violations;
    rerender();
    expect(result.current.build.violations).toBe(first);
    act(() => {
      result.current.build.apply((plan, ctx) => setChainShare(plan, ctx, "hub-pool", 30));
    });
    expect(result.current.build.violations).toEqual([]);
  });
});

describe("useBuildPlan.applyBlockConfig: one Apply is one apply (POO-2184, A1)", () => {
  const config = {
    poolId: TEST_POOL_IDS.robinhood,
    tickLower: -199_370,
    tickUpper: -195_370,
    fullRange: false,
    displayInverted: false,
    slippagePct: 2,
  };

  it("[A1, A2] writes the config, the chain's share and the spoke's share in one draft update", async () => {
    // @rule A1
    // @rule A2
    const { result } = await mount({ plan: spokePoolPlan() });
    const before = result.current.mandate.draft;
    let outcome: unknown;
    act(() => {
      outcome = result.current.build.applyBlockConfig("rh-pool-pool", config, 60);
    });
    expect(outcome).toEqual({ ok: true });
    const plan = result.current.build.plan;
    expect(plan.spokes[0]?.sharePct).toBe(60);
    expect(plan.spokes[0]?.chains[0]?.sharePct).toBe(60);
    expect(plan.spokes[0]?.chains[0]?.steps[1]).toMatchObject({ config });
    expect(result.current.mandate.draft).not.toBe(before);
  });

  it("[A1] keeps the previous draft, by identity, when any part of the Apply is refused", async () => {
    // @rule A1
    const { result } = await mount({ plan: spokePoolPlan() });
    const before = result.current.mandate.draft;
    let outcome: unknown;
    act(() => {
      outcome = result.current.build.applyBlockConfig("rh-pool-pool", config, 120);
    });
    expect(outcome).toEqual({
      ok: false,
      blocked: { reason: "share_exceeds_parent", targetId: "robinhood" },
    });
    expect(result.current.mandate.draft).toBe(before);
  });
});
