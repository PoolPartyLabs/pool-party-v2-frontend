/**
 * @id PP-MGR-SCR-009
 * @name SolanaStrategyPreviewScreen
 * @description In-memory Configure/Manage with independent drafts and all-node inspection.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-2725
 * @linear https://linear.app/yeildbay/issue/POO-2281
 * @i18n-namespace manager.solanaPreview
 * @implements-rules-version v2 (POO-2281), v1 (POO-2291)
 * @analytics-events solana_preview_viewed, solana_preview_interacted, solana_preview_started, solana_preview_applied, solana_preview_abandoned, solana_preview_blocked
 */
"use client";

import { ArrowLeft, Plus, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { AnalyticsManageNodeKind } from "@/lib/analytics/events";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useUnsavedChanges } from "@/lib/hooks/unsavedChanges";
import {
  createPreviewState,
  hasUnappliedChanges,
  PREVIEW_BLOCKS,
  type PreviewAction,
  previewReducer,
  totalAllocationBps,
} from "./previewModel";
import { SolanaLocalManageHost, type SolanaLocalManageIntent } from "./SolanaLocalManageHost";
import { SolanaPreviewBlockPanel } from "./SolanaPreviewBlockPanel";
import { getPreviewGeometry, PreviewLogo, SolanaPreviewCanvas } from "./SolanaPreviewCanvas";
import { SolanaPreviewRenderBoundary } from "./SolanaPreviewErrorBoundary";
import type { SolanaManageConfig, SolanaManageProtocol } from "./solanaManageModel";

export interface SolanaStrategyPreviewScreenProps {
  onExit(): void;
}

/** Frontend-only hidden experiment. No server, wallet, EVM mandate or persistence state. */
export function SolanaStrategyPreviewScreen({ onExit }: SolanaStrategyPreviewScreenProps) {
  const t = useTranslations("manager");
  const format = useFormatter();
  const { track } = useAnalytics();
  const protocolNames = {
    kamino: t("solanaPreview.protocols.kamino"),
    jupiter: t("solanaPreview.protocols.jupiter"),
    raydium: t("solanaPreview.protocols.raydium"),
    orca: t("solanaPreview.protocols.orca"),
    holding: t("solanaPreview.holding.title"),
  };
  const [state, dispatch] = useReducer(previewReducer, undefined, createPreviewState);
  const [pending, setPending] = useState<PreviewAction | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [mode, setMode] = useState<"configure" | "manage">("configure");
  const [manageSelection, setManageSelection] = useState<string | null>(null);
  const [manageDirty, setManageDirty] = useState(false);
  const [pendingMode, setPendingMode] = useState<"configure" | "manage" | null>(null);
  const panelAnchor = useRef<HTMLElement | null>(null);
  const returnFocus = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const fixedPanel = useRef<HTMLElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const rootRef = useRef<HTMLElement>(null);
  const confirmationFocus = useRef<{ origin: HTMLElement | null; confirmed: boolean } | null>(null);
  const viewed = useRef(false);
  const started = useRef(false);
  const dirty = state.changed || hasUnappliedChanges(state) || manageDirty;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty);
  useEffect(() => {
    if (!viewed.current) {
      viewed.current = true;
      track("solana_preview_viewed");
    }
    return () => {
      if (dirtyRef.current) track("solana_preview_abandoned", { has_local_changes: true });
    };
  }, [track]);
  const selected = state.blocks.find((block) => block.id === state.selectedId);
  const managed = state.blocks.find((block) => block.id === manageSelection);
  const inspectionOwner = state.blocks.find((block) => manageSelection?.startsWith(`${block.id}-`));
  const inspectionNetwork = manageSelection?.startsWith("hub-") ? "Arbitrum" : "Solana";
  const geometry = useMemo(() => getPreviewGeometry(state.blocks), [state.blocks]);
  const manageNode =
    mode === "manage" && manageSelection && Object.hasOwn(geometry.nodes, manageSelection)
      ? manageSelection
      : null;
  const panelOpen = mode === "configure" ? Boolean(selected) : Boolean(manageNode);
  const fixedLabel = (id: string) =>
    id === "operating-cash"
      ? t("solanaPreview.operatingCash")
      : id === "hub-income"
        ? t("solanaPreview.income")
        : id === "hub-deposit"
          ? t("solanaPreview.deposit")
          : id === "hub-withdraw"
            ? t("solanaPreview.withdraw")
            : id === "bridge-in"
              ? t("solanaPreview.bridgeIn")
              : id === "bridge-out"
                ? t("solanaPreview.bridgeOut")
                : id.endsWith("-collect")
                  ? t("solanaPreview.collect")
                  : id.includes("swap")
                    ? t("solanaPreview.autoSwap")
                    : t(id.endsWith("output") ? "manageV2.idleOutput" : "manageV2.idleInput");
  const nodeKind = (id: string): AnalyticsManageNodeKind =>
    state.blocks.some((block) => block.id === id)
      ? "position"
      : id === "operating-cash"
        ? "cash"
        : id === "hub-income"
          ? "income"
          : id === "hub-deposit"
            ? "deposit"
            : id === "hub-withdraw"
              ? "withdraw"
              : id.startsWith("bridge-")
                ? "bridge"
                : id.endsWith("-collect")
                  ? "collectFees"
                  : id.endsWith("-auto-swap")
                    ? "feeSwap"
                    : id.includes("swap")
                      ? "swap"
                      : id.endsWith("output")
                        ? "idleOutput"
                        : "idleInput";
  useEffect(() => {
    if (manageSelection && !Object.hasOwn(geometry.nodes, manageSelection))
      setManageSelection(null);
  }, [geometry, manageSelection]);
  useEffect(() => {
    if (mode === "manage" && manageNode && !managed) fixedPanel.current?.focus();
  }, [mode, manageNode, managed]);
  useEffect(() => {
    if (focusRequest === 0 || !returnFocus.current || panelOpen) return;
    returnFocus.current = false;
    const frame = requestAnimationFrame(() => {
      if (panelAnchor.current?.isConnected) panelAnchor.current.focus();
      else rootRef.current?.querySelector<HTMLElement>("[data-preview-mode]")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [panelOpen, focusRequest]);
  const manageIntent = useCallback(
    (protocol: SolanaManageProtocol, action: SolanaLocalManageIntent) => {
      if (action === "blocked") {
        track("solana_preview_blocked", {
          preview_protocol: protocol,
          preview_reason: "unsupported",
          has_local_changes: dirtyRef.current,
        });
      } else {
        track("solana_preview_interacted", {
          preview_protocol: protocol,
          preview_mode: "manage",
          preview_action: action,
          has_local_changes: dirtyRef.current,
        });
      }
    },
    [track],
  );
  const applyDrawing = useCallback(
    (id: string, config: SolanaManageConfig) => {
      // PP-INTEGRATION-POINT: POO-2239/2240/2261/2262 supply live position/policy execution separately. This dispatch only changes the drawing.
      const action: PreviewAction = {
        type: "apply-drawing",
        id,
        value: { allocation: config.allocation, pair: config.pair },
      };
      if (config.range !== null || previewReducer(state, action) === state) return false;
      dispatch(action);
      const block = state.blocks.find((item) => item.id === id);
      if (block)
        track("solana_preview_applied", {
          preview_protocol: block.protocol,
          has_local_changes: true,
        });
      return true;
    },
    [state, track],
  );

  function captureConfirmationFocus() {
    confirmationFocus.current = {
      origin: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      confirmed: false,
    };
  }
  function restoreConfirmationFocus(event: Event) {
    event.preventDefault();
    const focus = confirmationFocus.current;
    confirmationFocus.current = null;
    const heading =
      modeRef.current === "manage"
        ? (rootRef.current?.querySelector<HTMLElement>(
            "[data-solana-local-manage-host]:not([hidden]) [data-local-manage-pane]:not([hidden]) h2",
          ) ?? fixedPanel.current)
        : rootRef.current?.querySelector<HTMLElement>("#solana-preview-configure");
    const target = !focus?.confirmed && focus?.origin?.isConnected ? focus.origin : heading;
    (
      target ??
      (panelAnchor.current?.isConnected ? panelAnchor.current : null) ??
      rootRef.current?.querySelector<HTMLElement>(`[data-preview-mode="${modeRef.current}"]`)
    )?.focus();
  }

  function perform(action: PreviewAction) {
    if (action.type === "add" && !started.current) {
      started.current = true;
      track("solana_preview_started", { preview_protocol: action.protocol });
    }
    if (action.type === "add" && mode === "manage") setManageSelection(`preview-${state.nextId}`);
    setApplied(false);
    dispatch(action);
  }
  function request(action: PreviewAction) {
    if (mode === "configure" && hasUnappliedChanges(state)) {
      captureConfirmationFocus();
      setPending(action);
      track("solana_preview_blocked", {
        preview_reason: "unapplied_changes",
        has_local_changes: true,
      });
    } else perform(action);
  }
  function selectMode(next: "configure" | "manage") {
    if (mode === next) return;
    if (next === "manage") setManageSelection(manageSelection ?? state.selectedId);
    else if (managed) dispatch({ type: "select", id: managed.id });
    setMode(next);
    track("solana_preview_interacted", {
      preview_mode: next,
      preview_action: "mode",
      has_local_changes: dirtyRef.current,
    });
  }
  function requestMode(next: "configure" | "manage") {
    if (mode === next) return;
    if (mode === "configure" && hasUnappliedChanges(state)) {
      captureConfirmationFocus();
      setPendingMode(next);
      track("solana_preview_blocked", {
        preview_reason: "unapplied_changes",
        has_local_changes: true,
      });
    } else selectMode(next);
  }
  function closePanel() {
    returnFocus.current = true;
    setFocusRequest((value) => value + 1);
    if (mode === "manage") setManageSelection(null);
    else request({ type: "select", id: null });
    track("solana_preview_interacted", {
      preview_mode: mode,
      preview_action: "close",
      has_local_changes: dirtyRef.current,
    });
  }
  function selectNode(id: string | null, anchor?: HTMLElement) {
    if (mode === "configure") {
      if (id !== state.selectedId) {
        if (anchor) panelAnchor.current = anchor;
        request({ type: "select", id });
      }
    } else if (id !== manageSelection) {
      if (id === null) closePanel();
      else {
        if (anchor) panelAnchor.current = anchor;
        setManageSelection(id);
        track("solana_preview_interacted", {
          preview_mode: "manage",
          preview_action: "select",
          node_kind: nodeKind(id),
          has_local_changes: dirtyRef.current,
        });
      }
    }
  }
  function apply() {
    const next = previewReducer(state, { type: "apply" });
    dispatch({ type: "apply" });
    if (next.error && selected) {
      setApplied(false);
      track("solana_preview_blocked", {
        preview_protocol: selected.protocol,
        preview_reason:
          next.error === "allocation_invalid" ? "allocation_invalid" : "allocation_total",
        has_local_changes: dirty,
      });
    } else if (selected) {
      setApplied(true);
      track("solana_preview_applied", {
        preview_protocol: selected.protocol,
        has_local_changes: next.changed,
      });
    }
  }

  return (
    <section ref={rootRef} className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-xl">{t("solanaPreview.title")}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
            {t("solanaPreview.visualOnly")}
          </p>
        </div>
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("solanaPreview.exit")}
        </Button>
      </div>
      <fieldset className="flex flex-wrap gap-2" aria-label={t("solanaPreview.title")}>
        <Button
          data-preview-mode="configure"
          variant={mode === "configure" ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={mode === "configure"}
          onClick={() => requestMode("configure")}
        >
          {t("solanaPreview.configure")}
        </Button>
        <Button
          data-preview-mode="manage"
          variant={mode === "manage" ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={mode === "manage"}
          onClick={() => requestMode("manage")}
        >
          {t("solanaPreview.localManage.title")}
        </Button>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-muted-foreground text-sm">{t("solanaPreview.addBlock")}</span>
        {PREVIEW_BLOCKS.map((protocol) => (
          <Button
            key={protocol}
            variant="secondary"
            size="sm"
            onClick={() => request({ type: "add", protocol })}
          >
            <PreviewLogo protocol={protocol} className="size-4" />
            <Plus className="size-3" aria-hidden="true" />
            {protocolNames[protocol]}
          </Button>
        ))}
        <span className="ml-auto text-muted-foreground text-sm" aria-live="polite">
          {t("solanaPreview.allocationTotal")}:{" "}
          {format.number(totalAllocationBps(state) / 10000, {
            style: "percent",
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
      <SolanaPreviewRenderBoundary
        hasLocalChanges={dirty}
        fallback={(retry) => (
          <div role="alert" className="rounded-2xl border border-border bg-surface p-5">
            <p>{t("solanaPreview.unexpectedError")}</p>
            <Button className="mt-3" onClick={retry}>
              {t("solanaPreview.tryAgain")}
            </Button>
          </div>
        )}
      >
        <div
          className={`grid min-w-0 items-start gap-4 ${panelOpen ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}
        >
          <SolanaPreviewCanvas
            blocks={state.blocks}
            context={mode}
            selectedId={mode === "manage" ? manageNode : state.selectedId}
            onSelect={selectNode}
            onRemove={(id) => {
              captureConfirmationFocus();
              setRemoveId(id);
            }}
          />
          <div className={panelOpen ? "min-w-0" : "hidden"}>
            {/* PP-INTEGRATION-POINT: local Manage receives no canonical Current, After, quote, clock or operation executor. Missing sources remain unavailable. */}
            <SolanaLocalManageHost
              blocks={state.blocks}
              selectedId={managed?.id ?? null}
              active={mode === "manage" && Boolean(managed)}
              onClose={closePanel}
              onDirtyChange={setManageDirty}
              onIntent={manageIntent}
              onApplyDrawing={applyDrawing}
            />
            {mode === "configure" && selected && state.edit ? (
              <SolanaPreviewBlockPanel
                key={selected.id}
                block={selected}
                edit={state.edit}
                error={state.error}
                applied={applied}
                onEdit={(value) => {
                  setApplied(false);
                  dispatch({ type: "edit", value });
                }}
                onApply={apply}
                onDiscard={() => perform({ type: "discard" })}
                onClose={closePanel}
                onUnavailable={() =>
                  track("solana_preview_blocked", {
                    preview_protocol: selected.protocol,
                    preview_reason: "unsupported",
                    has_local_changes: dirty,
                  })
                }
              />
            ) : null}
            {mode === "manage" && manageNode && !managed ? (
              <aside
                ref={fixedPanel}
                tabIndex={-1}
                aria-label={fixedLabel(manageNode)}
                className="min-w-0 space-y-4 rounded-[20px] border border-border bg-surface p-4 outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closePanel();
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-[15px]">{fixedLabel(manageNode)}</h2>
                    <p className="mt-1 break-words text-muted-foreground text-xs">
                      {inspectionOwner
                        ? `${protocolNames[inspectionOwner.protocol]} · ${inspectionOwner.pair} · Solana`
                        : manageNode === "bridge-in"
                          ? "Arbitrum → Solana"
                          : manageNode === "bridge-out"
                            ? "Solana → Arbitrum"
                            : `${manageNode === "operating-cash" ? t("solanaPreview.nativeSol") : "USDC"} · ${inspectionNetwork}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-11 p-0"
                    aria-label={t("solanaPreview.closePanel")}
                    onClick={closePanel}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">{t("solanaPreview.fixed")}</p>
                <p role="status" className="text-sm">
                  {t("solanaPreview.marketUnavailable")}
                </p>
              </aside>
            ) : null}
          </div>
        </div>
      </SolanaPreviewRenderBoundary>
      <ConfirmDialog
        open={pending !== null || pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setPendingMode(null);
          }
        }}
        title={t("solanaPreview.unsavedTitle")}
        body={t("solanaPreview.unsavedBody")}
        confirmLabel={t("solanaPreview.discardContinue")}
        cancelLabel={t("solanaPreview.keepEditing")}
        tone="info"
        onCloseAutoFocus={restoreConfirmationFocus}
        onConfirm={() => {
          if (confirmationFocus.current) confirmationFocus.current.confirmed = true;
          if (pending) perform(pending);
          if (pendingMode) {
            dispatch({ type: "discard" });
            selectMode(pendingMode);
          }
          setPending(null);
          setPendingMode(null);
        }}
      />
      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        title={t("solanaPreview.removeTitle")}
        body={t("solanaPreview.removeBody")}
        confirmLabel={t("solanaPreview.remove")}
        cancelLabel={t("solanaPreview.cancel")}
        onCloseAutoFocus={restoreConfirmationFocus}
        onConfirm={() => {
          if (confirmationFocus.current) confirmationFocus.current.confirmed = true;
          if (removeId) perform({ type: "remove", id: removeId });
          setRemoveId(null);
        }}
      />
    </section>
  );
}
