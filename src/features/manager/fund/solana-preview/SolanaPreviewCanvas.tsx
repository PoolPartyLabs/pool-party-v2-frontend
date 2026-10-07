/**
 * @id PP-MGR-CMP-088
 * @name SolanaPreviewCanvas
 * @description Local drawing with independent principal and converted-fee routes.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8370-2816
 * @linear https://linear.app/yeildbay/issue/POO-2281
 * @i18n-namespace manager.solanaPreview
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, presentational drawing; PP-MGR-SCR-009 owns local intent events.
 */
"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CanvasViewport, type CanvasViewportHandle } from "../build/canvas/CanvasViewport";
import { FlowPill } from "../build/pieces/FlowPill";
import { GraphEdges } from "../build/pieces/GraphEdges";
import type { PieceEdge } from "../build/pieces/pieceTypes";
import { SpineCard } from "../build/pieces/SpineCard";
import { SpokeGroup } from "../build/pieces/SpokeGroup";
import { isLiquidityBlock, type PreviewBlock, type PreviewProtocol } from "./previewModel";

/** Official marks are decorative wherever a visible protocol name accompanies them. */
export function PreviewLogo({
  protocol,
  className = "size-5",
}: {
  protocol: PreviewProtocol | "solana";
  className?: string;
}) {
  return (
    <Image
      src={`/protocols/solana-preview/${protocol}.svg`}
      alt=""
      width={20}
      height={20}
      className={`${className} object-contain`}
    />
  );
}

function At({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

export interface SolanaPreviewCanvasProps {
  blocks: PreviewBlock[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onRemove(id: string): void;
}

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PreviewConnection extends PieceEdge {
  source: string;
  target: string;
}
/** Missing internal geometry is a render failure, never a fabricated coordinate. */
export function getPreviewNode(nodes: Record<string, PreviewRect>, id: string): PreviewRect {
  const node = nodes[id];
  if (!node) throw new Error("Solana preview node is missing");
  return node;
}
/** Geometry contract used by the renderer and endpoint regression tests. */
export function getPreviewGeometry(blocks: PreviewBlock[]): {
  width: number;
  height: number;
  spoke: PreviewRect;
  nodes: Record<string, PreviewRect>;
  edges: PieceEdge[];
  connections: PreviewConnection[];
} {
  const width = 1090 + Math.max(1, blocks.length) * 250;
  const rect = (x: number, y: number, width: number, height: number): PreviewRect => ({
    x,
    y,
    width,
    height,
  });
  const nodes: Record<string, PreviewRect> = {
    "hub-deposit": rect(32, 70, 236, 62),
    "hub-idle": rect(32, 220, 236, 62),
    "hub-idle-output": rect(32, 530, 236, 62),
    "hub-income": rect(32, 710, 236, 62),
    "hub-withdraw": rect(32, 810, 236, 62),
    "bridge-in": rect(326, 238, 176, 26),
    "bridge-out": rect(326, 608, 176, 26),
    "solana-idle": rect(600, 220, 236, 62),
    "solana-idle-output": rect(600, 530, 236, 62),
    "operating-cash": rect(868, 203, 144, 96),
  };
  const point = (
    id: string,
    side: "left" | "right" | "top" | "bottom",
    offset = 0,
  ): [number, number] => {
    const node = getPreviewNode(nodes, id);
    return side === "left" || side === "right"
      ? [node.x + (side === "right" ? node.width : 0), node.y + node.height / 2 + offset]
      : [node.x + node.width / 2 + offset, node.y + (side === "bottom" ? node.height : 0)];
  };
  const connections: PreviewConnection[] = [];
  const connect = (
    id: string,
    tone: PieceEdge["tone"],
    source: string,
    target: string,
    points: [number, number][],
  ) => connections.push({ id, tone, source, target, points: points.map(([x, y]) => ({ x, y })) });
  connect("deposit-idle", "muted", "hub-deposit", "hub-idle", [
    point("hub-deposit", "bottom"),
    point("hub-idle", "top"),
  ]);
  connect("bridge-in", "muted", "hub-idle", "bridge-in", [
    point("hub-idle", "right"),
    point("bridge-in", "left"),
  ]);
  connect("bridge-in-idle", "muted", "bridge-in", "solana-idle", [
    point("bridge-in", "right"),
    point("solana-idle", "left"),
  ]);
  connect("operating-cash", "muted", "solana-idle", "operating-cash", [
    point("solana-idle", "right"),
    point("operating-cash", "left"),
  ]);
  // Independent return ports: principal above center, converted LP fees below center.
  connect("return-idle", "muted", "solana-idle-output", "bridge-out", [
    point("solana-idle-output", "left"),
    [540, 561],
    [540, 616],
    point("bridge-out", "right", -5),
  ]);
  connect("bridge-out", "muted", "bridge-out", "hub-idle-output", [
    point("bridge-out", "left", -5),
    [304, 616],
    [304, 561],
    point("hub-idle-output", "right"),
  ]);
  connect("bridge-fees-income", "income", "bridge-out", "hub-income", [
    point("bridge-out", "left", 5),
    [292, 626],
    [292, 741],
    point("hub-income", "right"),
  ]);
  connect("income-outgoing", "muted", "hub-income", "hub-withdraw", [
    point("hub-income", "bottom"),
    point("hub-withdraw", "top"),
  ]);
  connect("principal-withdraw", "muted", "hub-idle-output", "hub-withdraw", [
    point("hub-idle-output", "left"),
    [16, 561],
    [16, 841],
    point("hub-withdraw", "left"),
  ]);
  blocks.forEach((block, index) => {
    const x = 1090 + index * 250;
    const cx = x + 88;
    const lp = isLiquidityBlock(block.protocol);
    nodes[block.id] = rect(x, 400, 176, 62);
    if (lp) {
      nodes[`${block.id}-input-swap`] = rect(x, 335, 176, 26);
      nodes[`${block.id}-collect`] = rect(x, 610, 176, 26);
      nodes[`${block.id}-auto-swap`] = rect(x, 655, 176, 26);
    }
    const target = lp ? `${block.id}-input-swap` : block.id;
    connect(`${block.id}-entry`, "muted", "solana-idle", target, [
      point("solana-idle", "bottom"),
      [718, 305],
      [cx, 305],
      point(target, "top"),
    ]);
    if (lp)
      connect(`${block.id}-swap-entry`, "muted", target, block.id, [
        point(target, "bottom"),
        point(block.id, "top"),
      ]);
    // Principal exits laterally. Kamino interest follows principal, never the LP fee bus.
    connect(`${block.id}-principal`, "muted", block.id, "solana-idle-output", [
      point(block.id, "left"),
      [x - 24, 431],
      [x - 24, 561],
      point("solana-idle-output", "right"),
    ]);
    if (lp) {
      connect(`${block.id}-fees`, "income", block.id, `${block.id}-collect`, [
        point(block.id, "right"),
        [x + 200, 431],
        [x + 200, 590],
        [cx, 590],
        point(`${block.id}-collect`, "top"),
      ]);
      connect(`${block.id}-collected`, "income", `${block.id}-collect`, `${block.id}-auto-swap`, [
        point(`${block.id}-collect`, "bottom"),
        point(`${block.id}-auto-swap`, "top"),
      ]);
      connect(`${block.id}-fee-swap-bridge`, "income", `${block.id}-auto-swap`, "bridge-out", [
        point(`${block.id}-auto-swap`, "bottom"),
        [cx, 710],
        [552, 710],
        [552, 626],
        point("bridge-out", "right", 5),
      ]);
    }
  });
  return {
    width,
    height: 900,
    spoke: rect(566, 60, width - 586, 780),
    nodes,
    edges: connections,
    connections,
  };
}

/** A drawing with independent principal and LP-fee buses. All geometry stays local. */
export function SolanaPreviewCanvas({
  blocks,
  selectedId,
  onSelect,
  onRemove,
}: SolanaPreviewCanvasProps) {
  const t = useTranslations("manager");
  const format = useFormatter();
  const protocolNames = {
    kamino: t("solanaPreview.protocols.kamino"),
    jupiter: t("solanaPreview.protocols.jupiter"),
    raydium: t("solanaPreview.protocols.raydium"),
    orca: t("solanaPreview.protocols.orca"),
  };
  const geometry = useMemo(() => getPreviewGeometry(blocks), [blocks]);
  const { width, height, nodes, edges, connections, spoke } = geometry;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const highlightedId = connections.some((connection) => connection.id === hoveredId)
    ? hoveredId
    : null;
  const viewportRef = useRef<CanvasViewportHandle>(null);
  const previousWidthRef = useRef(width);
  useEffect(() => {
    if (previousWidthRef.current !== width) {
      previousWidthRef.current = width;
      const fitView = viewportRef.current?.fit;
      fitView?.();
    }
  }, [width]);

  return (
    <div className="h-[min(760px,75dvh)] min-h-[460px] min-w-0">
      <CanvasViewport
        graphSize={{ width, height }}
        fillContainer
        fitOnResize
        viewportRef={viewportRef}
        onBackgroundClick={() => onSelect(null)}
      >
        <At x={spoke.x} y={spoke.y}>
          <SpokeGroup
            width={spoke.width}
            height={spoke.height}
            networkName="Solana"
            networkLogo={<PreviewLogo protocol="solana" className="size-3" />}
            chipTooltip="Solana"
          />
        </At>
        <At x={32} y={30}>
          <span className="font-medium text-muted-foreground text-xs uppercase">Arbitrum</span>
        </At>
        <GraphEdges
          width={width}
          height={height}
          edges={edges}
          connections={connections}
          highlightedId={highlightedId}
          onEdgeHoverChange={setHoveredId}
        />
        <At x={getPreviewNode(nodes, "hub-deposit").x} y={getPreviewNode(nodes, "hub-deposit").y}>
          <SpineCard
            title={t("solanaPreview.deposit")}
            caption="USDC"
            icon="depositIn"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At x={getPreviewNode(nodes, "hub-idle").x} y={getPreviewNode(nodes, "hub-idle").y}>
          <SpineCard
            title={t("solanaPreview.idle")}
            caption="USDC"
            icon="hourglass"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At x={getPreviewNode(nodes, "hub-income").x} y={getPreviewNode(nodes, "hub-income").y}>
          <SpineCard
            title={t("solanaPreview.income")}
            caption="USDC"
            icon="coins"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At
          x={getPreviewNode(nodes, "hub-idle-output").x}
          y={getPreviewNode(nodes, "hub-idle-output").y}
        >
          <SpineCard
            title={t("solanaPreview.idle")}
            caption="USDC"
            icon="hourglass"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At x={getPreviewNode(nodes, "hub-withdraw").x} y={getPreviewNode(nodes, "hub-withdraw").y}>
          <SpineCard
            title={t("solanaPreview.withdraw")}
            caption="USDC"
            icon="withdrawOut"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At x={getPreviewNode(nodes, "bridge-in").x} y={getPreviewNode(nodes, "bridge-in").y}>
          <FlowPill
            content={{
              text: t("solanaPreview.bridgeIn"),
              tooltip: t("solanaPreview.fixed"),
              icon: "bridge",
            }}
          />
        </At>
        <At x={getPreviewNode(nodes, "bridge-out").x} y={getPreviewNode(nodes, "bridge-out").y}>
          <FlowPill
            content={{
              text: t("solanaPreview.bridgeOut"),
              tooltip: t("solanaPreview.fixed"),
              icon: "bridge",
            }}
          />
        </At>
        <At x={getPreviewNode(nodes, "solana-idle").x} y={getPreviewNode(nodes, "solana-idle").y}>
          <SpineCard
            title={t("solanaPreview.idle")}
            caption="USDC"
            icon="hourglass"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At
          x={getPreviewNode(nodes, "solana-idle-output").x}
          y={getPreviewNode(nodes, "solana-idle-output").y}
        >
          <SpineCard
            title={t("solanaPreview.idle")}
            caption="USDC"
            icon="hourglass"
            locked
            lockTooltip={t("solanaPreview.fixed")}
          />
        </At>
        <At
          x={getPreviewNode(nodes, "operating-cash").x}
          y={getPreviewNode(nodes, "operating-cash").y}
        >
          <div
            data-canvas-interactive=""
            className="flex h-24 w-36 flex-col justify-center gap-1 rounded-2xl border border-border bg-surface px-3 text-sm"
          >
            <span className="text-muted-foreground text-xs">
              {t("solanaPreview.operatingCash")}
            </span>
            <span className="flex items-center gap-2 font-medium">
              <PreviewLogo protocol="solana" className="size-4" />
              {t("solanaPreview.nativeSol")}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("solanaPreview.marketUnavailable")}
            </span>
          </div>
        </At>
        {blocks.length === 0 ? (
          <At x={1090} y={400}>
            <p className="max-w-56 text-muted-foreground text-sm">{t("solanaPreview.noBlocks")}</p>
          </At>
        ) : null}
        {blocks.map((block) => {
          const x = getPreviewNode(nodes, block.id).x;
          const name = protocolNames[block.protocol];
          const title = block.protocol === "kamino" ? t("solanaPreview.supplyUsdc") : block.pair;
          const lp = isLiquidityBlock(block.protocol);
          return (
            <div key={block.id}>
              {lp ? (
                <At x={x} y={getPreviewNode(nodes, `${block.id}-input-swap`).y}>
                  <FlowPill
                    content={{
                      text: t("solanaPreview.swap"),
                      tooltip: t("solanaPreview.fixed"),
                      icon: "swap",
                    }}
                  />
                </At>
              ) : null}
              <At x={x} y={getPreviewNode(nodes, block.id).y}>
                <div data-canvas-interactive="" className="relative">
                  <button
                    type="button"
                    aria-label={`${t("solanaPreview.configure")} ${name}`}
                    aria-pressed={selectedId === block.id}
                    onClick={() => onSelect(block.id)}
                    className={`flex h-[62px] w-44 items-center gap-2.5 rounded-[20px] border bg-surface px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === block.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground"}`}
                  >
                    <PreviewLogo protocol={block.protocol} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sm">{title}</span>
                      <span className="block truncate text-muted-foreground text-[11px]">
                        {name}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("solanaPreview.removeLabel", { protocol: name })}
                    onClick={() => onRemove(block.id)}
                    className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                  <span
                    data-testid={`preview-allocation-${block.id}`}
                    className="absolute -top-7 left-0 w-44 text-center text-muted-foreground text-xs"
                  >
                    {format.number(block.allocationBps / 10000, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </div>
              </At>
              {lp ? (
                <>
                  <At x={x} y={getPreviewNode(nodes, `${block.id}-collect`).y}>
                    <FlowPill
                      content={{
                        text: t("solanaPreview.collect"),
                        tooltip: t("solanaPreview.fixed"),
                        icon: "coins",
                      }}
                    />
                  </At>
                  <At x={x} y={getPreviewNode(nodes, `${block.id}-auto-swap`).y}>
                    <FlowPill
                      content={{
                        text: t("solanaPreview.autoSwap"),
                        tooltip: t("solanaPreview.fixed"),
                        icon: "swap",
                      }}
                    />
                  </At>
                </>
              ) : null}
            </div>
          );
        })}
        <At x={600} y={860}>
          <div className="flex gap-5 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="h-px w-6 bg-muted-foreground" />
              {t("solanaPreview.principal")}
            </span>
            <span className="flex items-center gap-2 text-success">
              <span className="h-px w-6 bg-success" />
              {t("solanaPreview.fees")}
            </span>
          </div>
        </At>
      </CanvasViewport>
    </div>
  );
}
