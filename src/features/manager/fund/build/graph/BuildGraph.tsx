/**
 * @id PP-MGR-CMP-059
 * @name BuildGraph
 * @implements-rules-version v1 (POO-2156 rules v1; POO-2210 rules v1); POO-2213 rules v1; POO-2235 rules v1; POO-2237 rules v1
 * @analytics-events none, a controlled renderer: every activation leaves through `onTarget` (and a
 *   spoke removal through `onRemoveSpoke`); the Build screen (PP-MGR-SCR-002, S7) maps them to the
 *   builder events, so nothing here tracks.
 *
 * The graph of the Build canvas (slice S6, POO-2156; coordinator plan section 3.5). It joins the
 * pure layout (S3: `layoutGraph`, `GraphLayout`) and the presentational pieces (S4): every node of the
 * layout is drawn once, at its layout box, by its piece, and every edge is drawn by `GraphEdges`. It
 * holds no plan state: the layout, the selection, the active targets and the copy of each block come
 * in as props, and every press goes out through `onTarget(target, anchor)`. It does not open menus
 * or change the plan (S5 decides, S7 joins the two), and it is drawn in GRAPH coordinates inside the
 * viewport's layer (S2: `CanvasViewport`), which pans and zooms it with one transform.
 *
 * Rules (handoff v1.2):
 *
 * - [L7] Back to front: group boxes, lines, cards and pills and templates, insert ports, share
 *   labels and network chips; tooltips and menus are portalled overlays above. The DOM is in READING
 *   order (next rule), so the layers are painted with `z-index`. A group's wrapper sets none, so it
 *   creates no stacking context and its network chip can be lifted to the label layer.
 * - [I10] Templates, ports, cards and chain share labels are buttons named by their tooltip; pills,
 *   locks, a spoke's label and the network chips only explain themselves (focusable, not buttons:
 *   the focus policy of the pieces). Everything is in the DOM in reading order, CHAIN BY CHAIN (the
 *   coordinator's decision on the review of PR #35, see `graphModel`), so the tab order is the
 *   reading order with no positive `tabIndex`. Nodes keep stable keys, so a re-flow that reorders
 *   them moves the focused element and React DOM gives it its focus back after the commit. Lines
 *   are hidden from assistive technology. A card is named by its place: `card.accessibleName` with
 *   its title and caption (from `describeBlock`), its network and its chain's share ("WETH / USDC,
 *   Uniswap v4 · 0.05%, on Arbitrum, 60% of the capital"), and the name says the card's state with
 *   the existing copy: an empty card's title reads "Uniswap v4 · no pool yet" (`panel.typeNoPool`,
 *   `panel.typeNoAsset`), a coming-soon caption "Uniswap v3 · 0.05% · coming soon"
 *   (`menu.comingSoonType`), an invalid caption "No longer in your mandate" (`card.invalid`). A
 *   coming-soon card always carries its "Soon" tag (`palette.soon` when the registry gives none).
 * - Shares are rounded once (`shareNumber`): the label, its tooltip and the card's name agree.
 * - [C19] Every template, port, pill, share label, network chip and lock has its tooltip. Ports use
 *   the four D13 variants by the side of the port and the kind of its card; a share label says
 *   `tooltip.share`; the Bridge has no block id, so its text and tooltip are built here from
 *   `flow.bridgeAuto` and `tooltip.bridgeAuto` with the network's name and stable (D7: USDG on
 *   Robinhood Chain, never a literal USDC); spine texts come from `spine.*`.
 * - [BB8] Hovering an edge or its share label (or focusing the label) lights both.
 * - [I9] A re-flow moves each node 150 ms ease-out: nodes are keyed by stable ids, so React keeps the
 *   element and the browser animates its new position; none under reduced motion (D8). The lines
 *   snap to the new layout (an SVG polyline cannot transition its points). Motion starts only after
 *   the first frame is painted, so the first layout (and the measured one that may replace the
 *   estimate before paint) never slides into place.
 * - [I3], [I5], [C15], [C17] `activeTargetKeys` light the matching templates and ports; the card of
 *   `selectedId` gets its selected look; spine cards, pills and the Bridge select nothing.
 * - Drop and background contracts: every template, port, card and share label is wrapped in an
 *   element carrying `data-graph-target={targetKey(target)}` (S5 resolves a drop with
 *   `elementFromPoint(x, y)?.closest('[data-graph-target]')`); every interactive element carries
 *   `data-canvas-interactive`, so a press on it never pans; group boxes and the lines do not.
 * - [L6], [BB6] The empty canvas's two captions and its "Start here" sentence at the layout anchors.
 *   The sentence's width feeds the layout through `useGraphLayout`.
 *
 * Performance: everything derived from the layout is memoised on it, and the nodes are built once
 * per change of the props they read, so a hover re-renders only the labels and the lines. Pan and
 * zoom live in the viewport, which never re-renders its children: moving the view draws nothing.
 *
 * Addition to plan section 3.5 (required since the review of PR #35, so no caller forgets it):
 * `invalidNetworks`, the spoke networks the mandate no longer holds (D6), drawn as invalid groups.
 * `BuildGraphProps` has no other source for that state.
 */
"use client";

import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { networkStableSymbol } from "@/lib/chains/config";
import { CANVAS_INTERACTIVE_ATTR } from "../canvas/useCanvasViewport";
import type { GraphLayout, GraphTarget, SpineRole } from "../layout/graphTypes";
import { GRAPH_TARGET_ATTR, targetKey } from "../layout/graphTypes";
import { LAYOUT } from "../layout/layoutConstants";
import { AddNetworkTemplate, AddProtocolTemplate } from "../pieces/CanvasTemplate";
import { FlowPill } from "../pieces/FlowPill";
import { GraphEdges } from "../pieces/GraphEdges";
import { InsertPort } from "../pieces/InsertPort";
import { PositionCard } from "../pieces/PositionCard";
import type { BlockContent, FlowContent } from "../pieces/pieceTypes";
import { ShareLabel } from "../pieces/ShareLabel";
import { SpineCard } from "../pieces/SpineCard";
import { SpokeGroup } from "../pieces/SpokeGroup";
import {
  chainShares,
  formatShare,
  GRAPH_LAYER,
  type GraphItem,
  graphItems,
  itemLayer,
  itemTarget,
  type PortTooltipKey,
  pieceConnections,
  pieceEdges,
  portTooltipKey,
  SPINE_ICON,
  shareNumber,
} from "./graphModel";

/** Public props for {@link BuildGraph} (coordinator plan section 3.5). */
export interface BuildGraphProps {
  /** The laid-out graph (S3), usually from `useGraphLayout` or `useDraftGraphLayout`. */
  layout: GraphLayout;
  /** Title, caption, icon and state of a position block, from its `config` (S5, HU2). */
  describeBlock(blockId: string): BlockContent;
  /** Text, tooltip and icon of a flow block (S5). */
  describeFlow(blockId: string): FlowContent;
  /** The translated name of a network ("Robinhood Chain"). */
  networkName(network: string): string;
  /** The selected block (I5), or null. */
  selectedId: string | null;
  /** The keys (`targetKey`) of the templates and ports drawn active (I3: a menu open, a drag). */
  activeTargetKeys: ReadonlySet<string>;
  /** Every activation: a template, a port, a card or a chain's share label, with the pressed element. */
  onTarget(target: GraphTarget, anchor: HTMLElement): void;
  /** Requests removal of an empty spoke (I7, D5); the caller confirms. */
  onRemoveSpoke?(network: string): void;
  /** Requests removal of a user block; mandatory automatic steps expose no X. */
  onRemoveBlock?(blockId: string): void;
  /**
   * Spoke networks no longer in the mandate (D6), drawn as invalid groups (addition to plan section
   * 3.5). The caller builds it from `validatePlan(plan, ctx)` (`build/plan/planInvariants.ts`): the
   * `targetId` of every violation whose `code` is `"network_not_in_mandate"` (invariant 1), which
   * carries the spoke's network. Pass an empty set when there is none.
   */
  invalidNetworks: ReadonlySet<string>;
}

/** [I9] How a moved node travels to its new place. */
const MOVE = "left 150ms ease-out, top 150ms ease-out";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** D8: whether the viewer asked for reduced motion. The server draws no motion. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, readReducedMotion, () => true);
}

/** Every string the renderer prints, through literal keys so the i18n usage scan sees each one. */
function useGraphCopy() {
  const t = useTranslations("manager");
  return useMemo(() => {
    const spine: Record<SpineRole, { title: string; caption: string }> = {
      deposit: {
        title: t("fundBuilder.canvas.spine.deposit.title"),
        caption: t("fundBuilder.canvas.spine.deposit.caption"),
      },
      idleInput: {
        title: t("fundBuilder.canvas.spine.idleInput.title"),
        caption: t("fundBuilder.canvas.spine.idleInput.caption"),
      },
      idleOutput: {
        title: t("fundBuilder.canvas.spine.idleOutput.title"),
        caption: t("fundBuilder.canvas.spine.idleOutput.caption"),
      },
      income: {
        title: t("fundBuilder.canvas.spine.income.title"),
        caption: t("fundBuilder.canvas.spine.income.caption"),
      },
      withdraw: {
        title: t("fundBuilder.canvas.spine.withdraw.title"),
        caption: t("fundBuilder.canvas.spine.withdraw.caption"),
      },
    };
    const port: Record<PortTooltipKey, string> = {
      portBefore: t("fundBuilder.canvas.tooltip.portBefore"),
      portAfterPool: t("fundBuilder.canvas.tooltip.portAfterPool"),
      portAfterSupply: t("fundBuilder.canvas.tooltip.portAfterSupply"),
      portAfterBorrow: t("fundBuilder.canvas.tooltip.portAfterBorrow"),
    };
    return {
      spine,
      port,
      lock: t("fundBuilder.canvas.spine.lockTooltip"),
      removeBlock: t("fundBuilder.canvas.panel.remove"),
      bridge: t("fundBuilder.canvas.flow.bridgeAuto"),
      feeSwap: t("fundBuilder.canvas.flow.swapAuto"),
      feeSwapTooltip: (token: string) => t("fundBuilder.canvas.tooltip.feeSwap", { token }),
      addNetwork: t("fundBuilder.canvas.tooltip.addNetwork"),
      emptyAddProtocol: t("fundBuilder.canvas.empty.addProtocol"),
      emptyAddNetwork: t("fundBuilder.canvas.empty.addNetwork"),
      startHere: t("fundBuilder.canvas.empty.startHere"),
      invalid: t("fundBuilder.canvas.card.invalid"),
      soon: t("fundBuilder.canvas.palette.soon"),
      addProtocol: (network: string) => t("fundBuilder.canvas.tooltip.addProtocol", { network }),
      bridgeTooltip: (token: string, network: string) =>
        t("fundBuilder.canvas.tooltip.bridgeAuto", { token, network }),
      // `pct` is the share already rounded by `shareNumber`, so every message agrees with the label.
      share: (pct: string) => t("fundBuilder.canvas.tooltip.share", { pct }),
      cardName: (values: { title: string; caption: string; network: string; pct: string }) =>
        t("fundBuilder.canvas.card.accessibleName", values),
      comingSoon: (type: string) => t("fundBuilder.canvas.menu.comingSoonType", { type }),
      noPoolYet: (type: string) => t("fundBuilder.canvas.panel.typeNoPool", { type }),
      noAssetYet: (type: string) => t("fundBuilder.canvas.panel.typeNoAsset", { type }),
      removeNetwork: (network: string) => t("fundBuilder.canvas.network.remove", { network }),
    };
  }, [t]);
}

type GraphCopy = ReturnType<typeof useGraphCopy>;

/**
 * The card's content with its state said in words (F2): the accessible name names its place and its
 * state, and a coming-soon card always has its tag. Only existing keys: an empty card's title takes
 * "no pool yet" or "no asset yet" (a pool kind, or anything else), a coming-soon caption takes
 * "coming soon", an invalid caption is the reason itself.
 */
function cardContent(
  content: BlockContent,
  place: { kind: string; network: string; pct: string },
  copy: GraphCopy,
): BlockContent {
  let { title, caption } = content;
  if (content.state === "empty") {
    const pool = place.kind === "uniswapV4Pool" || place.kind === "uniswapV3Pool";
    title = pool ? copy.noPoolYet(title) : copy.noAssetYet(title);
  } else if (content.state === "comingSoon") {
    caption = copy.comingSoon(caption);
  } else if (content.state === "invalid") {
    caption = copy.invalid;
  }
  return {
    ...content,
    soonTag: content.state === "comingSoon" ? (content.soonTag ?? copy.soon) : content.soonTag,
    accessibleName: copy.cardName({
      title,
      caption,
      network: place.network,
      pct: place.pct,
    }),
  };
}

/** D8 and F4: motion only after the first frame is painted, and never under reduced motion. */
function useMotion(): boolean {
  const reduced = usePrefersReducedMotion();
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setPainted(true);
      return;
    }
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return painted && !reduced;
}

/** The pieces a wrapper holds that a press must never pan through (section 3.2 of the plan). */
const INTERACTIVE_TYPES: ReadonlySet<GraphItem["type"]> = new Set([
  "spine",
  "block",
  "bridge",
  "feeSwap",
  "template",
  "port",
  "label",
]);

/**
 * [L7] A group's chip sits on the box's top border, where a stub may cross it (a new spoke): it is
 * lifted to the label layer. The class is static so Tailwind sees it; 4 is `GRAPH_LAYER.labels`.
 */
const GROUP_CHIP_LAYER = "[&_[data-network-chip]]:z-[4]";

/** Where an item's wrapper sits, in graph px (labels and captions are centred on their anchor). */
function placement(item: GraphItem): CSSProperties {
  switch (item.type) {
    case "spine":
    case "block":
    case "bridge":
    case "feeSwap":
    case "template":
    case "group": {
      const { x, y, w, h } = item.node.rect;
      return { left: x, top: y, width: w, height: h };
    }
    case "port": {
      const { x, y } = item.node.center;
      const half = LAYOUT.PORT / 2;
      return { left: x - half, top: y - half, width: LAYOUT.PORT, height: LAYOUT.PORT };
    }
    case "label":
      return {
        left: item.node.center.x,
        top: item.node.center.y,
        transform: "translate(-50%, -50%)",
      };
    case "caption":
      return { left: item.at.x, top: item.at.y, transform: "translateX(-50%)" };
    case "sentence": {
      const { x, y, w, h } = item.rect;
      return { left: x, top: y, width: w, height: h };
    }
  }
}

/** The attributes and style of an item's wrapper. */
function wrapperProps(item: GraphItem, motion: boolean): Record<string, unknown> {
  const target = itemTarget(item);
  const style: CSSProperties = {
    position: "absolute",
    ...placement(item),
    // A group sets no z-index: it must not trap its chip in a stacking context of its own.
    zIndex: item.type === "group" ? undefined : itemLayer(item),
    transition: motion ? MOVE : undefined,
  };
  return {
    "data-graph-node": item.key,
    ...(target ? { [GRAPH_TARGET_ATTR]: targetKey(target) } : {}),
    ...(INTERACTIVE_TYPES.has(item.type) ? { [CANVAS_INTERACTIVE_ATTR]: "" } : {}),
    className: item.type === "group" ? GROUP_CHIP_LAYER : undefined,
    style,
  };
}

/** A position card in its wrapper; a press reports the card button as the anchor. */
function CardSlot({
  wrapper,
  content,
  selected,
  onSelect,
  onRemove,
  removeLabel,
}: {
  wrapper: Record<string, unknown>;
  content: BlockContent;
  selected: boolean;
  onSelect(anchor: HTMLElement): void;
  onRemove?: () => void;
  removeLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const select = useCallback(() => {
    const element = ref.current;
    const anchor = element?.querySelector<HTMLElement>("button") ?? element;
    if (anchor) onSelect(anchor);
  }, [onSelect]);
  return (
    <div ref={ref} {...wrapper}>
      <PositionCard content={content} selected={selected} onSelect={select} />
      {onRemove ? (
        <button
          type="button"
          aria-label={`${removeLabel}: ${content.title}`}
          data-canvas-interactive=""
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1 -right-1 z-10 flex size-6 items-center justify-center rounded-full bg-surface text-muted-foreground focus-visible:outline focus-visible:outline-primary"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/** The graph of the Build canvas, in graph coordinates (see the file header). */
export const BuildGraph = memo(function BuildGraph({
  layout,
  describeBlock,
  describeFlow,
  networkName,
  selectedId,
  activeTargetKeys,
  onTarget,
  onRemoveSpoke,
  onRemoveBlock,
  invalidNetworks,
}: BuildGraphProps) {
  const copy = useGraphCopy();
  const motion = useMotion();
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  // The callbacks read the latest handlers through refs, so the nodes built below stay valid.
  const onTargetRef = useRef(onTarget);
  onTargetRef.current = onTarget;
  const onRemoveSpokeRef = useRef(onRemoveSpoke);
  onRemoveSpokeRef.current = onRemoveSpoke;
  const report = useCallback(
    (target: GraphTarget, anchor: HTMLElement) => onTargetRef.current(target, anchor),
    [],
  );
  const canRemoveSpoke = onRemoveSpoke !== undefined;

  const items = useMemo(() => graphItems(layout), [layout]);
  const edges = useMemo(() => pieceEdges(layout), [layout]);
  const connections = useMemo(() => pieceConnections(layout), [layout]);
  const shares = useMemo(() => chainShares(layout), [layout]);
  const kinds = useMemo(
    () => new Map(layout.blocks.map((block) => [block.id, block.kind])),
    [layout],
  );

  // Every node but the share labels: they do not depend on the hover, so a hover keeps them.
  const nodes = useMemo(() => {
    const out = new Map<string, ReactElement>();
    for (const item of items) {
      const wrapper = wrapperProps(item, motion);
      switch (item.type) {
        case "spine": {
          const { role, locked } = item.node;
          out.set(
            item.key,
            <div key={item.key} {...wrapper}>
              <SpineCard
                title={copy.spine[role].title}
                caption={copy.spine[role].caption}
                icon={SPINE_ICON[role]}
                locked={locked}
                lockTooltip={locked ? copy.lock : undefined}
              />
            </div>,
          );
          break;
        }
        case "feeSwap": {
          out.set(
            item.key,
            <div key={item.key} {...wrapper}>
              <FlowPill
                content={{
                  text: copy.feeSwap,
                  tooltip: copy.feeSwapTooltip(networkStableSymbol(item.node.network)),
                  icon: "swap",
                }}
              />
            </div>,
          );
          break;
        }
        case "block": {
          const block = item.node;
          if (block.family === "position") {
            const content = cardContent(
              describeBlock(block.id),
              {
                kind: block.kind,
                network: networkName(block.network),
                pct: shareNumber(shares.get(block.chainId) ?? 0),
              },
              copy,
            );
            out.set(
              item.key,
              <CardSlot
                key={item.key}
                wrapper={wrapper}
                content={content}
                removeLabel={copy.removeBlock}
                onRemove={onRemoveBlock ? () => onRemoveBlock(block.id) : undefined}
                selected={block.id === selectedId}
                onSelect={(anchor) => report({ kind: "block", blockId: block.id }, anchor)}
              />,
            );
          } else {
            out.set(
              item.key,
              <div key={item.key} {...wrapper}>
                <FlowPill
                  content={describeFlow(block.id)}
                  selected={block.id === selectedId}
                  onActivate={
                    block.kind === "swap" && !block.auto
                      ? (anchor) => report({ kind: "block", blockId: block.id }, anchor)
                      : undefined
                  }
                />
                {!block.auto && onRemoveBlock ? (
                  <button
                    type="button"
                    aria-label={`${copy.removeBlock}: ${describeFlow(block.id).text}`}
                    data-canvas-interactive=""
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveBlock(block.id);
                    }}
                    className="absolute -top-1 -right-1 z-10 flex size-6 items-center justify-center rounded-full bg-surface focus-visible:outline focus-visible:outline-primary"
                  >
                    ×
                  </button>
                ) : null}
              </div>,
            );
          }
          break;
        }
        case "bridge": {
          const { network } = item.node;
          out.set(
            item.key,
            <div key={item.key} {...wrapper}>
              <FlowPill
                content={{
                  text: copy.bridge,
                  tooltip: copy.bridgeTooltip(networkStableSymbol(network), networkName(network)),
                  icon: "bridge",
                }}
              />
            </div>,
          );
          break;
        }
        case "group": {
          const group = item.node;
          const name = networkName(group.network);
          const removable = canRemoveSpoke && !group.hasChains;
          out.set(
            item.key,
            <div key={item.key} {...wrapper}>
              <SpokeGroup
                width={group.rect.w}
                height={group.rect.h}
                networkName={name}
                networkLogo={<NetworkLogo network={group.network} name={name} size={12} />}
                chipTooltip={name}
                invalid={invalidNetworks.has(group.network)}
                invalidLabel={copy.invalid}
                onRemove={removable ? () => onRemoveSpokeRef.current?.(group.network) : undefined}
                removeLabel={removable ? copy.removeNetwork(name) : undefined}
              />
            </div>,
          );
          break;
        }
        case "template": {
          const target = item.node.target;
          // The target's key, not the item's: a repeated item key carries a "#2" suffix (F6).
          const active = activeTargetKeys.has(targetKey(target));
          const activate = (anchor: HTMLElement) => report(target, anchor);
          out.set(
            item.key,
            <div key={item.key} {...wrapper}>
              {target.kind === "addProtocol" ? (
                <AddProtocolTemplate
                  tooltip={copy.addProtocol(networkName(target.network))}
                  active={active}
                  onActivate={activate}
                />
              ) : (
                <AddNetworkTemplate
                  tooltip={copy.addNetwork}
                  active={active}
                  onActivate={activate}
                />
              )}
            </div>,
          );
          break;
        }
        case "port": {
          const target = item.node.target;
          const key = portTooltipKey(target.side, kinds.get(target.blockId) ?? "");
          out.set(
            item.key,
            <div key={item.key} {...wrapper}>
              <InsertPort
                tooltip={copy.port[key]}
                active={activeTargetKeys.has(targetKey(target))}
                onActivate={(anchor) => report(target, anchor)}
              />
            </div>,
          );
          break;
        }
        case "caption":
          // The templates above already carry these names: the captions are not read twice.
          out.set(
            item.key,
            <div key={item.key} {...wrapper} aria-hidden="true">
              <span className="block whitespace-nowrap text-muted-foreground text-xs leading-normal">
                {item.caption === "addProtocol" ? copy.emptyAddProtocol : copy.emptyAddNetwork}
              </span>
            </div>,
          );
          break;
        case "sentence":
          out.set(
            item.key,
            <p
              key={item.key}
              {...wrapper}
              className="m-0 whitespace-nowrap text-center text-muted-foreground text-xs leading-normal"
            >
              {copy.startHere}
            </p>,
          );
          break;
        case "label":
          break;
      }
    }
    return out;
  }, [
    items,
    motion,
    copy,
    describeBlock,
    describeFlow,
    networkName,
    shares,
    kinds,
    selectedId,
    activeTargetKeys,
    invalidNetworks,
    canRemoveSpoke,
    onRemoveBlock,
    report,
  ]);

  // [BB8] A label lights its edge; leaving clears the light only if it is still its own.
  const hoverLabel = useCallback((edgeId: string, hovered: boolean) => {
    setHoveredEdge((current) => (hovered ? edgeId : current === edgeId ? null : current));
  }, []);

  return (
    <div
      data-build-graph=""
      className="relative"
      style={{ width: layout.width, height: layout.height }}
    >
      <div
        data-graph-layer="lines"
        className="pointer-events-none absolute top-0 left-0"
        style={{ zIndex: GRAPH_LAYER.lines }}
      >
        <GraphEdges
          width={layout.width}
          height={layout.height}
          edges={edges}
          connections={connections}
          highlightedId={hoveredEdge}
          onEdgeHoverChange={setHoveredEdge}
        />
      </div>
      {items.map((item) => {
        if (item.type !== "label") return nodes.get(item.key) ?? null;
        const label = item.node;
        // The item's own stub: two spokes on one network each light their own line (F6).
        const edgeId = item.edgeId;
        return (
          <div key={item.key} {...wrapperProps(item, motion)}>
            <ShareLabel
              text={formatShare(label.pct)}
              tooltip={copy.share(shareNumber(label.pct))}
              highlighted={hoveredEdge === edgeId}
              // POO-2237: a spoke label opens its allocation editor through the existing target.
              onActivate={(anchor) => report(label.target, anchor)}
              onHoverChange={(hovered) => hoverLabel(edgeId, hovered)}
            />
          </div>
        );
      })}
    </div>
  );
});
