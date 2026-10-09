/**
 * @id PP-MGR-CMP-098 (POO-2291)
 * @name SolanaLocalManageHost
 * @implements-rules-version v1
 * @i18n-namespace manager.solanaPreview, manager.solanaPreview.localManage
 * @analytics-events none, parent receives bounded local intents and owns analytics
 * Persistent local Manage ownership across hidden panels and selection changes.
 * PP-INTEGRATION-POINT: POO-2239/2240/2261/2262 supply canonical reads/context/clock separately;
 * drawing configuration never supplies Current, After or a signing capability.
 */
"use client";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { allocationText, type PreviewBlock, parseAllocation } from "./previewModel";
import { SolanaManagePresenter } from "./SolanaManagePresenter";
import {
  createSolanaManageState,
  type SolanaManageAction,
  type SolanaManageConfig,
  type SolanaManageProtocol,
  selectSolanaManageView,
  solanaManageReducer,
} from "./solanaManageModel";

export type SolanaLocalManageIntent =
  | "edit"
  | "choose"
  | "review"
  | "apply"
  | "discard"
  | "rebase"
  | "blocked";
export interface SolanaLocalManageHostProps {
  /** Drawing instances, independent from canonical financial snapshots. */
  blocks: PreviewBlock[];
  /** Position selected by the parent; fixed-node inspectors live in the parent. */
  selectedId: string | null;
  /** Parent changes visibility/selection; closing does not discard state. */
  onClose(): void;
  /** False hides this mounted host without resetting drafts or review steps. */
  active: boolean;
  /** Bounded instrumentation only, never IDs or monetary values. */
  onIntent?(protocol: SolanaManageProtocol, action: SolanaLocalManageIntent): void;
  /** Aggregate draft dirtiness, independent from the selected instance. */
  onDirtyChange?(dirty: boolean): void;
  /** Returns true only when the drawing owner accepts this config. Financial reads remain independent. */
  onApplyDrawing?(localId: string, config: SolanaManageConfig): boolean;
  /** Shared Build allocation ownership; omitted retains standalone per-instance budgets. */
  allocations?: Readonly<Record<string, { groupId: string; editable: boolean }>>;
  /** Explicit phase-leave discard, never used by selection or visibility changes. */
  discardRevision?: number;
}
export function SolanaLocalManageHost({
  blocks,
  selectedId,
  active,
  onClose,
  onIntent,
  onDirtyChange,
  onApplyDrawing,
  allocations: allocationOwners,
  discardRevision = 0,
}: SolanaLocalManageHostProps) {
  const t = useTranslations("manager.solanaPreview");
  const root = useRef<HTMLElement>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const inputs = useMemo(
    () =>
      blocks.map((block) => ({
        localId: block.id,
        protocol: block.protocol,
        config: { allocation: allocationText(block.allocationBps), pair: block.pair, range: null },
      })),
    [blocks],
  );
  const [state, dispatch] = useReducer(solanaManageReducer, inputs, createSolanaManageState);
  const discarded = useRef(discardRevision);
  useEffect(() => {
    if (discarded.current === discardRevision) return;
    discarded.current = discardRevision;
    for (const localId of Object.keys(state.instances)) dispatch({ type: "discard", localId });
  }, [discardRevision, state.instances]);
  useEffect(() => {
    dispatch({ type: "sync-drawing", inputs });
  }, [inputs]);
  const selected =
    selectedId && Object.hasOwn(state.instances, selectedId)
      ? state.instances[selectedId]
      : undefined;
  const visible = Boolean(active && selected);
  useEffect(() => {
    if (!visible || !selectedId) return;
    const heading = root.current?.querySelector<HTMLElement>(
      `[data-local-manage-pane]:not([hidden]) h2`,
    );
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }, [visible, selectedId]);
  const instances = Object.values(state.instances);
  const dirty = instances.some(
    (instance) => selectSolanaManageView(state, instance.localId, "").dirty,
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const allocations = instances
    .filter((instance) => allocationOwners?.[instance.localId]?.editable !== false)
    .map((instance) => parseAllocation(instance.draft.config.allocation));
  const allocationsValid = allocations.every((allocation) => allocation !== null);
  const aggregateAllowed =
    allocationsValid &&
    allocations.reduce<number>((total, allocation) => total + (allocation ?? 0), 0) <= 10000;
  const blocked = (protocol: SolanaManageProtocol) => onIntent?.(protocol, "blocked");
  const act = (action: SolanaManageAction) => {
    if (!("localId" in action)) return;
    const owner = state.instances[action.localId];
    if (!owner) return;
    if (
      action.type === "edit" &&
      allocationOwners?.[action.localId]?.editable === false &&
      action.patch.allocation !== undefined
    )
      return;
    if (action.type === "choose" && !aggregateAllowed) {
      blocked(owner.protocol);
      return;
    }
    setAppliedId(null);
    dispatch(action);
    if (
      action.type === "edit" ||
      action.type === "choose" ||
      action.type === "discard" ||
      action.type === "rebase"
    )
      onIntent?.(owner.protocol, action.type);
  };
  const applyDrawing = () => {
    if (!selected || !onApplyDrawing) return;
    const view = selectSolanaManageView(state, selected.localId, "");
    // Apply writes one drawing instance; other unapplied drafts cannot fund that write.
    const drawingAllocations = blocks
      .filter((block) => allocationOwners?.[block.id]?.editable !== false)
      .map((block) =>
        parseAllocation(
          block.id === selected.localId
            ? selected.draft.config.allocation
            : allocationText(block.allocationBps),
        ),
      );
    const drawingAllowed =
      blocks.some((block) => block.id === selected.localId) &&
      drawingAllocations.every((allocation) => allocation !== null) &&
      drawingAllocations.reduce<number>((total, allocation) => total + (allocation ?? 0), 0) <=
        10000;
    // PP-INTEGRATION-POINT: verified protocol range context is unavailable in the local drawing host.
    if (
      !aggregateAllowed ||
      !drawingAllowed ||
      !view.localApplyValid ||
      selected.draft.config.range !== null
    ) {
      blocked(selected.protocol);
      return;
    }
    const config = structuredClone(selected.draft.config);
    if (onApplyDrawing(selected.localId, config) !== true) {
      blocked(selected.protocol);
      return;
    }
    dispatch({ type: "apply-local", localId: selected.localId });
    setAppliedId(selected.localId);
    onIntent?.(selected.protocol, "apply");
  };
  return (
    <section
      ref={root}
      aria-label={t("localManage.title")}
      hidden={!visible}
      data-solana-local-manage-host=""
      onKeyDown={(event) => {
        if (visible && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="size-11 p-0"
          aria-label={t("closePanel")}
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {!aggregateAllowed ? (
        <p role="alert" className="mb-3 text-warning text-xs">
          {t(allocationsValid ? "allocationExceeded" : "allocationInvalid")}
        </p>
      ) : null}
      {instances.map((instance) => (
        <div
          key={instance.localId}
          hidden={instance.localId !== selectedId}
          data-local-manage-pane=""
        >
          <SolanaManagePresenter
            localId={instance.localId}
            protocol={instance.protocol}
            state={state}
            now={null}
            rangeContext={null}
            onAction={act}
            actionAllowed={aggregateAllowed}
            allocationReadOnly={allocationOwners?.[instance.localId]?.editable === false}
            onBlocked={() => blocked(instance.protocol)}
            onReviewIntent={() => onIntent?.(instance.protocol, "review")}
          />
          {onApplyDrawing && selectSolanaManageView(state, instance.localId, "").dirty ? (
            <Button className="mt-3 w-full" onClick={applyDrawing}>
              {t("apply")}
            </Button>
          ) : null}
          {appliedId === instance.localId ? (
            <p role="status" className="mt-3 text-xs text-positive">
              {t("localApplied")}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
