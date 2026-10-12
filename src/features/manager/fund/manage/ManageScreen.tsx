/**
 * @id PP-MGR-SCR-004
 * @name ManageScreen
 * @implements-rules-version v2 (POO-2274); v1 (POO-2226)
 * @implements-rules-version v1 (POO-2309 market-reference chart)
 * @implements-rules-version v1 (POO-2335 spine card copy, Explorer and View mandate)
 * @analytics-events strategy_manage_viewed, strategy_block_selected
 *
 * Controlled V2 shell. The authorized route loader supplies reads, and each identity keeps a
 * mounted inline panel so changing selection cannot silently lose its draft.
 */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useBuildShellLayout } from "@/components/layout/BuildShellLayout";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { FundBalances, FundView } from "@/lib/api/v2/fundSchemas";
import { cn } from "@/lib/utils/cn";
import { manageChartSelection } from "../charts/chartContext";
import { StrategyChartSurface } from "../charts/StrategyChartSurface";
import { ManageCanvas } from "./ManageCanvas";
import { type ManagePosition, normalizeManageModel } from "./manageModel";
import {
  deriveManageInspection,
  type ManageInspectableNode,
  manageInspectionLabelKey,
  resolveManageInspection,
} from "./manageSelection";
import {
  MANAGE_PERCENT_FORMAT,
  type ManageSpineCopy,
  manageSpineCard,
  manageStrategyLinks,
} from "./manageSpineCopy";

export interface ManageScreenProps {
  fund: FundView;
  balances?: FundBalances[];
  panel(
    position: ManagePosition | null,
    active: boolean,
    inspection?: ManageInspectableNode | null,
    onBack?: () => void,
  ): ReactNode;
  inspector?(node: ManageInspectableNode, onBack: () => void): ReactNode;
}
export function ManageScreen({ fund, balances, panel, inspector }: ManageScreenProps) {
  useBuildShellLayout(true);
  const t = useTranslations("manager.manageV2");
  const root = useTranslations("manager");
  const fmt = useFormatter();
  const spineCopy: ManageSpineCopy = {
    t: (key, values) => root(key, values),
    percent: (value) => fmt.number(value / 100, MANAGE_PERCENT_FORMAT),
    usd: (value) => fmt.number(value, { style: "currency", currency: "USD" }),
    amount: (decimal) => fmt.number(Number(decimal), { maximumFractionDigits: 4 }),
  };
  const model = useMemo(() => normalizeManageModel(fund, balances), [fund, balances]);
  const snapshot = useMemo(() => deriveManageInspection(model), [model]);
  const links = manageStrategyLinks(model.core, model.hubChainId);
  const { track } = useAnalytics();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mandateOpen, setMandateOpen] = useState(false);
  const selectedCore = useRef(model.core);
  const inspection =
    selectedCore.current === model.core ? resolveManageInspection(snapshot, selectedId) : null;
  const selection = inspection?.selectionId ?? null;
  const panelSlot = useRef<HTMLElement>(null);
  const blocksHeading = useRef<HTMLHeadingElement>(null);
  const history = useRef<
    Array<{ id: string | null; trigger: HTMLElement | null; invalid?: boolean }>
  >([]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const shouldReturnFocus = useRef(false);
  const focusPanel = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const lastFocusRequest = useRef(-1);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  const selectNode = (id: string | null, keyboard = false) => {
    const node = resolveManageInspection(snapshot, id);
    if (id !== selection)
      history.current.push({ id: selection, trigger: selectionTrigger.current });
    if (id !== null && document.activeElement instanceof HTMLElement)
      selectionTrigger.current = document.activeElement;
    focusPanel.current = keyboard && id !== null;
    if (keyboard && id !== null) setFocusRequest((request) => request + 1);
    setSelectedId(node?.selectionId ?? null);
    if (node)
      track("strategy_block_selected", {
        family: "v2",
        surface: "manager",
        node_kind: node.kind,
        chain_id: node.chainId,
      });
  };
  const backToBlocks = () => {
    const previous = history.current.pop();
    const previousNode = resolveManageInspection(snapshot, previous?.id ?? null);
    setSelectedId(previousNode?.selectionId ?? null);
    returnFocus.current = previousNode
      ? (previous?.trigger ?? null)
      : previous?.id || previous?.invalid
        ? null
        : selectionTrigger.current;
    selectionTrigger.current = previousNode ? (previous?.trigger ?? null) : null;
    shouldReturnFocus.current = true;
    setFocusRequest((request) => request + 1);
  };
  useEffect(() => {
    if (
      selectedCore.current !== model.core ||
      (selectedId !== null && !resolveManageInspection(snapshot, selectedId))
    ) {
      selectedCore.current = model.core;
      history.current = [];
      selectionTrigger.current = null;
      returnFocus.current = null;
      shouldReturnFocus.current = selectedId !== null;
      focusPanel.current = false;
      if (selectedId !== null) setFocusRequest((request) => request + 1);
      setSelectedId(null);
    } else {
      history.current = history.current.map((entry) =>
        entry.id && !resolveManageInspection(snapshot, entry.id)
          ? { id: null, trigger: null, invalid: true }
          : entry,
      );
    }
  }, [model.core, snapshot, selectedId]);
  useEffect(() => {
    if (shouldReturnFocus.current) {
      shouldReturnFocus.current = false;
      const target = returnFocus.current;
      (target?.isConnected ? target : blocksHeading.current)?.focus();
      return;
    }
    if (!selection || !focusPanel.current || lastFocusRequest.current === focusRequest) return;
    lastFocusRequest.current = focusRequest;
    focusPanel.current = false;
    const heading = [
      ...(panelSlot.current?.querySelectorAll<HTMLElement>("[data-active-manage-panel] h2") ?? []),
    ].find((candidate) => !candidate.closest("[hidden]"));
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
          <h2
            ref={blocksHeading}
            tabIndex={-1}
            className="font-semibold text-muted-foreground text-xs uppercase tracking-wide"
          >
            {t("strategyBlocks")}
          </h2>
          <div className="flex flex-col gap-2">
            {snapshot.networks.map((network) => (
              <div
                key={network.chainId}
                data-manage-network={network.chainId}
                className="flex flex-col gap-2"
              >
                <h3 className="text-muted-foreground text-xs">
                  {network.name} · {t(network.hub ? "inspection.hub" : "inspection.spoke")}
                </h3>
                {network.nodes.map((node) => {
                  const position = node.kind === "position" ? node.position : null;
                  // R1 to R4 and R8: the spine card copy comes from the read model.
                  const card = manageSpineCard(node, model, spineCopy);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      data-manage-list-node={node.id}
                      data-manage-list-position={position?.id}
                      aria-pressed={selection === node.selectionId}
                      onClick={(event) => selectNode(node.selectionId, event.detail === 0)}
                      className={cn(
                        "flex min-h-16 flex-col justify-center gap-0.5 rounded-xl border bg-surface px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        selection === node.selectionId ? "border-primary" : "border-border",
                      )}
                    >
                      <span className="block truncate font-medium text-foreground text-sm">
                        {card.title}
                      </span>
                      <span className="flex min-w-0 items-start gap-1.5 text-muted-foreground text-xs">
                        {card.range ? (
                          <span
                            aria-hidden="true"
                            data-manage-list-range={card.range.tone}
                            className={cn(
                              "mt-1.5 size-1.5 shrink-0 rounded-full",
                              card.range.tone === "success"
                                ? "bg-success"
                                : card.range.tone === "destructive"
                                  ? "bg-destructive"
                                  : "bg-muted-foreground",
                            )}
                          />
                        ) : null}
                        <span className="line-clamp-2 min-w-0">{card.subtitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {model.positions.length === 0 ? (
              <p role="status" className="text-muted-foreground text-sm">
                {fund.positionsSummary ? t("emptyPositions") : t("positionsUnavailable")}
              </p>
            ) : null}
          </div>
          {/* R5: Explorer link to the strategy address, or Not available with the reason. */}
          <div data-manage-explorer={links.explorer.status} className="flex flex-col gap-1 text-xs">
            <p className="text-muted-foreground">
              {t("explorer")} ·{" "}
              {links.explorer.status === "available" ? (
                <a
                  href={links.explorer.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {links.explorer.label}
                </a>
              ) : (
                t("notAvailable")
              )}
            </p>
            {links.explorer.status === "unavailable" ? (
              <p className="text-muted-foreground">{t("strategyAddressUnavailable")}</p>
            ) : null}
          </div>
          {/* R6: View mandate always shows below the Explorer block. */}
          <Button
            variant="ghost"
            size="md"
            aria-expanded={mandateOpen}
            onClick={() => setMandateOpen((open) => !open)}
            className="self-start px-0 text-primary hover:bg-transparent hover:text-primary"
          >
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
          <StrategyChartSurface
            selection={manageChartSelection(inspection?.position ?? null)}
            context="manage"
          >
            <ManageCanvas model={model} selectedId={selection} onSelect={selectNode} />
          </StrategyChartSurface>
        </div>
        <section
          ref={panelSlot}
          data-manage-panel-slot=""
          aria-label={t("manageBlock")}
          className="min-w-0 self-start"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              backToBlocks();
              event.stopPropagation();
            }
          }}
        >
          <div hidden={selection !== null}>{panel(null, selection === null)}</div>
          {model.positions.map((position) => (
            <div
              key={position.id}
              hidden={inspection?.position?.id !== position.id}
              data-active-manage-panel={inspection?.position?.id === position.id ? "" : undefined}
            >
              {panel(
                position,
                inspection?.position?.id === position.id,
                inspection?.position?.id === position.id ? inspection : null,
                backToBlocks,
              )}
            </div>
          ))}
          {inspection && !inspection.position ? (
            <div data-active-manage-panel="">
              {inspector ? (
                inspector(inspection, backToBlocks)
              ) : (
                <div className="flex flex-col gap-3">
                  <h2 className="font-semibold text-foreground text-lg">{t("manageBlock")}</h2>
                  <p>
                    {inspection.kind !== "position"
                      ? t(manageInspectionLabelKey[inspection.kind])
                      : t("notAvailable")}
                  </p>
                  <p className="text-muted-foreground text-sm">{t("notAvailable")}</p>
                  <Button variant="ghost" onClick={backToBlocks}>
                    {t("inspection.backToBlocks")}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </article>
  );
}
