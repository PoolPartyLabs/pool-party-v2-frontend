/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas
 * @implements-rules-version v1 (POO-2226, POO-2232)
 * @analytics-events none, position presses report through onSelect; ManageScreen owns the view.
 *
 * Read-only live graph built from the shared Build pieces. Cash belongs to one chain and every
 * balance has its own availability state. Selecting a position never alters graph geometry.
 */
"use client";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useMemo, useRef } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { formatPercent, formatTokenAmount, formatUsdTile } from "@/lib/utils/format";
import { BlockMark } from "../build/blocks/BlockMark";
import { CanvasViewport, type CanvasViewportHandle } from "../build/canvas/CanvasViewport";
import { FlowPill } from "../build/pieces/FlowPill";
import { GraphEdges } from "../build/pieces/GraphEdges";
import { CardCopy, PieceStroke } from "../build/pieces/pieceParts";
import { SpineCard } from "../build/pieces/SpineCard";
import { SpokeGroup } from "../build/pieces/SpokeGroup";
import { layoutManageGraph, type ManageNode } from "./manageLayout";
import {
  type ManageModel,
  type ManagePosition,
  type ManageRead,
  type ManageToken,
  type ManageTokenAmount,
  manageProtocolMark,
} from "./manageModel";

export interface ManageCanvasProps {
  model: ManageModel;
  selectedId: string | null;
  onSelect(positionId: string | null, keyboard?: boolean): void;
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
        className="min-w-0 truncate text-right font-semibold text-foreground tabular-nums"
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
}: {
  position: ManagePosition;
  selected: boolean;
  onSelect(keyboard?: boolean): void;
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
      aria-label={name}
      aria-describedby={position.kind === "liquidity" ? statusId : undefined}
      aria-pressed={selected}
      onClick={(event) => onSelect(event.detail === 0)}
      className="relative flex size-full cursor-pointer flex-col overflow-hidden rounded-lg bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <PieceStroke
        width={selected ? 2 : 1}
        radius={16}
        className={selected ? "text-primary" : "text-border"}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none flex h-[62px] w-full shrink-0 items-center gap-2.5 px-[13px] py-[11px]"
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
    </button>
  );
}
function BalanceCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      data-canvas-interactive=""
      className="relative flex size-full flex-col gap-3 overflow-hidden rounded-lg bg-surface p-3"
    >
      <PieceStroke width={1} radius={16} className="text-border" />
      <h3 className="whitespace-nowrap font-medium text-foreground text-xs">{title}</h3>
      {children}
    </div>
  );
}
function CashNode({ model, chainId }: { model: ManageModel; chainId: number }) {
  const t = useTranslations("manager.manageV2");
  const chain = model.chains.find((item) => item.chainId === chainId);
  if (!chain) return null;
  return (
    <div
      data-manage-cash={chainId}
      data-canvas-interactive=""
      className="relative flex size-full flex-col gap-2 overflow-hidden rounded-lg bg-surface p-3"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-chart-periwinkle/16"
      />
      <PieceStroke width={1} radius={16} className="text-chart-periwinkle/42" />
      <div className="relative flex flex-col gap-2">
        <h3 className="whitespace-nowrap font-medium text-foreground text-xs">
          {t("operatingCash")}
        </h3>
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <NetworkLogo network={chain.network} name={chain.name} size={12} />
          {chain.name}
        </div>
        {chain.cash.map((token) => (
          <ManageTokenRow key={`${token.chainId}:${token.address}:${token.symbol}`} token={token} />
        ))}
      </div>
    </div>
  );
}
function AmountLabel({ read }: { read: ManageRead<ManageTokenAmount> }) {
  const t = useTranslations("manager.manageV2");
  return (
    <span
      className="min-w-0 truncate font-semibold text-right tabular-nums"
      title={read.status === "available" ? `${read.value.decimal} ${read.value.symbol}` : undefined}
    >
      {read.status === "available"
        ? formatTokenAmount(Number(read.value.decimal), read.value.symbol)
        : t("notAvailable")}
    </span>
  );
}
function WithdrawalNode({ model }: { model: ManageModel }) {
  const t = useTranslations("manager.manageV2");
  const rows = [
    [t("withdrawalRequests"), model.withdrawal.requested],
    [t("reserved"), model.withdrawal.reserved],
    [t("stillNeeded"), model.withdrawal.stillNeeded],
  ] as const;
  return (
    <BalanceCard title={t("idleOutput")}>
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
  model,
  selectedId,
  onSelect,
}: {
  node: ManageNode;
  model: ManageModel;
  selectedId: string | null;
  onSelect(id: string, keyboard?: boolean): void;
}) {
  const t = useTranslations("manager.manageV2");
  const build = useTranslations("manager");
  const chain = model.chains.find((item) => item.chainId === node.chainId);
  const hub = model.chains.find((item) => item.hub);
  if (node.kind === "position") {
    const p = model.positions.find((p) => p.id === node.positionId);
    return p ? (
      <PositionNode
        position={p}
        selected={p.id === selectedId}
        onSelect={(keyboard) => onSelect(p.id, keyboard)}
      />
    ) : null;
  }
  if (node.kind === "cash")
    return <CashNode model={model} chainId={node.chainId ?? model.hubChainId} />;
  if (node.kind === "idle")
    return chain ? (
      <BalanceCard title={chain.hub ? t("idleInput") : t("idle")}>
        <ManageTokenRow token={chain.idle} />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t("strategyValueShare")}</span>
          <span className="font-semibold tabular-nums">
            {chain.idleSharePct.status === "available"
              ? formatPercent(Number(chain.idleSharePct.value), 1)
              : t("notAvailable")}
          </span>
        </div>
      </BalanceCard>
    ) : null;
  if (node.kind === "group")
    return chain ? (
      <SpokeGroup
        width={node.rect.w}
        height={node.rect.h}
        networkName={chain.name}
        networkLogo={<NetworkLogo network={chain.network} name={chain.name} size={12} />}
        chipTooltip={chain.name}
      />
    ) : null;
  if (node.kind === "withdrawal") return <WithdrawalNode model={model} />;
  if (node.kind === "income")
    return (
      <BalanceCard title={t("income")}>
        <div className="text-muted-foreground text-xs">{hub?.name}</div>
        <ManageTokenRow token={model.income} />
      </BalanceCard>
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
      <FlowPill
        content={{
          text: label,
          tooltip: label,
          icon: flow === "collectFees" ? "coins" : flow === "bridge" ? "bridge" : "swap",
        }}
      />
    );
  }
  return (
    <SpineCard
      title={
        node.kind === "deposit"
          ? build("fundBuilder.canvas.spine.deposit.title")
          : build("fundBuilder.canvas.spine.withdraw.title")
      }
      caption={`${hub?.idle.symbol ?? ""} · ${hub?.name ?? ""}`}
      icon={node.kind === "deposit" ? "depositIn" : "withdrawOut"}
      locked
    />
  );
}
export function ManageCanvas({ model, selectedId, onSelect }: ManageCanvasProps) {
  const layout = useMemo(() => layoutManageGraph(model), [model]);
  const viewport = useRef<CanvasViewportHandle>(null);
  return (
    <CanvasViewport
      graphSize={{ width: layout.width, height: layout.height }}
      initialScale={1}
      viewportRef={viewport}
      onBackgroundClick={() => onSelect(null)}
    >
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
            highlightedId={null}
          />
        </div>
        {layout.nodes.map((node) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: Observes descendant focus to reveal its card; the wrapper has no action.
          <div
            key={node.id}
            data-manage-node={node.id}
            onFocus={() => {
              if (node.kind === "position") viewport.current?.revealRect(node.rect);
            }}
            className={
              node.kind === "group" ? "absolute [&_[data-network-chip]]:z-[4]" : "absolute z-[2]"
            }
            style={{ left: node.rect.x, top: node.rect.y, width: node.rect.w, height: node.rect.h }}
          >
            <GraphNode
              node={node}
              model={model}
              selectedId={selectedId}
              onSelect={(id, keyboard) => (keyboard ? onSelect(id, true) : onSelect(id))}
            />
          </div>
        ))}
      </div>
    </CanvasViewport>
  );
}
