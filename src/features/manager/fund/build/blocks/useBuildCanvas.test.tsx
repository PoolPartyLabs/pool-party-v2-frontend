/**
 * @id PP-MGR-HOK-010
 * @name useBuildCanvas tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events the controller reports through `onEvent` only; these tests read that stream
 *
 * The controller of the Build canvas (slice S5, POO-2155): it turns a press on a target, a menu
 * choice, a palette drop, a key and Remove block into the S1 reducers, keeps the selection (with
 * its guard), the open menu and the remove confirm (POO-2187, P10, DP11), and reports what happened
 * through `onEvent`. Insert and remove start from the S1 `planTestKit` plans, whose blocks are
 * configured: a block the manager adds has no port in this batch (C17). Mounted on the real draft
 * hook, as the Build screen mounts it.
 */
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import enManager from "@/i18n/messages/en/manager.json";
import type { MandateDraft } from "../../mandateDraft";
import { upsertDraft } from "../../mandateDraftStore";
import { useMandateDraft } from "../../useMandateDraft";
import { type GraphTarget, targetKey } from "../layout/graphTypes";
import type { BuildPlan } from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import {
  emptySpokePlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestDraft,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_POOL_IDS,
} from "../plan/planTestKit";
import { useBuildPlan } from "../plan/useBuildPlan";
import { BuildPalette } from "./BuildPalette";
import { type SelectionGuard, useBlockSelection } from "./useBlockSelection";
import {
  type BuildCanvasController,
  type BuildCanvasEvent,
  useBuildCanvas,
} from "./useBuildCanvas";

/** One messages object, as the app has: a new one per render would hand out a new translator. */
const MESSAGES = { manager: enManager };

function WithMessages({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}

interface HarnessOptions {
  /** The panel's draft reset, run right before a confirmed remove (POO-2187). */
  beforeRemove?: () => void;
}

/** The draft hook, the plan hook, the selection and the controller, as S7 will mount them. */
function useHarness(draftId: string, options: HarnessOptions, events: BuildCanvasEvent[]) {
  const mandate = useMandateDraft(draftId);
  const buildPlan = useBuildPlan({
    draft: mandate.draft,
    catalog: mandate.catalog,
    update: mandate.update,
  });
  const selection = useBlockSelection();
  const onEditMandate = editMandateSpy;
  const canvas = useBuildCanvas({
    draft: mandate.draft,
    catalog: mandate.catalog,
    buildPlan,
    selection,
    onEvent: (event) => events.push(event),
    onEditMandate,
    beforeRemove: options.beforeRemove,
  });
  return { mandate, buildPlan, selection, canvas };
}

const editMandateSpy = vi.fn();

function seed(plan: BuildPlan, over: Partial<MandateDraft> = {}): string {
  const stored = upsertDraft({ ...makeTestDraft(), ...over, plan });
  if (!stored) throw new Error("fixture: seed write failed");
  return stored.id;
}

async function mount(
  plan: BuildPlan,
  over: Partial<MandateDraft> = {},
  options: HarnessOptions = {},
) {
  const events: BuildCanvasEvent[] = [];
  const id = seed(plan, over);
  const hook = renderHook(() => useHarness(id, options, events), { wrapper: WithMessages });
  await waitFor(() => expect(hook.result.current.mandate.hydrated).toBe(true));
  return { ...hook, events };
}

function anchor(): HTMLElement {
  const button = document.createElement("button");
  document.body.append(button);
  return button;
}

function press(result: { current: { canvas: BuildCanvasController } }, target: GraphTarget) {
  act(() => {
    result.current.canvas.onTarget(target, anchor());
  });
}

function choose(result: { current: { canvas: BuildCanvasController } }, optionId: string) {
  const option = result.current.canvas.openMenu?.model.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`no option ${optionId}`);
  act(() => {
    result.current.canvas.chooseOption(option);
  });
}

/** A guard that refuses every change, as the panel will while it holds unapplied changes. */
function vetoing(): SelectionGuard & {
  allowChange: Mock<(next: string | null) => boolean>;
  onRefused: Mock<() => void>;
} {
  return { allowChange: vi.fn((_next: string | null) => false), onRefused: vi.fn() };
}

beforeEach(() => {
  window.localStorage.clear();
  editMandateSpy.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("useBuildCanvas: Add protocol (I1)", () => {
  it("opens the menu of the row it was pressed on, and lights that template", async () => {
    // @rule I1
    const { result } = await mount(hubSupplyPlan());
    const target: GraphTarget = { kind: "addProtocol", network: "arbitrum" };
    press(result, target);
    expect(result.current.canvas.openMenu?.model.title).toBe("Protocols on Arbitrum");
    expect(result.current.canvas.activeTargetKeys.has(targetKey(target))).toBe(true);
  });

  it("closes the menu when its template is pressed again", async () => {
    // @rule I1
    const { result } = await mount(hubSupplyPlan());
    const target: GraphTarget = { kind: "addProtocol", network: "arbitrum" };
    press(result, target);
    press(result, target);
    expect(result.current.canvas.openMenu).toBeNull();
  });

  it("adds a chain at the row's right end with the empty block, selects it and closes the menu", async () => {
    // @rule I1
    // @rule G6
    // @rule ST5
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "addProtocol", network: "arbitrum" });
    choose(result, "addChain:arbitrum:uniswapV4Pool");
    const chains = result.current.buildPlan.plan.hub.chains;
    expect(chains).toHaveLength(2);
    expect(chains[0]?.id).toBe("hub-supply");
    const steps = chains[1]?.steps ?? [];
    expect(steps.map((s) => s.kind)).toEqual(["swap", "uniswapV4Pool"]);
    const pool = steps[1];
    expect(pool?.family === "position" && pool.config).toBeNull();
    expect(result.current.selection.selectedId).toBe(pool?.id);
    expect(result.current.canvas.describeBlock(pool?.id ?? "").state).toBe("empty");
    expect(result.current.canvas.openMenu).toBeNull();
    expect(events).toEqual([
      { type: "blockAdded", kind: "uniswapV4Pool", network: "arbitrum", via: "template" },
    ]);
  });

  it("reports a disabled option as blocked with its reason, adds nothing and keeps the menu", async () => {
    // @rule I1
    // @rule C14
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "addProtocol", network: "arbitrum" });
    choose(result, "addChain:arbitrum:aaveBorrow");
    choose(result, "addChain:arbitrum:pendle");
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
    expect(events).toEqual([
      { type: "blocked", reason: "borrow_needs_supply" },
      { type: "blocked", reason: "coming_soon" },
    ]);
    expect(result.current.canvas.openMenu).not.toBeNull();
  });

  it("tells the panel where the block lands while the menu is open", async () => {
    // @rule AN10
    const { result } = await mount(hubSupplyPlan());
    expect(result.current.canvas.menuSentence).toBeNull();
    press(result, { kind: "addProtocol", network: "arbitrum" });
    expect(result.current.canvas.menuSentence).toBe(
      "Choose a protocol in the menu. The block is added on Arbitrum and opens here.",
    );
  });
});

describe("useBuildCanvas: Add network (I2, I7)", () => {
  it("adds the chosen network as a spoke and reports it", async () => {
    // @rule I2
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "addNetwork" });
    choose(result, "addSpoke:robinhood");
    expect(result.current.buildPlan.plan.spokes).toEqual([
      { network: "robinhood", sharePct: 0, chains: [] },
    ]);
    expect(events).toEqual([{ type: "networkAdded", network: "robinhood" }]);
    expect(result.current.canvas.openMenu).toBeNull();
  });

  it("still opens with no network left, footer and link only, and reports no_network_left", async () => {
    // @rule I2
    // @rule D4
    const { result, events } = await mount(emptySpokePlan());
    press(result, { kind: "addNetwork" });
    expect(result.current.canvas.openMenu?.model.options).toEqual([]);
    expect(result.current.canvas.openMenu?.model.footer).toBe(
      "Robinhood Chain is already on the canvas.",
    );
    expect(events).toEqual([{ type: "blocked", reason: "no_network_left" }]);
  });

  it("removes a spoke with no chain from its chip, and refuses one with chains", async () => {
    // @rule I7
    // @rule D5
    const empty = await mount(emptySpokePlan());
    act(() => empty.result.current.canvas.removeSpoke("robinhood"));
    expect(empty.result.current.buildPlan.plan).toEqual(emptySpokePlan());
    act(() => empty.result.current.canvas.cancelRemove());
    expect(empty.result.current.buildPlan.plan).toEqual(emptySpokePlan());
    act(() => empty.result.current.canvas.removeSpoke("robinhood"));
    act(() => empty.result.current.canvas.confirmRemove());
    expect(empty.result.current.buildPlan.plan.spokes).toEqual([]);
    expect(empty.events).toEqual([{ type: "networkRemoved", network: "robinhood" }]);

    const full = await mount(spokePoolPlan());
    act(() => full.result.current.canvas.removeSpoke("robinhood"));
    act(() => full.result.current.canvas.confirmRemove());
    expect(full.result.current.buildPlan.plan).toEqual(spokePoolPlan());
    expect(full.events).toEqual([{ type: "blocked", reason: "spoke_not_empty" }]);
  });

  it("tells the panel what the Add network menu adds while it is open", async () => {
    // @rule AN10
    // Review F3 of PR #36: coordinator copy, waiting for the product owner.
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "addNetwork" });
    expect(result.current.canvas.menuSentence).toBe(
      "Choose a network in the menu. The network is added to the canvas with its bridge.",
    );
  });
});

describe("useBuildCanvas: insert ports (I4)", () => {
  it("opens the port menu titled by its card and inserts a Borrow, selected, as a block added at a port", async () => {
    // @rule I4
    // @rule G6
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "port", side: "after", blockId: "hub-supply-supply" });
    expect(result.current.canvas.openMenu?.model.title).toBe("After Supply USDC");
    expect(result.current.canvas.menuSentence).toBe(
      "Choose what comes after Supply USDC. A Borrow block uses that supply as its collateral.",
    );
    choose(result, "insert:after:hub-supply-supply:aaveBorrow");
    const steps = result.current.buildPlan.plan.hub.chains[0]?.steps ?? [];
    expect(steps.map((s) => s.kind)).toEqual(["aaveSupply", "aaveBorrow"]);
    expect(result.current.selection.selectedId).toBe(steps[1]?.id);
    expect(events).toEqual([
      { type: "blockAdded", kind: "aaveBorrow", network: "arbitrum", via: "port" },
    ]);
  });

  it("inserts a flow block and reports it as flowInserted with its slot", async () => {
    // @rule I4
    const { result, events } = await mount(hubPoolPlan());
    press(result, { kind: "port", side: "after", blockId: "hub-pool-pool" });
    choose(result, "insert:after:hub-pool-pool:collectFees");
    const steps = result.current.buildPlan.plan.hub.chains[0]?.steps ?? [];
    expect(steps.map((s) => [s.family, s.kind])).toEqual([
      ["flow", "swap"],
      ["position", "uniswapV4Pool"],
      ["flow", "collectFees"],
    ]);
    expect(result.current.selection.selectedId).toBeNull();
    expect(events).toEqual([{ type: "flowInserted", kind: "collectFees", slot: "after" }]);
  });

  it("does not open a port that offers nothing, and reports slot_not_allowed", async () => {
    // @rule I4
    // @rule D1
    const { result, events } = await mount(hubPoolPlan());
    press(result, { kind: "port", side: "before", blockId: "hub-pool-pool" });
    expect(result.current.canvas.openMenu).toBeNull();
    expect(events).toEqual([{ type: "blocked", reason: "slot_not_allowed" }]);
  });
});

describe("useBuildCanvas: selection (I5, HU3)", () => {
  it("selects user-added Swap for configuration (POO-2237)", async () => {
    const plan = hubPoolPlan();
    const swap = plan.hub.chains[0]?.steps[0];
    if (swap?.family !== "flow") throw new Error("Expected swap");
    swap.auto = false;
    const { result } = await mount(plan);
    press(result, { kind: "block", blockId: swap.id });
    expect(result.current.selection.selectedId).toBe(swap.id);
  });
  it("clears a selected spoke only after confirmed removal (POO-2237)", async () => {
    const beforeRemove = vi.fn();
    const { result } = await mount(emptySpokePlan(), {}, { beforeRemove });
    press(result, { kind: "shareLabel", chainId: null, network: "robinhood", feedsBlockId: null });
    act(() => result.current.canvas.removeSpoke("robinhood"));
    expect(result.current.selection.selectedId).toBe("spoke:robinhood");
    act(() => result.current.canvas.confirmRemove());
    expect(result.current.selection.selectedId).toBeNull();
    expect(beforeRemove).toHaveBeenCalledOnce();
  });

  it("selects a card, a share label's block, and clears on the background", async () => {
    // @rule I5
    const { result } = await mount(hubPoolPlan());
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    expect(result.current.selection.selectedId).toBe("hub-pool-pool");
    act(() => result.current.canvas.onBackgroundClick());
    expect(result.current.selection.selectedId).toBeNull();
    press(result, {
      kind: "shareLabel",
      chainId: "hub-pool",
      network: "arbitrum",
      feedsBlockId: "hub-pool-pool",
    });
    expect(result.current.selection.selectedId).toBe("hub-pool-pool");
    expect(result.current.canvas.menuSentence).toBeNull();
  });

  it("selects spoke allocation but leaves automatic pills uneditable", async () => {
    // @rule D26
    // @rule I5
    const { result } = await mount(spokePoolPlan());
    press(result, { kind: "shareLabel", chainId: null, network: "robinhood", feedsBlockId: null });
    expect(result.current.selection.selectedId).toBe("spoke:robinhood");
    press(result, { kind: "block", blockId: "rh-pool-swap" });
    expect(result.current.selection.selectedId).toBe("spoke:robinhood");
  });

  it("lets a vetoing guard block a card, a share label, the background and leaving", async () => {
    // @rule HU3
    const { result } = await mount(supplyBorrowPlan());
    press(result, { kind: "block", blockId: "hub-aave-supply" });
    const guard = vetoing();
    act(() => {
      result.current.selection.registerGuard(guard);
    });
    press(result, { kind: "block", blockId: "hub-aave-borrow" });
    press(result, {
      kind: "shareLabel",
      chainId: "hub-aave",
      network: "arbitrum",
      feedsBlockId: "hub-aave-borrow",
    });
    act(() => result.current.canvas.onBackgroundClick());
    expect(result.current.selection.selectedId).toBe("hub-aave-supply");
    act(() => result.current.canvas.editMandate("protocols"));
    expect(editMandateSpy).not.toHaveBeenCalled();
    // A card, a share label, the background, the way out: four refusals, four notices.
    expect(guard.onRefused).toHaveBeenCalledTimes(4);
  });

  it("adds a block but keeps the selection when a guard refuses the new one", async () => {
    // @rule HU3
    // @rule I1
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    const guard = vetoing();
    act(() => {
      result.current.selection.registerGuard(guard);
    });
    press(result, { kind: "addProtocol", network: "arbitrum" });
    choose(result, "addChain:arbitrum:aaveSupply");
    expect(result.current.buildPlan.plan.hub.chains).toHaveLength(2);
    expect(result.current.selection.selectedId).toBe("hub-supply-supply");
    expect(guard.onRefused).toHaveBeenCalledTimes(1);
  });

  it("follows the Edit mandate link through the leave guard", async () => {
    // @rule C6
    // @rule A4
    // @rule HU3
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "addNetwork" });
    act(() => result.current.canvas.menuProps.onLink("networks"));
    expect(editMandateSpy).toHaveBeenCalledWith("networks", null);
    expect(result.current.canvas.openMenu).toBeNull();
  });

  it("[finding 19] names the selected block with the panel's Edit mandate steps", async () => {
    // @rule C6
    // @rule P6
    const { result } = await mount(hubPoolPlan());
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    for (const step of ["tokens", "pools", "limits"] as const) {
      act(() => result.current.canvas.editMandate(step));
      expect(editMandateSpy).toHaveBeenLastCalledWith(step, "hub-pool-pool");
    }
  });

  it("[P6] runs a refused Edit mandate link once the guard's resume is called", async () => {
    // @rule P6
    const { result } = await mount(hubPoolPlan());
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    let allow = false;
    let resume: (() => void) | null = null;
    act(() => {
      result.current.selection.registerGuard({
        allowChange: () => allow,
        onRefused: (change) => {
          resume = change.resume;
        },
      });
    });
    act(() => result.current.canvas.editMandate("pools"));
    expect(editMandateSpy).not.toHaveBeenCalled();
    allow = true;
    act(() => (resume as (() => void) | null)?.());
    expect(editMandateSpy).toHaveBeenCalledWith("pools", "hub-pool-pool");
  });
});

describe("useBuildCanvas: remove (I6, P10, DP11)", () => {
  it("[P10] asks first: requestRemove opens the confirm and removes nothing", async () => {
    // @rule P10
    // @rule DP11
    const { result, events } = await mount(hubPoolWithFeesPlan());
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    act(() => result.current.canvas.requestRemove("hub-pool-pool"));
    expect(result.current.canvas.removeConfirmId).toBe("hub-pool-pool");
    expect(result.current.buildPlan.plan).toEqual(hubPoolWithFeesPlan());
    expect(result.current.selection.selectedId).toBe("hub-pool-pool");
    expect(events).toEqual([]);
  });

  it("[I6, P10] the confirm removes with the cascade, clears the selection and counts the cascade", async () => {
    // @rule I6
    // @rule P10
    const beforeRemove = vi.fn();
    const { result, events } = await mount(hubPoolWithFeesPlan(), {}, { beforeRemove });
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    act(() => result.current.canvas.requestRemove("hub-pool-pool"));
    act(() => result.current.canvas.confirmRemove());
    expect(result.current.buildPlan.plan.hub.chains).toEqual([]);
    expect(beforeRemove).toHaveBeenCalledTimes(1);
    expect(result.current.selection.selectedId).toBeNull();
    expect(result.current.canvas.removeConfirmId).toBeNull();
    // Its Swap · auto and its Collect fees went with it.
    expect(events).toEqual([{ type: "blockRemoved", kind: "uniswapV4Pool", cascadeCount: 2 }]);
  });

  it("[P10] Cancel closes the confirm and keeps everything", async () => {
    // @rule P10
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    act(() => result.current.canvas.requestRemove("hub-supply-supply"));
    act(() => result.current.canvas.cancelRemove());
    expect(result.current.canvas.removeConfirmId).toBeNull();
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
    expect(events).toEqual([]);
  });

  it("[POO-2210] a remove request targets the requested block independently of selection", async () => {
    // @rule P10
    const { result } = await mount(supplyBorrowPlan());
    press(result, { kind: "block", blockId: "hub-aave-supply" });
    act(() => result.current.canvas.requestRemove("hub-aave-supply"));
    press(result, { kind: "block", blockId: "hub-aave-borrow" });
    expect(result.current.canvas.removeConfirmId).toBe("hub-aave-supply");
    act(() => result.current.canvas.cancelRemove());
    press(result, { kind: "block", blockId: "hub-aave-supply" });
    expect(result.current.canvas.removeConfirmId).toBeNull();
  });

  it("[POO-2210] removing an unselected leaf preserves the selected block's pending draft", async () => {
    const beforeRemove = vi.fn();
    const { result } = await mount(supplyBorrowPlan(), {}, { beforeRemove });
    press(result, { kind: "block", blockId: "hub-aave-supply" });
    act(() => result.current.canvas.requestRemove("hub-aave-borrow"));
    act(() => result.current.canvas.confirmRemove());
    expect(beforeRemove).not.toHaveBeenCalled();
    expect(result.current.selection.selectedId).toBe("hub-aave-supply");
    expect(
      result.current.buildPlan.plan.hub.chains[0]?.steps.some(
        (step) => step.id === "hub-aave-borrow",
      ),
    ).toBe(false);
  });

  it("removes nothing when a guard still refuses to let the selection go", async () => {
    // @rule HU3
    // @rule I6
    const { result } = await mount(hubPoolPlan());
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    const guard = vetoing();
    act(() => {
      result.current.selection.registerGuard(guard);
    });
    act(() => result.current.canvas.requestRemove("hub-pool-pool"));
    act(() => result.current.canvas.confirmRemove());
    expect(guard.onRefused).toHaveBeenCalled();
    expect(result.current.buildPlan.plan).toEqual(hubPoolPlan());
  });

  it("[DP3] a spoke chain's remove brings the spoke's share down with it", async () => {
    // @rule DP3
    // @rule I6
    const { result, events } = await mount(spokePoolPlan());
    press(result, { kind: "block", blockId: "rh-pool-pool" });
    act(() => result.current.canvas.requestRemove("rh-pool-pool"));
    act(() => result.current.canvas.confirmRemove());
    expect(result.current.buildPlan.plan.spokes).toEqual([
      { network: "robinhood", sharePct: 0, chains: [] },
    ]);
    expect(events).toEqual([{ type: "blockRemoved", kind: "uniswapV4Pool", cascadeCount: 1 }]);
  });

  it("[DP3] removing the last block of one spoke chain leaves the spoke at its other chains' sum", async () => {
    // @rule DP3
    // @rule I6
    const chain = (id: string, sharePct: number) => ({
      id,
      sharePct,
      steps: [
        { id: `${id}-swap`, family: "flow" as const, kind: "swap" as const, auto: true },
        {
          id: `${id}-pool`,
          family: "position" as const,
          kind: "uniswapV4Pool" as const,
          config: { poolId: TEST_POOL_IDS.robinhood },
        },
      ],
    });
    const plan: BuildPlan = {
      version: 1,
      hub: { chains: [] },
      spokes: [
        { network: "robinhood", sharePct: 35, chains: [chain("rh-a", 20), chain("rh-b", 15)] },
      ],
    };
    const { result } = await mount(plan);
    press(result, { kind: "block", blockId: "rh-a-pool" });
    act(() =>
      result.current.canvas.onKeyDown({
        key: "Delete",
        target: document.body,
        preventDefault() {},
      }),
    );
    act(() => result.current.canvas.confirmRemove());
    const spoke = result.current.buildPlan.plan.spokes[0];
    expect(spoke?.chains.map((c) => c.id)).toEqual(["rh-b"]);
    // The released share goes back to Idle input: the spoke holds exactly what its chains hold.
    expect(spoke?.sharePct).toBe(15);
  });

  it("refuses to remove an app-owned Swap · auto on its own", async () => {
    // @rule I6
    const { result, events } = await mount(hubPoolPlan());
    act(() => result.current.canvas.requestRemove("hub-pool-swap"));
    await waitFor(() => expect(events).toEqual([{ type: "blocked", reason: "auto_owned" }]));
    expect(result.current.buildPlan.plan).toEqual(hubPoolPlan());
  });
});

describe("useBuildCanvas: keyboard (I10)", () => {
  function key(
    key: string,
    target: EventTarget | null = document.body,
    modifiers: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
  ) {
    return { key, target, preventDefault: vi.fn(), ...modifiers };
  }

  it.each([
    "Delete",
    // Review F1 of PR #36: a Mac keyboard's delete key sends Backspace.
    "Backspace",
  ])("[DP11] opens the remove confirm of the selected block on %s", async (name) => {
    // @rule I10
    // @rule DP11
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    const event = key(name);
    act(() => result.current.canvas.onKeyDown(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.canvas.removeConfirmId).toBe("hub-supply-supply");
    // Nothing is removed until the confirm says so.
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
    expect(events).toEqual([]);
  });

  it("[L3] Delete on a focused panel control does not ask to remove the block", async () => {
    // @rule I10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    const slot = document.createElement("section");
    slot.setAttribute("data-build-panel-slot", "");
    const slider = document.createElement("div");
    slot.append(slider);
    document.body.append(slot);
    for (const name of ["Delete", "Backspace"]) {
      const event = key(name, slider);
      act(() => result.current.canvas.onKeyDown(event));
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(result.current.canvas.removeConfirmId).toBeNull();
  });

  it("[P10] Escape closes an open remove confirm", async () => {
    // @rule P10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    act(() => result.current.canvas.onKeyDown(key("Delete")));
    const escapeKey = key("Escape");
    act(() => result.current.canvas.onKeyDown(escapeKey));
    expect(escapeKey.preventDefault).toHaveBeenCalled();
    expect(result.current.canvas.removeConfirmId).toBeNull();
  });

  it.each([
    "Delete",
    "Backspace",
  ])("leaves %s alone in a text field and with nothing selected", async (name) => {
    // @rule I10
    const { result } = await mount(hubSupplyPlan());
    const nothing = key(name);
    act(() => result.current.canvas.onKeyDown(nothing));
    expect(nothing.preventDefault).not.toHaveBeenCalled();
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    // The attribute, as markup sets it (jsdom does not reflect the `contentEditable` property).
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, textarea, editable);
    for (const target of [input, textarea, editable]) {
      const typing = key(name, target);
      act(() => result.current.canvas.onKeyDown(typing));
      // The key is never claimed, so the field edits its text as usual.
      expect(typing.preventDefault).not.toHaveBeenCalled();
    }
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
    expect(result.current.selection.selectedId).toBe("hub-supply-supply");
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
  ])("ignores Backspace and Delete pressed with a modifier (%o)", async (modifier) => {
    // @rule I10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    for (const name of ["Delete", "Backspace"]) {
      const event = key(name, document.body, modifier);
      act(() => result.current.canvas.onKeyDown(event));
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
  });

  it("ignores Backspace while a menu is open", async () => {
    // @rule I10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    press(result, { kind: "addProtocol", network: "arbitrum" });
    const event = key("Backspace");
    act(() => result.current.canvas.onKeyDown(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
  });

  it("closes an open menu on Escape", async () => {
    // @rule I10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "addProtocol", network: "arbitrum" });
    const event = key("Escape");
    act(() => result.current.canvas.onKeyDown(event));
    expect(result.current.canvas.openMenu).toBeNull();
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("useBuildCanvas: palette drag (I3)", () => {
  it("lights exactly the valid targets of the dragged kind, and none after the drag", async () => {
    // @rule I3
    // @rule ST10
    const { result } = await mount(emptySpokePlan());
    act(() =>
      result.current.canvas.paletteProps.onDragStart({ family: "position", kind: "uniswapV4Pool" }),
    );
    expect([...result.current.canvas.activeTargetKeys].sort()).toEqual(
      [
        targetKey({ kind: "addProtocol", network: "arbitrum" }),
        targetKey({ kind: "addProtocol", network: "robinhood" }),
      ].sort(),
    );
    act(() => result.current.canvas.paletteProps.onDragCancel());
    expect(result.current.canvas.activeTargetKeys.size).toBe(0);
  });

  it("applies the menu's reducer for a drop on an active key, with via palette", async () => {
    // @rule I3
    const { result, events } = await mount(hubSupplyPlan());
    const item = { family: "position", kind: "aaveBorrow" } as const;
    act(() => result.current.canvas.paletteProps.onDragStart(item));
    const key = targetKey({ kind: "port", side: "after", blockId: "hub-supply-supply" });
    expect(result.current.canvas.activeTargetKeys.has(key)).toBe(true);
    act(() => result.current.canvas.paletteProps.onDrop(item, key));
    const steps = result.current.buildPlan.plan.hub.chains[0]?.steps ?? [];
    expect(steps.map((s) => s.kind)).toEqual(["aaveSupply", "aaveBorrow"]);
    expect(events).toEqual([
      { type: "blockAdded", kind: "aaveBorrow", network: "arbitrum", via: "palette" },
    ]);
    expect(result.current.canvas.activeTargetKeys.size).toBe(0);
  });

  it("does nothing for a drop on a key that is not a valid target, or on no target", async () => {
    // @rule I3
    const { result, events } = await mount(hubSupplyPlan());
    const item = { family: "flow", kind: "collectFees" } as const;
    act(() => result.current.canvas.paletteProps.onDragStart(item));
    act(() => result.current.canvas.paletteProps.onDrop(item, targetKey({ kind: "addNetwork" })));
    act(() => result.current.canvas.paletteProps.onDragStart(item));
    act(() => result.current.canvas.paletteProps.onDrop(item, null));
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
    expect(events).toEqual([]);
  });

  /** The palette and a stand-in graph target, wired to the controller as S7 will wire them. */
  function DragHarness({ draftId, events }: { draftId: string; events: BuildCanvasEvent[] }) {
    const { canvas, buildPlan } = useHarness(draftId, {}, events);
    return (
      <>
        <BuildPalette {...canvas.paletteProps} />
        <div
          data-testid="target"
          data-graph-target={targetKey({ kind: "addProtocol", network: "arbitrum" })}
        />
        <div data-testid="elsewhere" />
        <output data-testid="chains">{buildPlan.plan.hub.chains.length}</output>
      </>
    );
  }

  it("drops through elementFromPoint: on an active target the reducer runs, elsewhere nothing", async () => {
    // @rule I3
    const events: BuildCanvasEvent[] = [];
    const draftId = seed(hubSupplyPlan());
    const original = document.elementFromPoint;
    let under: Element | null = null;
    document.elementFromPoint = vi.fn(() => under);
    try {
      const view = render(
        <WithMessages>
          <DragHarness draftId={draftId} events={events} />
        </WithMessages>,
      );
      await waitFor(() => expect(view.getByTestId("chains").textContent).toBe("1"));
      const card = view.container.querySelector<HTMLElement>('[data-palette-item="aaveSupply"]');
      if (!card) throw new Error("no Supply card");
      const drag = (to: Element) => {
        under = to;
        fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 200 });
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 200 });
      };
      drag(view.getByTestId("elsewhere"));
      expect(view.getByTestId("chains").textContent).toBe("1");
      drag(view.getByTestId("target"));
      expect(view.getByTestId("chains").textContent).toBe("2");
      expect(events).toEqual([
        { type: "blockAdded", kind: "aaveSupply", network: "arbitrum", via: "palette" },
      ]);
    } finally {
      document.elementFromPoint = original;
    }
  });
});

describe("useBuildCanvas: content", () => {
  it("describes cards and pills from the current plan", async () => {
    // @rule HU2
    const { result } = await mount(hubPoolPlan());
    expect(result.current.canvas.describeBlock("hub-pool-pool").title).toBe("WETH / USDC");
    expect(result.current.canvas.describeFlow("hub-pool-swap").text).toBe("Swap · auto");
    expect(result.current.canvas.networkName("robinhood")).toBe("Robinhood Chain");
  });

  it("keeps describeBlock, describeFlow and networkName stable until the plan changes", async () => {
    // @rule HU2
    // Review F5 of PR #36: the renderer memoises on these identities.
    const { result, rerender } = await mount(hubPoolPlan());
    const first = result.current.canvas;
    rerender();
    expect(result.current.canvas.describeBlock).toBe(first.describeBlock);
    expect(result.current.canvas.describeFlow).toBe(first.describeFlow);
    expect(result.current.canvas.networkName).toBe(first.networkName);
    expect(result.current.canvas.onTarget).toBe(first.onTarget);
    press(result, { kind: "port", side: "after", blockId: "hub-pool-pool" });
    choose(result, "insert:after:hub-pool-pool:collectFees");
    expect(result.current.canvas.describeBlock).not.toBe(first.describeBlock);
    expect(result.current.canvas.describeFlow).not.toBe(first.describeFlow);
  });

  it("hands the palette the mandate's model", async () => {
    // @rule AN8
    const { result } = await mount(hubPoolPlan());
    expect(result.current.canvas.paletteProps.model.sections.map((s) => s.id)).toEqual([
      "mandate",
      "flow",
      "comingSoon",
    ]);
  });

  it("leaves nothing selected once the selected block is removed", async () => {
    // @rule AN10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    act(() => result.current.canvas.requestRemove("hub-supply-supply"));
    act(() => result.current.canvas.confirmRemove());
    expect(result.current.selection.selectedId).toBeNull();
    expect(findBlock(result.current.buildPlan.plan, "hub-supply-supply")).toBeNull();
  });
});
