/**
 * @id PP-MGR-HOK-014
 * @name usePanelDraft tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, the hook reports through `onEvent` only; these tests read that stream
 *
 * The panel's draft (handoff P3, P5, P6, P7; decision DP1), mounted on the real plan hook and the
 * real selection, over an in-memory mandate draft: the draft against applied by value, Use with the
 * kind's defaults at 0%, Apply changes and Discard, the guard and its resume (finding 10), and the
 * quiet reset the remove confirm uses.
 */
import { act, renderHook } from "@testing-library/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { isBlocked, type MandateDraft } from "../../mandateDraft";
import type { UseMandateDraftResult } from "../../useMandateDraft";
import { TEST_CATALOG } from "../blocks/blockTestKit";
import { useBlockSelection } from "../blocks/useBlockSelection";
import type { BuildPlan } from "../plan/buildPlan";
import {
  completePoolConfig,
  hubPoolPlan,
  makeTestDraft,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
  withCompletePools,
} from "../plan/planTestKit";
import { useBuildPlan } from "../plan/useBuildPlan";
import {
  changedFields,
  type PanelDraftEvent,
  panelTarget,
  samePanelValues,
  usePanelDraft,
} from "./usePanelDraft";

/** The plan hook, the selection and the panel draft over an in-memory mandate draft. */
function useHarness(plan: BuildPlan, selected: string | null, events: PanelDraftEvent[]) {
  const [draft, setDraft] = useState<MandateDraft>(() => ({ ...makeTestDraft(), plan }));
  const ref = useRef(draft);
  const update = useCallback<UseMandateDraftResult["update"]>((fn) => {
    const next = fn(ref.current);
    if (isBlocked(next)) return;
    ref.current = next;
    setDraft(next);
  }, []);
  const buildPlan = useBuildPlan({ draft, catalog: TEST_CATALOG, update });
  const selection = useBlockSelection(selected);
  const target = useMemo(
    () => panelTarget(buildPlan.plan, selection.selectedId),
    [buildPlan.plan, selection.selectedId],
  );
  const panel = usePanelDraft({
    target,
    registerGuard: selection.registerGuard,
    applyBlockConfig: buildPlan.applyBlockConfig,
    onEvent: (event) => events.push(event),
  });
  return { plan: buildPlan.plan, selection, panel };
}

function mount(plan: BuildPlan, selected: string | null = null) {
  const events: PanelDraftEvent[] = [];
  const hook = renderHook(() => useHarness(plan, selected, events));
  return { ...hook, events };
}

/** The hub pool plan with a complete config, so it reads as Mode 4. */
function completePoolPlan(): BuildPlan {
  return withCompletePools(hubPoolPlan());
}

/** A hub chain holding one empty pool at 0%, as Add protocol leaves it. */
function emptyPoolPlan(): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [
        {
          id: "c",
          sharePct: 0,
          steps: [
            { id: "s", family: "flow", kind: "swap", auto: true },
            { id: "b", family: "position", kind: "uniswapV4Pool", config: null },
          ],
        },
      ],
    },
    spokes: [],
  };
}

describe("panelTarget: what the panel edits (P8)", () => {
  it("reads the config and the chain's share for the chain's first position", () => {
    // @rule P8
    expect(panelTarget(completePoolPlan(), "hub-pool-pool")).toEqual({
      blockId: "hub-pool-pool",
      kind: "uniswapV4Pool",
      network: "arbitrum",
      applied: { config: completePoolConfig(TEST_POOL_IDS.arbitrum), sharePct: 60 },
    });
  });

  it("gives a block further down its chain no share of its own", () => {
    // @rule P8
    expect(panelTarget(supplyBorrowPlan(), "hub-aave-borrow")?.applied.sharePct).toBeNull();
    expect(panelTarget(supplyBorrowPlan(), "hub-aave-supply")?.applied.sharePct).toBe(50);
  });

  it("is null for nothing, a pill or an unknown id", () => {
    expect(panelTarget(completePoolPlan(), null)).toBeNull();
    expect(panelTarget(completePoolPlan(), "hub-pool-swap")).toBeNull();
    expect(panelTarget(completePoolPlan(), "nope")).toBeNull();
  });
});

describe("samePanelValues and changedFields (P5)", () => {
  it("compares by value and names the fields an Apply changes, in a fixed order", () => {
    // @rule P5
    const config = completePoolConfig(TEST_POOL_IDS.arbitrum);
    const applied = { config, sharePct: 60 };
    expect(samePanelValues(applied, { config: { ...config }, sharePct: 60 })).toBe(true);
    expect(samePanelValues(applied, { config, sharePct: 55 })).toBe(false);
    expect(
      changedFields(applied, {
        config: { ...config, tickLower: (config.tickLower ?? 0) - 10, slippagePct: 1 },
        sharePct: 50,
      }),
    ).toEqual(["range", "slippage", "allocation"]);
    expect(
      changedFields(
        { config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum }, sharePct: 40 },
        { config: { assetKey: TEST_ASSET_KEYS.wethArbitrum }, sharePct: 40 },
      ),
    ).toEqual(["asset"]);
  });
});

describe("usePanelDraft: the draft (P3, P5)", () => {
  it("[P3] starts from the applied values and leaves the plan alone while it is edited", () => {
    // @rule P3
    const { result } = mount(completePoolPlan(), "hub-pool-pool");
    expect(result.current.panel.draft).toEqual(result.current.panel.applied);
    expect(result.current.panel.dirty).toBe(false);
    act(() => result.current.panel.setShare(45));
    expect(result.current.panel.draft?.sharePct).toBe(45);
    expect(result.current.panel.dirty).toBe(true);
    expect(result.current.plan.hub.chains[0]?.sharePct).toBe(60);
  });

  it("[P5] is not dirty once the values are back to the applied ones", () => {
    // @rule P5
    const { result } = mount(completePoolPlan(), "hub-pool-pool");
    act(() => result.current.panel.setShare(45));
    act(() => result.current.panel.setShare(60));
    expect(result.current.panel.dirty).toBe(false);
  });

  it("[P5] Apply changes writes the draft and reports the fields it changed", () => {
    // @rule P5
    const { result, events } = mount(completePoolPlan(), "hub-pool-pool");
    const config = completePoolConfig(TEST_POOL_IDS.arbitrum);
    act(() => result.current.panel.setShare(45));
    act(() => result.current.panel.setConfig({ ...config, slippagePct: 0.5 }));
    let ok = false;
    act(() => {
      ok = result.current.panel.apply();
    });
    expect(ok).toBe(true);
    expect(result.current.plan.hub.chains[0]?.sharePct).toBe(45);
    expect(result.current.panel.dirty).toBe(false);
    expect(events).toEqual([
      { type: "applied", kind: "uniswapV4Pool", fields: ["slippage", "allocation"] },
    ]);
  });

  it("[P5] Discard drops the draft and reports it", () => {
    // @rule P5
    const { result, events } = mount(completePoolPlan(), "hub-pool-pool");
    act(() => result.current.panel.setShare(45));
    act(() => result.current.panel.discard());
    expect(result.current.panel.draft?.sharePct).toBe(60);
    expect(events).toEqual([{ type: "discarded", kind: "uniswapV4Pool" }]);
  });

  it("[P4] a refused Apply keeps the draft and reports the reducer's reason", () => {
    // @rule P4
    const { result, events } = mount(completePoolPlan(), "hub-pool-pool");
    act(() => result.current.panel.setShare(120));
    act(() => {
      result.current.panel.apply();
    });
    expect(result.current.panel.dirty).toBe(true);
    expect(events).toEqual([{ type: "blocked", reason: "share_exceeds_parent" }]);
  });
});

describe("usePanelDraft: Use (P7, DP1)", () => {
  it("[DP1] writes the kind's defaults as applied with a share of 0%, and reports configured", () => {
    // @rule P7
    // @rule DP1
    const { result, events } = mount(emptyPoolPlan(), "b");
    const config = completePoolConfig(TEST_POOL_IDS.arbitrum);
    act(() => {
      result.current.panel.use(config);
    });
    expect(result.current.panel.applied).toEqual({ config, sharePct: 0 });
    expect(result.current.panel.dirty).toBe(false);
    expect(events).toEqual([{ type: "configured", kind: "uniswapV4Pool", network: "arbitrum" }]);
  });

  it("refuses a pool outside the mandate and reports it", () => {
    // @rule P1
    const { result, events } = mount(emptyPoolPlan(), "b");
    act(() => {
      result.current.panel.use(completePoolConfig("not-in-the-mandate"));
    });
    expect(result.current.panel.applied?.config).toBeNull();
    expect(events).toEqual([{ type: "blocked", reason: "not_in_mandate" }]);
  });
});

describe("usePanelDraft: the guard and its resume (P6, finding 10)", () => {
  it("[P6] refuses another block while dirty, shows the notice, and moves after Apply", () => {
    // @rule P6
    const plan: BuildPlan = {
      version: 1,
      hub: {
        chains: [
          ...completePoolPlan().hub.chains,
          {
            id: "c2",
            sharePct: 10,
            steps: [
              { id: "s2", family: "flow", kind: "swap", auto: true },
              { id: "b2", family: "position", kind: "uniswapV4Pool", config: null },
            ],
          },
        ],
      },
      spokes: [],
    };
    const { result, events } = mount(plan, "hub-pool-pool");
    act(() => result.current.panel.setShare(45));
    let moved = true;
    act(() => {
      moved = result.current.selection.select("b2");
    });
    expect(moved).toBe(false);
    expect(result.current.selection.selectedId).toBe("hub-pool-pool");
    expect(result.current.panel.leaveBlocked).toBe(true);
    expect(result.current.panel.leaveAttempt).toBe(1);
    expect(events).toEqual([{ type: "leaveBlocked", kind: "uniswapV4Pool" }]);

    act(() => {
      result.current.panel.apply();
    });
    // The blocked change ran once the panel settled.
    expect(result.current.selection.selectedId).toBe("b2");
    expect(result.current.plan.hub.chains[0]?.sharePct).toBe(45);
  });

  it("[P6] counts every refusal, so the notice comes back each time", () => {
    // @rule P6
    const { result } = mount(completePoolPlan(), "hub-pool-pool");
    act(() => result.current.panel.setShare(45));
    act(() => result.current.selection.guardLeave(() => {}));
    act(() => result.current.selection.guardLeave(() => {}));
    expect(result.current.panel.leaveAttempt).toBe(2);
  });

  it("[P6] runs a refused way out after Discard changes", () => {
    // @rule P6
    const { result } = mount(completePoolPlan(), "hub-pool-pool");
    let left = 0;
    act(() => result.current.panel.setShare(45));
    act(() =>
      result.current.selection.guardLeave(() => {
        left += 1;
      }),
    );
    expect(left).toBe(0);
    act(() => result.current.panel.discard());
    expect(left).toBe(1);
    expect(result.current.panel.leaveBlocked).toBe(false);
  });

  it("[P6] drops the pending way out when the values go back by hand", () => {
    // @rule P6
    const { result } = mount(completePoolPlan(), "hub-pool-pool");
    let left = 0;
    act(() => result.current.panel.setShare(45));
    act(() =>
      result.current.selection.guardLeave(() => {
        left += 1;
      }),
    );
    act(() => result.current.panel.setShare(60));
    expect(result.current.panel.leaveBlocked).toBe(false);
    act(() => result.current.panel.setShare(50));
    act(() => result.current.panel.discard());
    expect(left).toBe(0);
  });

  it("[P10] reset drops the draft quietly and lets the selection go", () => {
    // @rule P10
    const { result, events } = mount(completePoolPlan(), "hub-pool-pool");
    act(() => result.current.panel.setShare(45));
    let cleared = false;
    act(() => {
      result.current.panel.reset();
      cleared = result.current.selection.select(null);
    });
    expect(cleared).toBe(true);
    expect(events).toEqual([]);
  });

  it("allows every change while nothing differs from applied", () => {
    // @rule P6
    const { result } = mount(completePoolPlan(), "hub-pool-pool");
    let left = false;
    act(() =>
      result.current.selection.guardLeave(() => {
        left = true;
      }),
    );
    expect(left).toBe(true);
    expect(result.current.panel.leaveBlocked).toBe(false);
  });
});
