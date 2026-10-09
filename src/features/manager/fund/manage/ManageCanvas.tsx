/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas
 * @implements-rules-version v2 (POO-2274, POO-2270, POO-2271, POO-2272; extends POO-2246, POO-2226, POO-2232)
 * @implements-rules-version v1 (POO-2302, painted surface bounds)
 * @analytics-events none, node presses report through onSelect; ManageScreen owns navigation.
 *
 * Read-only live graph built from the shared Build pieces. Cash belongs to one chain and every
 * balance has its own availability state. Inspecting a node never alters graph geometry.
 */
"use client";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { formatPercent, formatTokenAmount, formatUsdTile } from "@/lib/utils/format";
import { BlockMark } from "../build/blocks/BlockMark";
import { CanvasViewport, type CanvasViewportHandle } from "../build/canvas/CanvasViewport";
import {
  useFinancialGraphEngine,
  useFinancialGraphPresentation,
} from "../build/graph/ReactFlowGraph";
import type {
  FinancialGraphDecoration,
  FinancialGraphPresentation,
} from "../build/graph/reactFlowProjection";
import { FlowPill } from "../build/pieces/FlowPill";
import { GraphEdges } from "../build/pieces/GraphEdges";
import { CardCopy, PieceStroke } from "../build/pieces/pieceParts";
import { SpineCard } from "../build/pieces/SpineCard";
import { SpokeGroup } from "../build/pieces/SpokeGroup";
import {
  layoutManageGraph,
  type ManageLayout,
  type ManageMeasurements,
  type ManageNode,
} from "./manageLayout";
import {
  type ManageModel,
  type ManagePosition,
  type ManageRead,
  type ManageToken,
  type ManageTokenAmount,
  manageProtocolMark,
} from "./manageModel";
import {
  deriveManageInspection,
  type ManageInspectableNode,
  manageInspectionLabelKey,
} from "./manageSelection";

export interface ManageCanvasProps {
  model: ManageModel;
  selectedId: string | null;
  onSelect(selectionId: string | null, keyboard?: boolean): void;
}

/** Display-only conversion; exact decimal amount remains accessible and no arithmetic uses Number. */
export function ManageTokenRow({ token }: { token: ManageToken }) {
  const t = useTranslations("manager.manageV2");
  const amount = token.amount;
  const exact =
    amount.status === "available" ? `${amount.value.decimal} ${token.symbol}` : t("notAvailable");
  const text =
    amount.status === "available"
      ? formatTokenAmount(Number(amount.value.decimal), "").trim()
      : t("notAvailable");
  return (
    <div className="flex min-w-0 items-center justify-between gap-1.5 text-xs">
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        <TokenLogo symbol={token.symbol} className="size-4 text-[10px]" />
        <span className="text-muted-foreground">{token.symbol}</span>
      </span>
      <span
        title={exact}
        className={`min-w-0 text-right font-semibold text-foreground tabular-nums ${amount.status === "available" ? "break-all" : "break-words"}`}
      >
        <span aria-hidden="true">{text}</span>
        <span className="sr-only">{exact}</span>
      </span>
    </div>
  );
}
export function ManageUsd({ read }: { read: ManageRead<string> }) {
  const t = useTranslations("manager.manageV2");
  return (
    <span
      title={read.status === "available" ? `${read.value} USD` : undefined}
      className="font-semibold text-foreground tabular-nums"
    >
      {read.status === "available" ? formatUsdTile(Number(read.value)) : t("notAvailable")}
    </span>
  );
}
function PositionHoldings({ position }: { position: ManagePosition }) {
  const t = useTranslations("manager.manageV2");
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      {position.tokens.map((token) => (
        <ManageTokenRow key={`${token.chainId}:${token.address}:${token.symbol}`} token={token} />
      ))}
      <div className="mt-1 border-border border-t pt-2 text-xs">
        <div className="text-muted-foreground">{t("totalValue")}</div>
        <ManageUsd read={position.valueUsd} />
      </div>
    </div>
  );
}
/** Decorative status track. Its fixed center marker conveys no price, allocation or percentage. */
function PositionRangeStatus({
  status,
  id,
}: {
  status: ManagePosition["rangeStatus"];
  id: string;
}) {
  const operate = useTranslations("manager.operate");
  const t = useTranslations("manager.manageV2");
  const available = status.status === "available";
  const inRange = available && status.value === "in";
  return (
    <div
      data-manage-range=""
      className={`mx-auto mt-auto mb-3 flex w-[148px] shrink-0 flex-col gap-1.5 ${available ? (inRange ? "text-success" : "text-destructive") : "text-muted-foreground"}`}
    >
      <span id={id} className="flex items-center gap-1.5 text-foreground text-xs">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${available ? (inRange ? "bg-success" : "bg-destructive") : "bg-muted-foreground"}`}
        />
        {available ? operate(inRange ? "inRange" : "outOfRange") : t("notAvailable")}
      </span>
      <svg aria-hidden="true" width={148} height={10} viewBox="0 0 148 10">
        <rect data-range-track="" y={3} width={148} height={4} rx={2} fill="currentColor" />
        <rect data-range-marker="" x={73} width={2} height={10} fill="var(--color-foreground)" />
      </svg>
    </div>
  );
}
function PositionNode({
  position,
  selected,
  onSelect,
  minimumHeight,
}: {
  position: ManagePosition;
  selected: boolean;
  onSelect(keyboard?: boolean): void;
  minimumHeight: number;
}) {
  const t = useTranslations("manager.manageV2");
  const statusId = useId();
  const tokens = position.tokens.map((token) => token.symbol).join(" / ");
  const title =
    position.kind === "supply" ? t("supplyToken", { token: tokens }) : tokens || position.protocol;
  const name = t("positionName", {
    protocol: position.protocol,
    tokens,
    network: position.network,
  });
  return (
    <button
      type="button"
      data-canvas-interactive=""
      data-manage-position={position.id}
      data-manage-surface=""
      style={{ minHeight: minimumHeight }}
      aria-label={name}
      aria-describedby={position.kind === "liquidity" ? statusId : undefined}
      aria-pressed={selected}
      onClick={(event) => onSelect(event.detail === 0)}
      className="relative flex w-full cursor-pointer flex-col rounded-lg bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <PieceStroke
        width={selected ? 2 : 1}
        radius={16}
        className={selected ? "text-primary" : "text-border"}
      />
      <div
        data-manage-natural=""
        className="flex w-full flex-col"
        style={{ minHeight: position.kind === "liquidity" ? 232 : 160 }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none flex min-h-[62px] w-full shrink-0 items-center gap-2.5 px-[13px] py-[11px]"
        >
          <BlockMark
            logo="protocol"
            markId={manageProtocolMark(position.source.adapterKind)}
            name={position.protocol}
            size={28}
          />
          <CardCopy title={title} caption={position.protocol} captionTone="text-muted-foreground" />
        </div>
        <PositionHoldings position={position} />
        {position.kind === "liquidity" ? (
          <PositionRangeStatus id={statusId} status={position.rangeStatus} />
        ) : null}
      </div>
    </button>
  );
}
function BalanceCard({
  title,
  locked = false,
  children,
  minimumHeight,
}: {
  title: string;
  locked?: boolean;
  children: ReactNode;
  minimumHeight: number;
}) {
  return (
    <div
      data-canvas-interactive=""
      data-manage-surface=""
      style={{ minHeight: minimumHeight }}
      className="relative w-full rounded-lg bg-surface"
    >
      <PieceStroke width={1} radius={16} className="text-border" />
      <div data-manage-natural="" className="flex w-full flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="min-w-0 break-words font-medium text-foreground text-xs">{title}</h3>
          {locked ? (
            <Lock
              data-manage-lock=""
              aria-hidden="true"
              size={14}
              strokeWidth={2.5}
              className="shrink-0 text-muted-foreground"
            />
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
function CashNode({
  model,
  chainId,
  minimumHeight,
}: {
  model: ManageModel;
  chainId: number;
  minimumHeight: number;
}) {
  const t = useTranslations("manager.manageV2");
  const chain = model.chains.find((item) => item.chainId === chainId);
  if (!chain) return null;
  const native = chain.cash.find((token) => token.address === null && token.chainId === chainId);
  return (
    <div
      data-manage-cash={chainId}
      data-manage-surface=""
      style={{ minHeight: minimumHeight }}
      data-canvas-interactive=""
      className="relative w-full rounded-lg bg-surface"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-chart-periwinkle/16"
      />
      <PieceStroke width={1} radius={16} className="text-chart-periwinkle/42" />
      <div data-manage-natural="" className="relative flex w-full flex-col gap-2 p-3">
        <h3 className="break-words font-medium text-foreground text-sm leading-[21px]">
          {t("operatingCash")}
        </h3>
        <div className="flex flex-col gap-1">
          {native ? (
            <div className="min-h-[21px]">
              <ManageTokenRow token={native} />
            </div>
          ) : null}
          <div
            data-cash-usd=""
            className="min-h-[18px] text-right text-xs leading-[18px]"
            aria-live="polite"
          >
            {native?.amount.status === "available" && native.valueUsd?.status === "available" ? (
              <ManageUsd read={native.valueUsd} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
function AmountLabel({ read }: { read: ManageRead<ManageTokenAmount> }) {
  const t = useTranslations("manager.manageV2");
  return (
    <span
      className={`min-w-0 font-semibold text-right tabular-nums ${read.status === "available" ? "break-all" : "break-words"}`}
      title={read.status === "available" ? `${read.value.decimal} ${read.value.symbol}` : undefined}
    >
      {read.status === "available"
        ? formatTokenAmount(Number(read.value.decimal), read.value.symbol)
        : t("notAvailable")}
    </span>
  );
}
function WithdrawalNode({ model, minimumHeight }: { model: ManageModel; minimumHeight: number }) {
  const t = useTranslations("manager.manageV2");
  const rows = [
    [t("withdrawalRequests"), model.withdrawal.requested],
    [t("reserved"), model.withdrawal.reserved],
    [t("stillNeeded"), model.withdrawal.stillNeeded],
  ] as const;
  return (
    <BalanceCard title={t("idleOutput")} locked minimumHeight={minimumHeight}>
      <dl className="flex flex-col gap-2 text-[11px]">
        {rows.map(([label, read]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0">
              <AmountLabel read={read} />
            </dd>
          </div>
        ))}
      </dl>
      {model.withdrawal.coveragePct.status === "available" ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          {t("coverage", { pct: Number(model.withdrawal.coveragePct.value) })}
        </p>
      ) : null}
    </BalanceCard>
  );
}
function GraphNode({
  node,
  inspection,
  model,
  selectedId,
  onSelect,
  groupPart = "all",
}: {
  node: ManageNode;
  inspection: ManageInspectableNode | null;
  model: ManageModel;
  selectedId: string | null;
  onSelect(id: string, keyboard?: boolean): void;
  groupPart?: "all" | "body" | "chip";
}) {
  const t = useTranslations("manager.manageV2");
  const build = useTranslations("manager");
  const chain = model.chains.find((item) => item.chainId === node.chainId);
  const hub = model.chains.find((item) => item.hub);
  const keyboardActivation = useRef(false);
  const selected = inspection?.selectionId === selectedId;
  const selectable = (content: ReactNode) => (
    <button
      type="button"
      data-canvas-interactive=""
      aria-label={
        inspection && inspection.kind !== "position"
          ? t(manageInspectionLabelKey[inspection.kind])
          : undefined
      }
      aria-pressed={selected}
      onClick={(event) => onSelect(inspection?.selectionId ?? node.id, event.detail === 0)}
      className={`relative block w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? "ring-2 ring-primary" : ""}`}
    >
      {content}
    </button>
  );
  if (node.kind === "position") {
    const p = model.positions.find((p) => p.id === node.positionId);
    return p ? (
      <PositionNode
        position={p}
        selected={p.id === selectedId}
        minimumHeight={node.rect.h}
        onSelect={(keyboard) => onSelect(p.id, keyboard)}
      />
    ) : null;
  }
  if (node.kind === "cash")
    return selectable(
      <CashNode
        model={model}
        chainId={node.chainId ?? model.hubChainId}
        minimumHeight={node.rect.h}
      />,
    );
  if (node.kind === "idle")
    return chain
      ? selectable(
          <BalanceCard
            title={chain.hub ? t("idleInput") : t("idle")}
            locked={chain.hub}
            minimumHeight={node.rect.h}
          >
            <ManageTokenRow token={chain.idle} />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{t("strategyValueShare")}</span>
              <span className="font-semibold tabular-nums">
                {chain.idleSharePct.status === "available"
                  ? formatPercent(Number(chain.idleSharePct.value), 1)
                  : t("notAvailable")}
              </span>
            </div>
          </BalanceCard>,
        )
      : null;
  if (node.kind === "group")
    return chain ? (
      <SpokeGroup
        width={node.rect.w}
        height={node.rect.h}
        networkName={chain.name}
        context="manage"
        part={groupPart}
        networkLogo={<NetworkLogo network={chain.network} name={chain.name} size={20} />}
        chipTooltip={chain.name}
      />
    ) : null;
  if (node.kind === "withdrawal")
    return selectable(<WithdrawalNode model={model} minimumHeight={node.rect.h} />);
  if (node.kind === "income")
    return selectable(
      <BalanceCard title={t("income")} locked minimumHeight={node.rect.h}>
        <div className="text-muted-foreground text-xs">{hub?.name}</div>
        <ManageTokenRow token={model.income} />
      </BalanceCard>,
    );
  if (node.kind === "flow") {
    const flow = node.flow;
    const label =
      flow === "collectFees"
        ? build("fundBuilder.canvas.flow.collectFees")
        : flow === "bridge"
          ? build("fundBuilder.canvas.flow.bridgeAuto")
          : build("fundBuilder.canvas.flow.swapAuto");
    return (
      <div
        onClickCapture={(event) => {
          keyboardActivation.current = event.detail === 0;
        }}
      >
        <FlowPill
          selected={selected}
          onActivate={() =>
            onSelect(inspection?.selectionId ?? node.id, keyboardActivation.current)
          }
          locked={flow !== "collectFees"}
          content={{
            text: label,
            tooltip: label,
            icon: flow === "collectFees" ? "coins" : flow === "bridge" ? "bridge" : "swap",
          }}
        />
      </div>
    );
  }
  return selectable(
    <SpineCard
      title={
        node.kind === "deposit"
          ? build("fundBuilder.canvas.spine.deposit.title")
          : build("fundBuilder.canvas.spine.withdraw.title")
      }
      caption={`${hub?.idle.symbol ?? ""} · ${hub?.name ?? ""}`}
      icon={node.kind === "deposit" ? "depositIn" : "withdrawOut"}
      locked
    />,
  );
}
export function ManageCanvas({ model, selectedId, onSelect }: ManageCanvasProps) {
  const t = useTranslations("manager");
  const hub = model.chains.find((chain) => chain.chainId === model.hubChainId && chain.hub);
  const [measurements, setMeasurements] = useState<ManageMeasurements>({});
  const baseLayout = useMemo(() => layoutManageGraph(model), [model]);
  const baseWidths = useRef(new Map<string, number>());
  baseWidths.current = new Map(baseLayout.nodes.map((node) => [node.id, node.rect.w]));
  const layout = useMemo(() => layoutManageGraph(model, measurements), [model, measurements]);
  const viewport = useRef<CanvasViewportHandle>(null);
  const surfaceElements = useRef(new Map<string, HTMLElement>());
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const measure = useCallback((entries: ResizeObserverEntry[] = []) => {
    const values: Record<string, { width: number; height: number }> = {};
    for (const element of surfaceElements.current.values()) {
      const id = element.dataset.manageMeasure;
      if (!id) continue;
      const natural = element.querySelector<HTMLElement>("[data-manage-natural]") ?? element;
      const entry = entries.find((value) => value.target === natural);
      const box = entry?.borderBoxSize?.[0];
      // client/scroll dimensions and ResizeObserver boxes are in unscaled CSS pixels.
      let width = Math.max(box?.inlineSize ?? natural.clientWidth, natural.scrollWidth);
      const baseWidth = baseWidths.current.get(id);
      if (natural !== element && baseWidth) {
        const previousWidth = natural.style.getPropertyValue("width");
        const previousPriority = natural.style.getPropertyPriority("width");
        try {
          // Probe under the design width: w-full otherwise inherits the last expanded card and
          // cannot report that shorter content fits again. Restore before reading natural height.
          natural.style.setProperty("width", `${baseWidth}px`);
          const intrinsicWidth = Math.max(natural.clientWidth, natural.scrollWidth);
          if (intrinsicWidth > 0) width = intrinsicWidth;
        } finally {
          if (previousWidth) natural.style.setProperty("width", previousWidth, previousPriority);
          else natural.style.removeProperty("width");
        }
      }
      let height = Math.max(box?.blockSize ?? natural.clientHeight, natural.scrollHeight);
      if (natural === element) {
        const piece = element.querySelector<HTMLElement>("[data-flow-pill], [data-spine-card]");
        if (piece) {
          const style = getComputedStyle(piece);
          const extra = [
            style.paddingTop,
            style.paddingBottom,
            style.borderTopWidth,
            style.borderBottomWidth,
          ].reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
          // Pill/spine rows stretch to the resolved rect. Their direct content remains natural.
          const children = [...piece.children].filter(
            (child) => getComputedStyle(child).position !== "absolute",
          );
          height =
            Math.max(
              0,
              ...children.map((child) => Math.max(child.clientHeight, child.scrollHeight)),
            ) + extra;
        }
      }
      if (width > 0 && height > 0)
        values[id] = { width: Math.ceil(width), height: Math.ceil(height) };
    }
    setMeasurements((previous) => {
      const changed = Object.entries(values).some(
        ([id, value]) =>
          previous[id]?.width !== value.width || previous[id]?.height !== value.height,
      );
      return changed ? { ...previous, ...values } : previous;
    });
  }, []);
  const registerSurface = useCallback(
    (id: string, element: HTMLElement | null) => {
      const previous = surfaceElements.current.get(id);
      if (previous)
        for (const target of naturalMeasurementTargets(previous))
          resizeObserver.current?.unobserve(target);
      if (!element) {
        surfaceElements.current.delete(id);
        return;
      }
      surfaceElements.current.set(id, element);
      for (const target of naturalMeasurementTargets(element))
        resizeObserver.current?.observe(target);
      // Engine surfaces mount after the registration effect, so observe each actual mount too.
      queueMicrotask(() => measure());
    },
    [measure],
  );
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => measure(entries));
    resizeObserver.current = observer;
    for (const element of surfaceElements.current.values())
      for (const target of naturalMeasurementTargets(element)) observer.observe(target);
    return () => {
      resizeObserver.current = null;
      observer.disconnect();
    };
  }, [measure]);
  return (
    <CanvasViewport
      engine="react-flow"
      graphSize={{ width: layout.width, height: layout.height }}
      initialScale={1}
      viewportRef={viewport}
      onBackgroundClick={() => onSelect(null)}
      overlay={
        hub ? (
          <div
            data-manage-hub=""
            className="absolute top-6 right-6 flex max-w-[calc(100%-3rem)] min-h-[33px] flex-wrap items-center justify-end gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm"
          >
            <NetworkLogo network={hub.network} name={hub.name} size={20} />
            <span className="min-w-0 break-words font-semibold text-foreground">
              {t("fundBuilder.networks.hub")} · {hub.name}
            </span>
            <Lock
              aria-hidden="true"
              size={14}
              strokeWidth={2.5}
              className="shrink-0 text-muted-foreground"
            />
          </div>
        ) : undefined
      }
    >
      <ManageGraphRenderer
        model={model}
        layout={layout}
        selectedId={selectedId}
        onSelect={onSelect}
        viewport={viewport}
        registerSurface={registerSurface}
        onSurfaceContentCommit={measure}
      />
    </CanvasViewport>
  );
}

/** Observe intrinsic content, never a surface constrained by its last resolved height. */
function naturalMeasurementTargets(element: HTMLElement): Element[] {
  const natural = element.querySelector<HTMLElement>("[data-manage-natural]");
  if (natural) return [natural];
  const piece = element.querySelector<HTMLElement>("[data-flow-pill], [data-spine-card]");
  return piece
    ? [...piece.children].filter((child) => getComputedStyle(child).position !== "absolute")
    : [element];
}

interface ManageGraphRendererProps extends ManageCanvasProps {
  layout: ManageLayout;
  viewport: RefObject<CanvasViewportHandle | null>;
  registerSurface(id: string, element: HTMLElement | null): void;
  onSurfaceContentCommit(): void;
}

function ManageGraphSurface({
  node,
  engine,
  registerSurface,
  children,
  viewport,
  onSurfaceContentCommit,
}: {
  node: ManageNode;
  engine: boolean;
  registerSurface: ManageGraphRendererProps["registerSurface"];
  viewport: ManageGraphRendererProps["viewport"];
  children: ReactNode;
  onSurfaceContentCommit: ManageGraphRendererProps["onSurfaceContentCommit"];
}) {
  const measuredRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (node.kind !== "group") registerSurface(node.id, element);
    },
    [node.id, node.kind, registerSurface],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the engine applies a replacement surface in a later commit than the parent model; measure its new DOM content here.
  useEffect(() => {
    if (node.kind !== "group") onSurfaceContentCommit();
  }, [children, node.kind, onSurfaceContentCommit]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Descendant focus reveals its card; the wrapper has no action.
    <div
      data-manage-node={node.id}
      onFocus={() => {
        if (node.kind !== "group") viewport.current?.revealRect(node.rect);
      }}
      className={
        engine
          ? "relative"
          : node.kind === "group"
            ? "absolute [&_[data-network-chip]]:z-[4]"
            : "absolute z-[2]"
      }
      style={{
        left: engine ? 0 : node.rect.x,
        top: engine ? 0 : node.rect.y,
        width: node.rect.w,
        height: node.rect.h,
      }}
    >
      <div
        ref={measuredRef}
        data-manage-measure={node.kind === "group" ? undefined : node.id}
        style={
          node.kind === "group"
            ? { height: node.rect.h }
            : ({
                minHeight: node.rect.h,
                "--manage-surface-height": `${node.rect.h}px`,
              } as CSSProperties)
        }
        className="w-full [&>button]:min-h-[inherit] [&>div]:min-h-[inherit] [&_.truncate]:overflow-visible [&_.truncate]:text-clip [&_.truncate]:break-words [&_.truncate]:whitespace-normal [&_[data-flow-pill]]:h-auto [&_[data-flow-pill]]:min-h-[var(--manage-surface-height)] [&_[data-flow-pill]]:w-full [&_[data-flow-pill]]:whitespace-normal [&_[data-spine-card]]:h-auto [&_[data-spine-card]]:min-h-[var(--manage-surface-height)] [&_[data-spine-card]]:w-full"
      >
        {children}
      </div>
    </div>
  );
}

/** Existing cards become identified engine nodes. Native callers retain their previous renderer. */
function ManageGraphRenderer({
  model,
  layout,
  selectedId,
  onSelect,
  viewport,
  registerSurface,
  onSurfaceContentCommit,
}: ManageGraphRendererProps) {
  const engine = useFinancialGraphEngine();
  const inspection = useMemo(() => deriveManageInspection(model, layout), [model, layout]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const highlightedIds = useMemo(
    () =>
      new Set(
        layout.hoverRoutes.find((route) => route.connectionIds.includes(hoveredId ?? ""))
          ?.connectionIds ?? (hoveredId ? [hoveredId] : []),
      ),
    [layout.hoverRoutes, hoveredId],
  );
  const presentation = useMemo<FinancialGraphPresentation>(() => {
    const surfaces = new Map<string, ReactNode>();
    const decorations: FinancialGraphDecoration[] = [];
    const readingOrder: string[] = [];
    for (const node of layout.nodes) {
      const content = (
        <GraphNode
          node={node}
          inspection={inspection.nodes.find((item) => item.id === node.id) ?? null}
          model={model}
          selectedId={selectedId}
          groupPart={engine && node.kind === "group" ? "body" : "all"}
          onSelect={(id, keyboard) => (keyboard ? onSelect(id, true) : onSelect(id))}
        />
      );
      const surface = (
        <ManageGraphSurface
          key={node.id}
          node={node}
          engine={engine}
          registerSurface={registerSurface}
          onSurfaceContentCommit={onSurfaceContentCommit}
          viewport={viewport}
        >
          {content}
        </ManageGraphSurface>
      );
      if (node.kind !== "group") {
        surfaces.set(node.id, surface);
        readingOrder.push(node.id);
      } else {
        const id = `decoration:${node.id}`;
        decorations.push({
          id,
          surface,
          position: { x: node.rect.x, y: node.rect.y },
          width: node.rect.w,
          height: node.rect.h,
          zIndex: 0,
        });
        readingOrder.push(id);
        if (engine) {
          const chipId = `decoration:chip:${node.id}`;
          decorations.push({
            id: chipId,
            position: { x: node.rect.x, y: node.rect.y },
            width: 0,
            height: 0,
            zIndex: 4,
            interactive: true,
            surface: (
              <GraphNode
                node={node}
                inspection={null}
                model={model}
                selectedId={selectedId}
                onSelect={onSelect}
                groupPart="chip"
              />
            ),
          });
          readingOrder.push(chipId);
        }
      }
    }
    return {
      semantic: layout.semantic,
      paths: layout.connections,
      surfaces,
      decorations,
      readingOrder,
      highlightedIds,
      onEdgeHoverChange: setHoveredId,
    };
  }, [
    layout,
    model,
    selectedId,
    onSelect,
    inspection,
    engine,
    registerSurface,
    onSurfaceContentCommit,
    viewport,
    highlightedIds,
  ]);
  useFinancialGraphPresentation(presentation);
  if (engine) return null;
  return (
    <div
      data-manage-graph=""
      className="relative"
      style={{ width: layout.width, height: layout.height }}
    >
      <div className="pointer-events-none absolute inset-0 z-[1]">
        <GraphEdges
          width={layout.width}
          height={layout.height}
          edges={layout.edges}
          connections={layout.connections}
          highlightedId={null}
          highlightedIds={highlightedIds}
          onEdgeHoverChange={setHoveredId}
        />
      </div>
      {layout.nodes.map((node) =>
        node.kind === "group"
          ? presentation.decorations?.find(
              (decoration) => decoration.id === `decoration:${node.id}`,
            )?.surface
          : presentation.surfaces.get(node.id),
      )}
    </div>
  );
}
