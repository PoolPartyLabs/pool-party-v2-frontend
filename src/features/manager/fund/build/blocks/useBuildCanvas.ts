/**
 * @id PP-MGR-HOK-010
 * @name useBuildCanvas
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none emitted here: every outcome leaves through `onEvent` as a
 *   {@link BuildCanvasEvent} (blockAdded with its `via`, networkAdded, networkRemoved, flowInserted,
 *   blockRemoved, blockRestored, blocked with its reason). The Build screen (PP-MGR-SCR-002, S7)
 *   maps them to the `builder_*` events; a hook that tracked them itself could not be tested apart
 *   from the screen and would fire once per consumer.
 *
 * The controller of the Build canvas (handoff v1.2 I1 to I7, I10, AN10; heads-up HU3, HU4): it
 * turns a press on a graph target, a menu choice, a palette drop, a key and "Remove block" into an
 * S1 reducer through `useBuildPlan.apply`, keeps the open menu, the drag and the selection, and
 * hands the renderer (S6), the palette, the menu and the panel stub what they draw.
 *
 * - LEGALITY is S1's. A menu option or a drop carries a {@link MenuAction}; the reducer decides, and
 *   a refusal is reported as `blocked` with the reducer's reason. A disabled option reports its own
 *   reason and adds nothing.
 * - A NEW BLOCK IS SELECTED (I5, G6): every block added in this batch is empty and arrives selected
 *   (Build state 3), through the selection guard like every other change; the block is added even
 *   when a guard refuses, and the guard shows its notice.
 * - REMOVE (I6, HU4, D5) asks `confirmRemove` (true in this batch; the panel batch adds its confirm
 *   step), then the guards (the selection goes away), then removes with the S1 cascade, clears the
 *   selection and shows the toast "Block removed" with "Undo". Undo restores the snapshot only while
 *   the plan is still the post-remove plan, so it never overwrites a later edit.
 * - EVERY WAY OUT through a menu link passes `selection.guardLeave` (HU3) before `onEditMandate`.
 * - DRAG (I3): while a palette row is dragged, `activeTargetKeys` holds exactly its valid drop
 *   targets (plus the anchor of an open menu, so a template or port whose menu is open looks
 *   active); a drop on one of them applies the same action as the menu, with `via: "palette"`.
 *
 * PP-NOTE: the undo toast goes through the app's Toast primitive (`toast` of sonner). The app does
 * not mount a `<Toaster />` today, so the screen that activates the canvas (S7) must make sure one
 * is mounted, or the toast is never seen.
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
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
import { addChain, addSpoke, insertAt, removeBlock, removeSpoke } from "../plan/planReducers";
import type { InsertSide } from "../plan/planRules";
import { planFingerprint } from "../plan/planStorage";
import type { UseBuildPlanResult } from "../plan/useBuildPlan";
import type { BuildPaletteProps } from "./BuildPalette";
import { useBlockCopy } from "./blockCopy";
import {
  describeBlock,
  describeFlow,
  describePanelHead,
  type PaletteDragItem,
  paletteModel,
} from "./blockRegistry";
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
import type { PanelStubProps } from "./PanelStub";
import type { UseBlockSelectionResult } from "./useBlockSelection";

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
  | { type: "blockRemoved"; kind: BlockKind | FlowKind }
  | { type: "blockRestored"; kind: BlockKind | FlowKind }
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
}

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
  /** Delete removes the selected block; Escape closes an open menu (I10). */
  onKeyDown(event: CanvasKeyEvent): void;
  chooseOption(option: MenuOption): void;
  closeMenu(): void;
  /** Remove a block (I6): `confirmRemove`, the guards, the cascade, the undo toast. */
  requestRemove(blockId: string): void;
  /** Remove a spoke with no chain, from the close control on its chip (I7, D5). */
  removeSpoke(network: NetworkId): void;
  /** Follow an "Edit mandate" link, through the leave guard (C6, HU3). */
  editMandate(step: "networks" | "protocols"): void;
  describeBlock(blockId: string): BlockContent;
  describeFlow(blockId: string): FlowContent;
  /** The translated network name (the raw id for a network this build does not name). */
  networkName(network: string): string;
  /** The accessible name of a spoke chip's close control: "Remove Robinhood Chain". */
  spokeRemoveLabel(network: string): string;
  paletteProps: BuildPaletteProps;
  panelProps: PanelStubProps;
  menuProps: CanvasMenuProps;
}

export interface UseBuildCanvasInput {
  draft: MandateDraft;
  catalog: MandateCatalog;
  buildPlan: UseBuildPlanResult;
  selection: UseBlockSelectionResult;
  onEvent(event: BuildCanvasEvent): void;
  onEditMandate(step: "networks" | "protocols"): void;
  /** HU4: resolves true in this batch; the panel batch adds its confirm step. */
  confirmRemove?(blockId: string): Promise<boolean>;
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

/** Whether a key press happens in a text field, where Delete edits text. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

const alwaysConfirm = async () => true;

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

  // Handlers read the latest values through refs: a remove resumes after an await, and a toast's
  // Undo runs long after the render that created it.
  const latest = useRef({ input, ctx, menu });
  latest.current = { input, ctx, menu };

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
      const kind = found.block.kind;
      const confirm = latest.current.input.confirmRemove ?? alwaysConfirm;
      void confirm(blockId).then((confirmed) => {
        if (!confirmed) return;
        const io = latest.current.input;
        if (io.selection.selectedId !== null && !io.selection.select(null)) return;
        const done = run((p, c) => removeBlock(p, c, blockId));
        if (!done) return;
        emit({ type: "blockRemoved", kind });
        const { before, after } = done;
        const restorable = planFingerprint(after);
        const { copy: text } = latest.current.ctx;
        toast(text.toast.removed, {
          action: {
            label: text.toast.undo,
            onClick: () => {
              // Too late once anything else changed the plan: nothing is overwritten.
              const outcome = latest.current.input.buildPlan.apply((current) =>
                planFingerprint(current) === restorable
                  ? before
                  : { blocked: { reason: "unknown_target", targetId: null } },
              );
              if (outcome.ok) emit({ type: "blockRestored", kind });
            },
          },
        });
      });
    },
    [run, emit],
  );

  const removeSpokeFromChip = useCallback(
    (network: NetworkId) => {
      if (run((p, c) => removeSpoke(p, c, network))) emit({ type: "networkRemoved", network });
    },
    [run, emit],
  );

  const editMandate = useCallback((step: "networks" | "protocols") => {
    setMenu(null);
    const io = latest.current.input;
    io.selection.guardLeave(() => io.onEditMandate(step));
  }, []);

  const onKeyDown = useCallback(
    (event: CanvasKeyEvent) => {
      if (event.key === "Escape" && latest.current.menu) {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (event.key !== "Delete" || latest.current.menu || isEditable(event.target)) return;
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

  const selectedId = selection.selectedId;
  const panelProps: PanelStubProps = useMemo(() => {
    const head = selectedId ? describePanelHead(selectedId, ctx) : null;
    const sentence = menu ? menuOpenSentence(menu.target, ctx) : null;
    return {
      head,
      nothingTitle: copy.panel.nothingTitle,
      body: sentence ?? (head ? null : copy.panel.nothingBody),
      removeLabel: copy.panel.remove,
      onRemove: () => {
        const current = latest.current.input.selection.selectedId;
        if (current) requestRemove(current);
      },
    };
  }, [selectedId, menu, ctx, copy, requestRemove]);

  const menuProps: CanvasMenuProps = useMemo(
    () => ({
      menu: openMenu ? { anchor: openMenu.anchor, model: openMenu.model } : null,
      onChoose: chooseOption,
      onLink: editMandate,
      onClose: closeMenu,
    }),
    [openMenu, chooseOption, editMandate, closeMenu],
  );

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
    removeSpoke: removeSpokeFromChip,
    editMandate,
    describeBlock: (blockId) => describeBlock(blockId, ctx),
    describeFlow: (blockId) => describeFlow(blockId, ctx),
    networkName: copy.networkName,
    spokeRemoveLabel: (network) => copy.networkRemove(copy.networkName(network)),
    paletteProps,
    panelProps,
    menuProps,
  };
}
