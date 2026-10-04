/**
 * @id PP-MGR-HOK-010
 * @name useBuildCanvas
 * @implements-rules-version v1 (POO-2155 rules v1; the remove confirm and the widened Edit mandate
 *   of POO-2187 rules v1)
 * @analytics-events none emitted here: every outcome leaves through `onEvent` as a
 *   {@link BuildCanvasEvent} (blockAdded with its `via`, networkAdded, networkRemoved, flowInserted,
 *   blockRemoved with its cascade count, blocked with its reason). The Build screen
 *   (PP-MGR-SCR-002, S7) maps them to the `builder_*` events; a hook that tracked them itself could
 *   not be tested apart from the screen and would fire once per consumer.
 *
 * The controller of the Build canvas (handoff v1.2 I1 to I7, I10, AN10; heads-up HU3, HU4): it
 * turns a press on a graph target, a menu choice, a palette drop, a key and "Remove block" into an
 * S1 reducer through `useBuildPlan.apply`, keeps the open menu, the drag, the selection and the
 * remove confirm, and hands the renderer (S6), the palette, the menu and the panel what they draw.
 *
 * - LEGALITY is S1's. A menu option or a drop carries a {@link MenuAction}; the reducer decides, and
 *   a refusal is reported as `blocked` with the reducer's reason. A disabled option reports its own
 *   reason and adds nothing.
 * - A NEW BLOCK IS SELECTED (I5, G6): every block added in this batch is empty and arrives selected
 *   (Build state 3), through the selection guard like every other change; the block is added even
 *   when a guard refuses, and the guard shows its notice.
 * - REMOVE (I6, panels P10, decision DP11) ALWAYS ASKS: "Remove block" in the panel and the Delete
 *   key open the panel's in-place confirm for the selected block (`removeConfirmId`); nothing is
 *   removed until it is confirmed. The confirm drops the panel's draft (`beforeRemove`), clears the
 *   selection through the guards, and removes with the I6 cascade, the spoke's share following
 *   (`removeBlockReleasingShare`); `blockRemoved` carries how many other steps went with it. The
 *   canvas batch's Undo toast is gone (I6 as the panels batch amends it).
 * - EVERY WAY OUT through a menu or panel link passes `selection.guardLeave` (HU3) before
 *   `onEditMandate`, which also names the block selected then, so the shell can bring Build back with
 *   that block selected (finding 19). A refused way out resumes after Apply changes or Discard
 *   changes (P6).
 * - DRAG (I3): while a palette row is dragged, `activeTargetKeys` holds exactly its valid drop
 *   targets (plus the anchor of an open menu, so a template or port whose menu is open looks
 *   active); a drop on one of them applies the same action as the menu, with `via: "palette"`.
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft, NetworkId } from "../../mandateDraft";
import { type GraphTarget, targetKey } from "../layout/graphTypes";
import type { BlockContent, FlowContent } from "../pieces/pieceTypes";
import {
  type BlockKind,
  type BuildPlan,
  type FlowKind,
  isPlanBlocked,
  type PlanBlockReason,
  type PlanContext,
  type PlanReducerResult,
} from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import {
  addChain,
  addSpoke,
  describeRemoval,
  insertAt,
  type RemovalDescription,
  removeBlockReleasingShare,
  removeSpoke,
} from "../plan/planReducers";
import type { InsertSide } from "../plan/planRules";
import type { UseBuildPlanResult } from "../plan/useBuildPlan";
import type { BuildPaletteProps } from "./BuildPalette";
import { useBlockCopy } from "./blockCopy";
import { describeBlock, describeFlow, type PaletteDragItem, paletteModel } from "./blockRegistry";
import type { CanvasMenuProps } from "./CanvasMenu";
import {
  dropTargets,
  type MenuAction,
  type MenuContext,
  type MenuModel,
  type MenuOption,
  menuModelFor,
  menuOpenSentence,
} from "./menuModels";
import type { UseBlockSelectionResult } from "./useBlockSelection";

/**
 * The Mandate steps an "Edit mandate" link opens: networks and protocols from the canvas menus,
 * tokens, pools and limits from the configuration panel (finding 19).
 */
export type MandateEditStep = "networks" | "protocols" | "tokens" | "pools" | "limits";

/** What happened on the canvas, for S7 to map to analytics (D20). */
export type BuildCanvasEvent =
  | {
      type: "blockAdded";
      kind: BlockKind;
      network: NetworkId;
      via: "template" | "palette" | "port";
    }
  | { type: "networkAdded"; network: NetworkId }
  | { type: "networkRemoved"; network: NetworkId }
  /** Swap or Collect fees only: a Borrow inserted at a port is a `blockAdded`. */
  | { type: "flowInserted"; kind: FlowKind; slot: InsertSide }
  /** `cascadeCount`: the other steps removed with it (its Swap · auto, Collect fees, Borrow...). */
  | { type: "blockRemoved"; kind: BlockKind | FlowKind; cascadeCount: number }
  | { type: "blocked"; reason: PlanBlockReason };

/** The menu open on the canvas: its anchor, the target it belongs to, and what it lists. */
export interface OpenCanvasMenu {
  anchor: HTMLElement;
  target: GraphTarget;
  model: MenuModel;
}

/** The part of a keyboard event the controller reads: a React or a DOM `KeyboardEvent` fits. */
export interface CanvasKeyEvent {
  key: string;
  target: EventTarget | null;
  preventDefault(): void;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * I10: the keys that remove the selected block. A Mac keyboard's delete key sends "Backspace"
 * (review F1 of PR #36), so both count; neither does with a modifier held.
 */
const REMOVE_KEYS: ReadonlySet<string> = new Set(["Delete", "Backspace"]);

export interface BuildCanvasController {
  /** Targets drawn active (`primary`): the open menu's anchor, and every valid drop while dragging. */
  activeTargetKeys: ReadonlySet<string>;
  openMenu: OpenCanvasMenu | null;
  /** The palette row being dragged, or null. */
  dragging: PaletteDragItem | null;
  /** A press on a template, a port, a card or a share label (S6 calls it). */
  onTarget(target: GraphTarget, anchor: HTMLElement): void;
  /** A click on the canvas background (S2's viewport, through S7). */
  onBackgroundClick(): void;
  /**
   * Delete or Backspace opens the remove confirm of the selected block (I10, DP11); Escape closes an
   * open menu, or else an open confirm.
   */
  onKeyDown(event: CanvasKeyEvent): void;
  chooseOption(option: MenuOption): void;
  closeMenu(): void;
  /** Ask to remove a block (P10, DP11): opens the panel's confirm; nothing is removed yet. */
  requestRemove(blockId: string): void;
  /** The confirm's "Remove block": the draft dropped, the guards, the I6 cascade (P10). */
  confirmRemove(): void;
  /** The confirm's "Cancel". */
  cancelRemove(): void;
  /** The block whose remove confirm is open, or null. */
  removeConfirmId: string | null;
  /** Remove a spoke with no chain, from the close control on its chip (I7, D5). */
  removeSpoke(network: NetworkId): void;
  /** Follow an "Edit mandate" link, through the leave guard (C6, HU3, P6). */
  editMandate(step: MandateEditStep): void;
  describeBlock(blockId: string): BlockContent;
  describeFlow(blockId: string): FlowContent;
  /** The translated network name (the raw id for a network this build does not name). */
  networkName(network: string): string;
  paletteProps: BuildPaletteProps;
  /** Mode 1's sentence while a menu is open on the canvas, or null. */
  menuSentence: string | null;
  menuProps: CanvasMenuProps;
  /** The plan, the mandate, the catalog, the violations and the copy, as the panel reads them. */
  context: MenuContext;
}

export interface UseBuildCanvasInput {
  draft: MandateDraft;
  catalog: MandateCatalog;
  buildPlan: UseBuildPlanResult;
  selection: UseBlockSelectionResult;
  onEvent(event: BuildCanvasEvent): void;
  /** An Edit mandate link, past the guard: the step, and the block selected when it was followed. */
  onEditMandate(step: MandateEditStep, selectedId: string | null): void;
  /** Runs right before a confirmed remove: the panel drops the removed block's draft (P10). */
  beforeRemove?(): void;
}

/** The ids of the position blocks of `after` that `before` did not hold. */
function newPositionIds(before: BuildPlan, after: BuildPlan): string[] {
  const all = (plan: BuildPlan) =>
    [...plan.hub.chains, ...plan.spokes.flatMap((s) => s.chains)].flatMap((chain) =>
      chain.steps.filter((step) => step.family === "position").map((step) => step.id),
    );
  const had = new Set(all(before));
  return all(after).filter((id) => !had.has(id));
}

/** Whether a key press happens in a text field, where Delete and Backspace edit text. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    // `isContentEditable` needs layout in some engines (jsdom has none): read the attribute too.
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** The Build canvas controller. */
export function useBuildCanvas(input: UseBuildCanvasInput): BuildCanvasController {
  const { draft, catalog, buildPlan, selection } = input;
  const copy = useBlockCopy();
  const plan = buildPlan.plan;
  const ctx: MenuContext = useMemo(
    () => ({ plan, draft, catalog, violations: buildPlan.violations, copy }),
    [plan, draft, catalog, buildPlan.violations, copy],
  );

  const [menu, setMenu] = useState<{ anchor: HTMLElement; target: GraphTarget } | null>(null);
  const [dragging, setDragging] = useState<PaletteDragItem | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  // The confirm belongs to the block it was opened for: another selection closes it for good.
  if (removeConfirm !== null && removeConfirm !== selection.selectedId) setRemoveConfirm(null);
  const removeConfirmId =
    removeConfirm !== null && removeConfirm === selection.selectedId ? removeConfirm : null;

  // Handlers read the latest values through refs: a guarded way out resumes after the panel
  // settled, long after the render that created the handler.
  const latest = useRef({ input, ctx, menu, removeConfirmId });
  latest.current = { input, ctx, menu, removeConfirmId };

  const emit = useCallback((event: BuildCanvasEvent) => latest.current.input.onEvent(event), []);

  /** Run a reducer; on refusal report `blocked` and answer null, else the plans around it. */
  const run = useCallback(
    (
      reducer: (plan: BuildPlan, context: PlanContext) => PlanReducerResult,
    ): { before: BuildPlan; after: BuildPlan } | null => {
      const seen: { before: BuildPlan | null; after: BuildPlan | null } = {
        before: null,
        after: null,
      };
      const outcome = latest.current.input.buildPlan.apply((current, context) => {
        const result = reducer(current, context);
        if (!isPlanBlocked(result)) {
          seen.before = current;
          seen.after = result;
        }
        return result;
      });
      if (!outcome.ok) {
        emit({ type: "blocked", reason: outcome.blocked.reason });
        return null;
      }
      return seen.before && seen.after ? { before: seen.before, after: seen.after } : null;
    },
    [emit],
  );

  /** Apply a menu action (or a drop); true when the plan changed. */
  const applyAction = useCallback(
    (action: MenuAction, via: "template" | "palette" | "port"): boolean => {
      if (action.kind === "addSpoke") {
        if (!run((p, c) => addSpoke(p, c, action.network))) return false;
        emit({ type: "networkAdded", network: action.network });
        return true;
      }
      if (action.kind === "addChain") {
        const done = run((p, c) => addChain(p, c, action.network, action.blockKind));
        if (!done) return false;
        emit({ type: "blockAdded", kind: action.blockKind, network: action.network, via });
        const added = newPositionIds(done.before, done.after)[0];
        if (added) latest.current.input.selection.select(added);
        return true;
      }
      const network = findBlock(latest.current.ctx.plan, action.slot.blockId)?.network ?? null;
      const done = run((p, c) => insertAt(p, c, action.slot, action.choice));
      if (!done) return false;
      if (action.choice.family === "flow") {
        emit({ type: "flowInserted", kind: action.choice.kind, slot: action.slot.side });
        return true;
      }
      if (network) {
        emit({ type: "blockAdded", kind: action.choice.kind, network, via });
      }
      const added = newPositionIds(done.before, done.after)[0];
      if (added) latest.current.input.selection.select(added);
      return true;
    },
    [run, emit],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const chooseOption = useCallback(
    (option: MenuOption) => {
      if (option.disabled || !option.action) {
        emit({ type: "blocked", reason: option.blockedReason ?? "unknown_target" });
        return;
      }
      const via = option.action.kind === "insert" ? "port" : "template";
      if (applyAction(option.action, via)) setMenu(null);
    },
    [applyAction, emit],
  );

  const onTarget = useCallback(
    (target: GraphTarget, anchor: HTMLElement) => {
      const { ctx: current, menu: open, input: io } = latest.current;
      if (target.kind === "block") {
        setMenu(null);
        if (findBlock(current.plan, target.blockId)?.block.family === "position") {
          io.selection.select(target.blockId);
        }
        return;
      }
      if (target.kind === "shareLabel") {
        setMenu(null);
        // D26: a spoke's label feeds its Bridge, which is not selectable.
        if (target.feedsBlockId) io.selection.select(target.feedsBlockId);
        return;
      }
      if (open && targetKey(open.target) === targetKey(target)) {
        setMenu(null);
        return;
      }
      const model = menuModelFor(target, current);
      if (!model) return;
      if (target.kind === "port" && model.options.length === 0) {
        emit({ type: "blocked", reason: "slot_not_allowed" });
        return;
      }
      if (target.kind === "addNetwork" && model.options.length === 0) {
        emit({ type: "blocked", reason: "no_network_left" });
      }
      setMenu({ anchor, target });
    },
    [emit],
  );

  const onBackgroundClick = useCallback(() => {
    setMenu(null);
    latest.current.input.selection.select(null);
  }, []);

  const requestRemove = useCallback(
    (blockId: string) => {
      const found = findBlock(latest.current.ctx.plan, blockId);
      if (!found) return;
      if (found.block.family === "flow" && found.block.auto) {
        emit({ type: "blocked", reason: "auto_owned" });
        return;
      }
      // [P10, DP11] Remove always asks: the panel shows its confirm for this block.
      setMenu(null);
      setRemoveConfirm(blockId);
    },
    [emit],
  );

  const cancelRemove = useCallback(() => setRemoveConfirm(null), []);

  const confirmRemove = useCallback(() => {
    const blockId = latest.current.removeConfirmId;
    if (!blockId) return;
    setRemoveConfirm(null);
    const { plan, draft, catalog } = latest.current.ctx;
    const found = findBlock(plan, blockId);
    if (!found) return;
    // Review L7 of PR #54: nothing is dropped for a remove the reducer would refuse.
    let preview = 0;
    const previewIds = () => `remove-check-${++preview}`;
    if (describeRemoval(plan, { draft, catalog, newId: previewIds }, blockId) === null) return;
    const io = latest.current.input;
    // The block takes its unapplied changes with it, so the panel's guard lets the selection go.
    io.beforeRemove?.();
    if (io.selection.selectedId !== null && !io.selection.select(null)) return;
    const removal: { described: RemovalDescription | null } = { described: null };
    const done = run((p, c) => {
      removal.described = describeRemoval(p, c, blockId);
      return removeBlockReleasingShare(p, c, blockId);
    });
    if (!done) return;
    const cascadeCount = removal.described?.removedWith.length ?? 0;
    emit({ type: "blockRemoved", kind: found.block.kind, cascadeCount });
  }, [run, emit]);

  const removeSpokeFromChip = useCallback(
    (network: NetworkId) => {
      if (run((p, c) => removeSpoke(p, c, network))) emit({ type: "networkRemoved", network });
    },
    [run, emit],
  );

  const editMandate = useCallback((step: MandateEditStep) => {
    setMenu(null);
    latest.current.input.selection.guardLeave(() => {
      // Read when the way out runs (after Apply or Discard settled, P6), not when it was asked.
      const io = latest.current.input;
      io.onEditMandate(step, io.selection.selectedId);
    });
  }, []);

  const onKeyDown = useCallback(
    (event: CanvasKeyEvent) => {
      if (event.key === "Escape" && latest.current.menu) {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (event.key === "Escape" && latest.current.removeConfirmId) {
        event.preventDefault();
        setRemoveConfirm(null);
        return;
      }
      if (!REMOVE_KEYS.has(event.key) || latest.current.menu || isEditable(event.target)) return;
      // Review L3 of PR #54: Delete on a focused panel control (the slider, a chip, the select's
      // list) is not a request to remove the block; only the card's own keys are.
      if (event.target instanceof Element && event.target.closest("[data-build-panel-slot]"))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const selected = latest.current.input.selection.selectedId;
      if (!selected) return;
      event.preventDefault();
      requestRemove(selected);
    },
    [requestRemove],
  );

  const openMenu: OpenCanvasMenu | null = useMemo(() => {
    if (!menu) return null;
    const model = menuModelFor(menu.target, ctx);
    return model ? { ...menu, model } : null;
  }, [menu, ctx]);

  const activeTargetKeys = useMemo(() => {
    const keys = new Set<string>();
    if (dragging) for (const drop of dropTargets(dragging, ctx)) keys.add(targetKey(drop.target));
    if (menu) keys.add(targetKey(menu.target));
    return keys;
  }, [dragging, menu, ctx]);

  const palette = useMemo(() => paletteModel(draft, copy), [draft, copy]);
  const paletteProps: BuildPaletteProps = useMemo(
    () => ({
      model: palette,
      onDragStart: (item) => {
        setMenu(null);
        setDragging(item);
      },
      onDrop: (item, key) => {
        setDragging(null);
        if (key === null) return;
        // The same set `activeTargetKeys` lit for this item: a key outside it does nothing.
        const drop = dropTargets(item, latest.current.ctx).find(
          (candidate) => targetKey(candidate.target) === key,
        );
        if (drop) applyAction(drop.action, "palette");
      },
      onDragCancel: () => setDragging(null),
    }),
    [palette, applyAction],
  );

  const menuSentence = useMemo(
    () => (menu ? menuOpenSentence(menu.target, ctx) : null),
    [menu, ctx],
  );

  const menuProps: CanvasMenuProps = useMemo(
    () => ({
      menu: openMenu ? { anchor: openMenu.anchor, model: openMenu.model } : null,
      onChoose: chooseOption,
      onLink: editMandate,
      onClose: closeMenu,
    }),
    [openMenu, chooseOption, editMandate, closeMenu],
  );

  // Stable while the plan, the mandate, the violations and the locale do not change, so the
  // renderer (S6) can memoise every card on them (review F5 of PR #36).
  const describeBlockNow = useCallback((blockId: string) => describeBlock(blockId, ctx), [ctx]);
  const describeFlowNow = useCallback((blockId: string) => describeFlow(blockId, ctx), [ctx]);

  return {
    activeTargetKeys,
    openMenu,
    dragging,
    onTarget,
    onBackgroundClick,
    onKeyDown,
    chooseOption,
    closeMenu,
    requestRemove,
    confirmRemove,
    cancelRemove,
    removeConfirmId,
    removeSpoke: removeSpokeFromChip,
    editMandate,
    describeBlock: describeBlockNow,
    describeFlow: describeFlowNow,
    networkName: copy.networkName,
    paletteProps,
    menuSentence,
    menuProps,
    context: ctx,
  };
}
