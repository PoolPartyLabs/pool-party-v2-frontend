/**
 * @id PP-MGR-SCR-004
 * @name ManageScreen
 * @implements-rules-version v1 (POO-2226)
 * @analytics-events strategy_manage_viewed
 *
 * Controlled V2 shell. The authorized route loader supplies reads, and each identity keeps a
 * mounted inline panel so changing selection cannot silently lose its draft.
 */
"use client";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useBuildShellLayout } from "@/components/layout/BuildShellLayout";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { FundBalances, FundView } from "@/lib/api/v2/fundSchemas";
import { cn } from "@/lib/utils/cn";
import { BlockMark } from "../build/blocks/BlockMark";
import { ManageCanvas } from "./ManageCanvas";
import { type ManagePosition, manageProtocolMark, normalizeManageModel } from "./manageModel";

export interface ManageScreenProps {
  fund: FundView;
  balances?: FundBalances[];
  panel(position: ManagePosition | null, active: boolean): ReactNode;
}
export function ManageScreen({ fund, balances, panel }: ManageScreenProps) {
  useBuildShellLayout(true);
  const t = useTranslations("manager.manageV2");
  const model = useMemo(() => normalizeManageModel(fund, balances), [fund, balances]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mandateOpen, setMandateOpen] = useState(false);
  const selection = model.positions.some((position) => position.id === selectedId)
    ? selectedId
    : null;
  const panelSlot = useRef<HTMLElement>(null);
  const focusPanel = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const lastFocusRequest = useRef(-1);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  const selectPosition = (id: string | null, keyboard = false) => {
    if (id !== null && document.activeElement instanceof HTMLElement)
      selectionTrigger.current = document.activeElement;
    focusPanel.current = keyboard && id !== null;
    if (keyboard && id !== null) setFocusRequest((request) => request + 1);
    setSelectedId(id);
  };
  useEffect(() => {
    if (!selection || !focusPanel.current || lastFocusRequest.current === focusRequest) return;
    lastFocusRequest.current = focusRequest;
    focusPanel.current = false;
    const heading = panelSlot.current?.querySelector<HTMLElement>("[data-active-manage-panel] h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [selection, focusRequest]);
  useTrackView("strategy_manage_viewed", {
    family: "v2",
    surface: "manager",
    chain_id: model.hubChainId,
  });
  return (
    <article data-manage-screen="" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{model.name}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <Link
          href={`/funds/${model.core}`}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-surface px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t("viewInvestor")}
        </Link>
      </header>
      <div
        data-manage-grid=""
        className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)_360px] xl:grid-cols-[220px_minmax(0,1fr)_360px]"
      >
        <aside className="flex min-w-0 flex-col gap-3">
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {t("strategyBlocks")}
          </h2>
          <div className="flex flex-col gap-2">
            {model.positions.map((position) => {
              const tokens = position.tokens.map((token) => token.symbol).join(" / ");
              return (
                <button
                  key={position.id}
                  type="button"
                  data-manage-list-position={position.id}
                  aria-pressed={selection === position.id}
                  onClick={(event) => selectPosition(position.id, event.detail === 0)}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    selection === position.id ? "border-primary" : "border-border",
                  )}
                >
                  <BlockMark
                    logo="protocol"
                    markId={manageProtocolMark(position.source.adapterKind)}
                    name={position.protocol}
                    size={24}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground text-sm">
                      {position.protocol}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {tokens}
                      {position.kind !== "unsupported"
                        ? ` · ${position.kind === "supply" ? t("supplyType") : t("liquidityType")}`
                        : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {model.positions.length === 0 ? (
              <p role="status" className="text-muted-foreground text-sm">
                {fund.positionsSummary ? t("emptyPositions") : t("positionsUnavailable")}
              </p>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">{t("selectionHelp")}</p>
          <Button variant="ghost" size="md" onClick={() => setMandateOpen((open) => !open)}>
            {t("viewMandate")}
          </Button>
          {mandateOpen ? (
            <section className="rounded-xl border border-border p-3 text-xs">
              <h3 className="font-semibold">{t("mandateTitle")}</h3>
              <p className="my-2 text-muted-foreground">{t("mandateReadOnly")}</p>
              <dl className="flex flex-col gap-1">
                <dt>{t("mandateCore")}</dt>
                <dd className="break-all font-mono">{fund.coreVault}</dd>
                <dt>{t("mandateHash")}</dt>
                <dd className="break-all font-mono">{fund.mandateHash}</dd>
              </dl>
            </section>
          ) : null}
        </aside>
        <div className="min-w-0">
          <ManageCanvas model={model} selectedId={selection} onSelect={selectPosition} />
        </div>
        <section
          ref={panelSlot}
          data-manage-panel-slot=""
          aria-label={t("manageBlock")}
          className="min-w-0 self-start"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              selectionTrigger.current?.focus();
              event.stopPropagation();
            }
          }}
        >
          <div hidden={selection !== null}>{panel(null, selection === null)}</div>
          {model.positions.map((position) => (
            <div
              key={position.id}
              hidden={selection !== position.id}
              data-active-manage-panel={selection === position.id ? "" : undefined}
            >
              {panel(position, selection === position.id)}
            </div>
          ))}
        </section>
      </div>
    </article>
  );
}
