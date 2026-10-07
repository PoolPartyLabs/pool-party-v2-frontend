/**
 * @id PP-MGR-SCR-004
 * @name ManageScreen
 * @implements-rules-version v2 (POO-2274); v1 (POO-2226)
 * @analytics-events strategy_manage_viewed, strategy_block_selected
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
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { FundBalances, FundView } from "@/lib/api/v2/fundSchemas";
import { cn } from "@/lib/utils/cn";
import { BlockMark } from "../build/blocks/BlockMark";
import { ManageCanvas } from "./ManageCanvas";
import { type ManagePosition, manageProtocolMark, normalizeManageModel } from "./manageModel";
import {
  deriveManageInspection,
  type ManageInspectableNode,
  manageInspectionLabelKey,
  resolveManageInspection,
} from "./manageSelection";

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
  const model = useMemo(() => normalizeManageModel(fund, balances), [fund, balances]);
  const snapshot = useMemo(() => deriveManageInspection(model), [model]);
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
                  const tokens = position?.tokens.map((token) => token.symbol).join(" / ");
                  const label =
                    position?.protocol ??
                    (node.kind !== "position"
                      ? t(manageInspectionLabelKey[node.kind])
                      : t("notAvailable"));
                  return (
                    <button
                      key={node.id}
                      type="button"
                      data-manage-list-node={node.id}
                      data-manage-list-position={position?.id}
                      aria-pressed={selection === node.selectionId}
                      onClick={(event) => selectNode(node.selectionId, event.detail === 0)}
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        selection === node.selectionId ? "border-primary" : "border-border",
                      )}
                    >
                      {position ? (
                        <BlockMark
                          logo="protocol"
                          markId={manageProtocolMark(position.source.adapterKind)}
                          name={position.protocol}
                          size={24}
                        />
                      ) : null}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground text-sm">
                          {label}
                        </span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {tokens}
                          {position && position.kind !== "unsupported"
                            ? ` · ${position.kind === "supply" ? t("supplyType") : t("liquidityType")}`
                            : ""}
                        </span>
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
          <ManageCanvas model={model} selectedId={selection} onSelect={selectNode} />
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
