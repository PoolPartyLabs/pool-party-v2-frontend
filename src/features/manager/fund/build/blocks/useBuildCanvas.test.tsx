/**
 * @id PP-MGR-HOK-010
 * @name useBuildCanvas tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events the controller reports through `onEvent` only; these tests read that stream
 *
 * The controller of the Build canvas (slice S5, POO-2155): it turns a press on a target, a menu
 * choice, a palette drop, a key and Remove block into the S1 reducers, keeps the selection (with
 * its guard) and the open menu, and reports what happened through `onEvent`. Insert and remove
 * start from the S1 `planTestKit` plans, whose blocks are configured: a block the manager adds has
 * no port in this batch (C17). Mounted on the real draft hook, as the Build screen will mount it.
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
} from "../plan/planTestKit";
import { useBuildPlan } from "../plan/useBuildPlan";
import { BuildPalette } from "./BuildPalette";
import { type SelectionGuard, useBlockSelection } from "./useBlockSelection";
import {
  type BuildCanvasController,
  type BuildCanvasEvent,
  useBuildCanvas,
} from "./useBuildCanvas";

const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts.toast }));

function WithMessages({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ manager: enManager }}>
      {children}
    </NextIntlClientProvider>
  );
}

interface HarnessOptions {
  confirmRemove?: (blockId: string) => Promise<boolean>;
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
    confirmRemove: options.confirmRemove,
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
  toasts.toast.mockClear();
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

  it("tells the panel stub where the block lands while the menu is open", async () => {
    // @rule AN10
    const { result } = await mount(hubSupplyPlan());
    expect(result.current.canvas.panelProps.head).toBeNull();
    expect(result.current.canvas.panelProps.body).toMatch(/^Add a protocol or a network/);
    press(result, { kind: "addProtocol", network: "arbitrum" });
    expect(result.current.canvas.panelProps.body).toBe(
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
      "Robinhood Chain are already on the canvas.",
    );
    expect(events).toEqual([{ type: "blocked", reason: "no_network_left" }]);
  });

  it("removes a spoke with no chain from its chip, and refuses one with chains", async () => {
    // @rule I7
    // @rule D5
    const empty = await mount(emptySpokePlan());
    act(() => empty.result.current.canvas.removeSpoke("robinhood"));
    expect(empty.result.current.buildPlan.plan.spokes).toEqual([]);
    expect(empty.events).toEqual([{ type: "networkRemoved", network: "robinhood" }]);

    const full = await mount(spokePoolPlan());
    act(() => full.result.current.canvas.removeSpoke("robinhood"));
    expect(full.result.current.buildPlan.plan).toEqual(spokePoolPlan());
    expect(full.events).toEqual([{ type: "blocked", reason: "spoke_not_empty" }]);
  });

  it("names the close control of a spoke chip", async () => {
    // @rule I7
    const { result } = await mount(emptySpokePlan());
    expect(result.current.canvas.spokeRemoveLabel("robinhood")).toBe("Remove Robinhood Chain");
  });
});

describe("useBuildCanvas: insert ports (I4)", () => {
  it("opens the port menu titled by its card and inserts a Borrow, selected, as a block added at a port", async () => {
    // @rule I4
    // @rule G6
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "port", side: "after", blockId: "hub-supply-supply" });
    expect(result.current.canvas.openMenu?.model.title).toBe("After Supply USDC");
    expect(result.current.canvas.panelProps.body).toBe(
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
    expect(result.current.canvas.panelProps.head?.protocolName).toBe("Uniswap v4");
    expect(result.current.canvas.panelProps.body).toBeNull();
  });

  it("selects nothing from a spoke's share label, or from a pill", async () => {
    // @rule D26
    // @rule I5
    const { result } = await mount(spokePoolPlan());
    press(result, { kind: "shareLabel", chainId: null, network: "robinhood", feedsBlockId: null });
    expect(result.current.selection.selectedId).toBeNull();
    press(result, { kind: "block", blockId: "rh-pool-swap" });
    expect(result.current.selection.selectedId).toBeNull();
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
    expect(editMandateSpy).toHaveBeenCalledWith("networks");
    expect(result.current.canvas.openMenu).toBeNull();
  });
});

describe("useBuildCanvas: remove (I6, HU4)", () => {
  it("removes through confirmRemove, with the cascade, clears the selection and offers Undo", async () => {
    // @rule I6
    // @rule HU4
    // @rule D5
    const confirmRemove = vi.fn(async () => true);
    const { result, events } = await mount(hubPoolWithFeesPlan(), {}, { confirmRemove });
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    act(() => result.current.canvas.panelProps.onRemove());
    await waitFor(() => expect(result.current.buildPlan.plan.hub.chains).toEqual([]));
    expect(confirmRemove).toHaveBeenCalledWith("hub-pool-pool");
    expect(result.current.selection.selectedId).toBeNull();
    expect(events).toEqual([{ type: "blockRemoved", kind: "uniswapV4Pool" }]);
    expect(toasts.toast).toHaveBeenCalledWith(
      "Block removed",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    );
  });

  it("removes nothing when confirmRemove says no", async () => {
    // @rule HU4
    const confirmRemove = vi.fn(async () => false);
    const { result, events } = await mount(hubPoolPlan(), {}, { confirmRemove });
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    act(() => result.current.canvas.requestRemove("hub-pool-pool"));
    await waitFor(() => expect(confirmRemove).toHaveBeenCalled());
    expect(result.current.buildPlan.plan).toEqual(hubPoolPlan());
    expect(result.current.selection.selectedId).toBe("hub-pool-pool");
    expect(events).toEqual([]);
  });

  it("removes nothing when a guard refuses to let the selection go", async () => {
    // @rule HU3
    // @rule I6
    const { result } = await mount(hubPoolPlan());
    press(result, { kind: "block", blockId: "hub-pool-pool" });
    const guard = vetoing();
    act(() => {
      result.current.selection.registerGuard(guard);
    });
    act(() => result.current.canvas.requestRemove("hub-pool-pool"));
    await waitFor(() => expect(guard.onRefused).toHaveBeenCalled());
    expect(result.current.buildPlan.plan).toEqual(hubPoolPlan());
  });

  it("restores the plan on Undo while nothing else changed, and only then", async () => {
    // @rule I6
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    act(() => result.current.canvas.requestRemove("hub-supply-supply"));
    await waitFor(() => expect(toasts.toast).toHaveBeenCalledTimes(1));
    const undo = toasts.toast.mock.calls[0]?.[1]?.action?.onClick as () => void;
    act(() => undo());
    expect(result.current.buildPlan.plan).toEqual(hubSupplyPlan());
    expect(events.at(-1)).toEqual({ type: "blockRestored", kind: "aaveSupply" });

    // Remove again, change the plan, then Undo: too late, nothing is restored.
    act(() => result.current.canvas.requestRemove("hub-supply-supply"));
    await waitFor(() => expect(toasts.toast).toHaveBeenCalledTimes(2));
    const staleUndo = toasts.toast.mock.calls[1]?.[1]?.action?.onClick as () => void;
    press(result, { kind: "addNetwork" });
    choose(result, "addSpoke:robinhood");
    const changed = result.current.buildPlan.plan;
    act(() => staleUndo());
    expect(result.current.buildPlan.plan).toEqual(changed);
    expect(events.filter((e) => e.type === "blockRestored")).toHaveLength(1);
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
  function key(key: string, target: EventTarget | null = document.body) {
    return { key, target, preventDefault: vi.fn() };
  }

  it("removes the selected block on Delete", async () => {
    // @rule I10
    const { result, events } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    const event = key("Delete");
    act(() => result.current.canvas.onKeyDown(event));
    await waitFor(() => expect(result.current.buildPlan.plan.hub.chains).toEqual([]));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(events).toEqual([{ type: "blockRemoved", kind: "aaveSupply" }]);
  });

  it("does nothing on Delete inside a text field, or with nothing selected", async () => {
    // @rule I10
    const { result } = await mount(hubSupplyPlan());
    act(() => result.current.canvas.onKeyDown(key("Delete")));
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    const input = document.createElement("input");
    act(() => result.current.canvas.onKeyDown(key("Delete", input)));
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

  it("hands the palette the mandate's model", async () => {
    // @rule AN8
    const { result } = await mount(hubPoolPlan());
    expect(result.current.canvas.paletteProps.model.sections.map((s) => s.id)).toEqual([
      "mandate",
      "flow",
      "comingSoon",
    ]);
  });

  it("keeps a removed block's network out of the panel once it is gone", async () => {
    // @rule AN10
    const { result } = await mount(hubSupplyPlan());
    press(result, { kind: "block", blockId: "hub-supply-supply" });
    expect(result.current.canvas.panelProps.head?.networkName).toBe("Arbitrum");
    act(() => result.current.canvas.requestRemove("hub-supply-supply"));
    await waitFor(() => expect(result.current.canvas.panelProps.head).toBeNull());
    expect(findBlock(result.current.buildPlan.plan, "hub-supply-supply")).toBeNull();
  });
});
