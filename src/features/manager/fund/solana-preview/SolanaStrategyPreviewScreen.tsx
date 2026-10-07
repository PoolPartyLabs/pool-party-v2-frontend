/**
 * @id PP-MGR-SCR-009
 * @name SolanaStrategyPreviewScreen
 * @description In-memory protocol configuration, guarded edits and local intent analytics.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-2725
 * @linear https://linear.app/yeildbay/issue/POO-2281
 * @i18n-namespace manager.solanaPreview
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events solana_preview_viewed, solana_preview_started, solana_preview_applied, solana_preview_abandoned, solana_preview_blocked
 */
"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import { SolanaPreviewBlockPanel } from "./SolanaPreviewBlockPanel";
import { PreviewLogo, SolanaPreviewCanvas } from "./SolanaPreviewCanvas";
import { SolanaPreviewRenderBoundary } from "./SolanaPreviewErrorBoundary";

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
  const rootRef = useRef<HTMLElement>(null);
  const confirmationFocus = useRef<{ origin: HTMLElement | null; confirmed: boolean } | null>(null);
  const viewed = useRef(false);
  const started = useRef(false);
  const dirty = state.changed || hasUnappliedChanges(state);
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
    const heading = rootRef.current?.querySelector<HTMLElement>("#solana-preview-configure");
    const target = !focus?.confirmed && focus?.origin?.isConnected ? focus.origin : heading;
    (target ?? rootRef.current?.querySelector<HTMLElement>("button"))?.focus();
  }

  function perform(action: PreviewAction) {
    if (action.type === "add" && !started.current) {
      started.current = true;
      track("solana_preview_started", { preview_protocol: action.protocol });
    }
    setApplied(false);
    dispatch(action);
  }
  function request(action: PreviewAction) {
    if (hasUnappliedChanges(state)) {
      captureConfirmationFocus();
      setPending(action);
      track("solana_preview_blocked", {
        preview_reason: "unapplied_changes",
        has_local_changes: true,
      });
    } else perform(action);
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
          className={`grid min-w-0 items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}
        >
          <SolanaPreviewCanvas
            blocks={state.blocks}
            selectedId={state.selectedId}
            onSelect={(id) => {
              if (id !== state.selectedId) request({ type: "select", id });
            }}
            onRemove={(id) => {
              captureConfirmationFocus();
              setRemoveId(id);
            }}
          />
          {selected && state.edit ? (
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
              onClose={() => request({ type: "select", id: null })}
              onUnavailable={() =>
                track("solana_preview_blocked", {
                  preview_protocol: selected.protocol,
                  preview_reason: "unsupported",
                  has_local_changes: dirty,
                })
              }
            />
          ) : null}
        </div>
      </SolanaPreviewRenderBoundary>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
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
          setPending(null);
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
