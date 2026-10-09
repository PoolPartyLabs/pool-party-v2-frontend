/**
 * @id PP-MGR-LIB-024
 * @name blockRegistry
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none, a pure module. What the canvas does with a block is reported by
 *   `useBuildCanvas` through `onEvent`, and the Build screen (PP-MGR-SCR-002, S7) maps it to events.
 *
 * One definition per block kind (handoff v1.2 "Building blocks"): its icon, its palette section, where
 * it can be placed, which companion the app places with it, which field an empty block waits for.
 * Then the two functions the renderer (S6) calls for every card and pill: {@link describeBlock} and
 * {@link describeFlow}, which derive a card's title, caption, state and accessible name from its
 * `config` (heads-up HU2), so the card re-renders the moment the panel batch writes a config.
 *
 * LEGALITY IS NOT HERE. Whether a kind may be placed on a network (C22, INV2), which ports exist
 * (C17) and what fits them (I4) are S1's rules (`kindAvailability`, `portSlotsOf`, `insertOptions`),
 * one source of truth the reducers also read. The registry reads `BLOCK_KIND_STATUS` instead of
 * keeping a copy; its `placement` (read by the menus and the drop targets) is held equal to the
 * reducers by a test. The Swap · auto companion is S1's alone (`reconcileAutoBlocks`), so the
 * registry keeps no field for it (review F5 of PR #36).
 *
 * Card states (D27, D6, C22), in order of precedence:
 * 1. `comingSoon`: the kind's status is coming soon, whatever the mandate holds;
 * 2. `invalid`: the block names something the mandate no longer holds (an INV2 violation on the
 *    block, or a spoke whose network left the mandate); its caption reads "No longer in your
 *    mandate" and the block is never deleted silently;
 * 3. `empty`: `config` is null (G6: every block the manager adds in this batch);
 * 4. `default`.
 */
import { networkStableSymbol } from "@/lib/chains/config";
import { formatPercent } from "@/lib/utils/format";
import {
  HUB_NETWORK,
  type MandateDraft,
  type NetworkId,
  normalizeTokenIdentity,
  tokenKey,
} from "../../mandateDraft";
import type { BlockContent, BlockIcon, FlowContent } from "../pieces/pieceTypes";
import { findMandatePool } from "../plan/blockConfig";
import {
  BLOCK_KIND_PROTOCOL,
  BLOCK_KIND_STATUS,
  type BlockKind,
  type BlockKindStatus,
  type BuildPlan,
  type FlowKind,
  type PositionBlock,
} from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import type { PlanViolation } from "../plan/planInvariants";
import { arrivingTokenKey, isLiquidityKind, isPoolKind, isSolanaKind } from "../plan/planRules";
import type { BlockCopy } from "./blockCopy";

/** The share placeholder of a sentence that already prints "%": "60", "33.3" (through format.ts). */
export function shareNumber(pct: number): string {
  return formatPercent(pct, Number.isInteger(pct) ? 0 : 1).replace(/%$/, "");
}

/** A pool fee tier from basis points, as the fee caption prints it: 5 bps is "0.05" (format.ts). */
export function feeNumber(feeBps: number): string {
  return formatPercent(feeBps / 100, 2).replace(/%$/, "");
}

/** Where a kind can be placed (S1 decides; this names it). */
export type BlockPlacement = "newChain" | "afterSupply";

/** One block kind, as the canvas presents it. */
export interface BlockDefinition {
  kind: BlockKind;
  /** C22, read from `BLOCK_KIND_STATUS`. */
  status: BlockKindStatus;
  icon: BlockIcon;
  /**
   * The translation keys of the protocol name ("Uniswap v4") and of the block type ("Liquidity
   * position"). Kept because the shared contract (plan section 3.5) names them for the panel batch;
   * this slice reads the same keys as literals in `blockCopy`, so the i18n usage scan binds them.
   */
  protocolNameKey: string;
  blockTypeKey: string;
  paletteSection: "mandate" | "comingSoon";
  /** A new chain (a row's Add protocol circle), or directly under a Supply (its bottom port). */
  placement: BlockPlacement;
  /** What an empty block waits for: "Pick a pool", "Pick an asset"; null for undrawn kinds. */
  configField: "pool" | "asset" | null;
}

function definition(
  kind: BlockKind,
  icon: BlockIcon,
  placement: BlockPlacement,
  configField: BlockDefinition["configField"],
): BlockDefinition {
  const status = BLOCK_KIND_STATUS[kind];
  return {
    kind,
    status,
    icon,
    protocolNameKey: `fundBuilder.canvas.blocks.${kind}.protocol`,
    blockTypeKey: `fundBuilder.canvas.blocks.${kind}.type`,
    paletteSection: status === "comingSoon" ? "comingSoon" : "mandate",
    placement,
    configField,
  };
}

/**
 * Every block kind, in palette and menu order. Pendle and GMX cards are not drawn yet (handoff
 * "Building blocks"); they take the pool's icon until they are.
 */
export const BLOCK_REGISTRY: Readonly<Record<BlockKind, BlockDefinition>> = {
  uniswapV4Pool: definition("uniswapV4Pool", "layers", "newChain", "pool"),
  aaveSupply: definition("aaveSupply", "bank", "newChain", "asset"),
  aaveBorrow: definition("aaveBorrow", "bank", "afterSupply", "asset"),
  uniswapV3Pool: definition("uniswapV3Pool", "layers", "newChain", "pool"),
  pendle: definition("pendle", "layers", "newChain", null),
  gmxPerp: definition("gmxPerp", "layers", "newChain", null),
  solanaOrcaPool: definition("solanaOrcaPool", "layers", "newChain", null),
  solanaRaydiumPool: definition("solanaRaydiumPool", "layers", "newChain", null),
  solanaKaminoSupply: definition("solanaKaminoSupply", "bank", "newChain", null),
  solanaHolding: definition("solanaHolding", "hourglass", "newChain", null),
};

/** The kinds in registry order (the order the palette and the menus list them). */
export const BLOCK_KINDS: readonly BlockKind[] = Object.keys(BLOCK_REGISTRY) as BlockKind[];

/** What {@link describeBlock} and {@link describeFlow} read. */
export interface DescribeContext {
  plan: BuildPlan;
  draft: MandateDraft;
  /** `validatePlan` of the plan (useBuildPlan's memoised list). */
  violations: readonly PlanViolation[];
  copy: BlockCopy;
}

const INVALID_BLOCK_CODES: ReadonlySet<PlanViolation["code"]> = new Set([
  "kind_not_in_mandate",
  "kind_not_on_network",
  "config_not_in_mandate",
]);

/** D6: whether a block names something the mandate no longer holds. */
export function isBlockInvalid(
  blockId: string,
  network: NetworkId,
  violations: readonly PlanViolation[],
): boolean {
  return violations.some(
    (v) =>
      (INVALID_BLOCK_CODES.has(v.code) && v.targetId === blockId) ||
      (v.code === "network_not_in_mandate" && v.targetId === network),
  );
}

/** The symbol of a mandate token of this network, or null when the draft does not hold it. */
function tokenSymbol(draft: MandateDraft, network: NetworkId, key: string): string | null {
  const lower = normalizeTokenIdentity(network, key);
  return draft.tokens.find((t) => t.network === network && tokenKey(t) === lower)?.symbol ?? null;
}

/** Title and caption of a position block from its config (HU2), before any state override. */
function titleAndCaption(
  block: PositionBlock,
  network: NetworkId,
  ctx: DescribeContext,
): { title: string; caption: string } {
  const { copy, draft } = ctx;
  const protocol = copy.protocolName(block.kind);
  if (isSolanaKind(block.kind))
    return {
      title: protocol,
      caption: block.config && "pair" in block.config ? block.config.pair : copy.card.pickAsset,
    };
  if (isPoolKind(block.kind)) {
    const config = block.config as { poolId: string } | null;
    // The bare PoolId of a real-mode row (or a mock row's id), inside the block's network.
    const pool = config ? findMandatePool(draft.pools, network, config.poolId) : undefined;
    if (!pool) return { title: protocol, caption: copy.card.pickPool };
    return {
      title: copy.card.poolTitle(pool.token0.symbol, pool.token1.symbol),
      caption: copy.card.poolCaption(protocol, feeNumber(pool.feeBps)),
    };
  }
  if (block.kind === "aaveSupply" || block.kind === "aaveBorrow") {
    const symbol = block.config ? tokenSymbol(draft, network, block.config.assetKey) : null;
    if (symbol === null) {
      return {
        title: block.kind === "aaveSupply" ? copy.card.emptySupply : copy.card.emptyBorrow,
        caption: copy.card.pickAsset,
      };
    }
    if (block.kind === "aaveBorrow") {
      return { title: copy.card.borrowTitle(symbol), caption: copy.card.aaveCaption };
    }
    return {
      title: copy.card.supplyTitle(symbol),
      caption:
        network === HUB_NETWORK
          ? copy.card.aaveCaption
          : copy.card.aaveCaptionOnNetwork(copy.networkName(network)),
    };
  }
  // Pendle and GMX: not drawn yet, so the card reads its protocol over its type.
  return { title: protocol, caption: copy.blockType(block.kind) };
}

/** A card for an id the plan does not hold: neutral, so a stale render never throws. */
function unknownCard(): BlockContent {
  return { title: "", caption: "", icon: "layers", state: "invalid", accessibleName: "" };
}

/**
 * HU2, D27, C22, I10: what a position card shows, derived from its kind, its `config`, the plan's
 * violations and the C22 table. The accessible name states the card's place ("WETH / USDC, Uniswap
 * v4 · 0.05%, on Arbitrum, 60% of the capital"), the share being its chain's.
 */
export function describeBlock(blockId: string, ctx: DescribeContext): BlockContent {
  const found = findBlock(ctx.plan, blockId);
  if (found?.block.family !== "position") return unknownCard();
  const block = found.block;
  const def = BLOCK_REGISTRY[block.kind];
  const { copy } = ctx;
  const base = titleAndCaption(block, found.network, ctx);
  const state: BlockContent["state"] =
    def.status === "comingSoon"
      ? "comingSoon"
      : isBlockInvalid(block.id, found.network, ctx.violations)
        ? "invalid"
        : block.config === null
          ? "empty"
          : "default";
  const caption = state === "invalid" ? copy.card.invalid : base.caption;
  const content: BlockContent = {
    title: base.title,
    caption,
    icon: def.icon,
    state,
    accessibleName: copy.card.accessibleName({
      title: base.title,
      caption,
      network: copy.networkName(found.network),
      pct: shareNumber(found.chain.sharePct),
    }),
  };
  if (state === "comingSoon") content.soonTag = copy.palette.soon;
  return content;
}

/** A pill for an id the plan does not hold. */
function unknownPill(): FlowContent {
  return { text: "", tooltip: "", icon: "swap" };
}

/**
 * C13, C19, D7: what a flow pill shows. A Swap · auto names the token that arrives (the network's
 * stable at the head of a chain, so USDG on Robinhood Chain; a Borrow's asset after a Borrow) and,
 * before a Supply, the asset it buys. The Bridge is not a plan block: S6 draws it from its spoke.
 */
export function describeFlow(blockId: string, ctx: DescribeContext): FlowContent {
  const found = findBlock(ctx.plan, blockId);
  if (found?.block.family !== "flow") return unknownPill();
  const { copy } = ctx;
  const kind: FlowKind = found.block.kind;
  if (kind === "collectFees") {
    return { text: copy.flow.collectFees, tooltip: copy.tooltip.collectFees, icon: "coins" };
  }
  if (!found.block.auto) {
    return {
      text:
        ctx.draft.runtime === "solana-local" && found.network === "solana"
          ? (copy.flow.jupiter ?? copy.flow.swap)
          : copy.flow.swap,
      tooltip: copy.tooltip.swap,
      icon: "swap",
    };
  }
  const next = found.chain.steps[found.index + 1];
  // `{token}` is the token that ACTUALLY arrives (a Borrow's asset after a Borrow), and the
  // network's stable when the plan does not say. A deviation from D7 (always the network's stable),
  // APPROVED by the coordinator in the review of PR #36.
  const arrivingKey = next ? arrivingTokenKey(ctx.plan, ctx, next.id) : null;
  const token =
    (arrivingKey ? tokenSymbol(ctx.draft, found.network, arrivingKey) : null) ??
    (found.network === "solana" ? "USDC" : networkStableSymbol(found.network));
  if (next?.family === "position" && next.kind === "aaveSupply" && next.config) {
    const asset = tokenSymbol(ctx.draft, found.network, next.config.assetKey);
    if (asset) {
      return {
        text: copy.flow.swapAuto,
        tooltip: copy.tooltip.swapAutoSupply(token, asset),
        icon: "swap",
      };
    }
  }
  return { text: copy.flow.swapAuto, tooltip: copy.tooltip.swapAuto(token), icon: "swap" };
}

/** The head of the panel stub for a selected block (AN10). */
export interface PanelHead {
  /** The block kind, which picks the protocol logo. */
  blockKind: BlockKind;
  /** The title: "Uniswap v4", "Aave v3". */
  protocolName: string;
  /** The caption: "Liquidity position", or "Liquidity position · no pool yet" while empty. */
  blockType: string;
  /** Where the block sits (C5), for the network chip. */
  network: NetworkId;
  networkName: string;
}

/**
 * AN10: the head of the panel stub for a selected block: protocol name over block type, the type
 * saying what an empty block still lacks (" · no pool yet", " · no asset yet"), and the network the
 * block sits on (C5). Null for a pill or an id the plan does not hold: only cards are selectable.
 */
export function describePanelHead(blockId: string, ctx: DescribeContext): PanelHead | null {
  const found = findBlock(ctx.plan, blockId);
  if (found?.block.family !== "position") return null;
  const { copy } = ctx;
  const kind = found.block.kind;
  const type = copy.blockType(kind);
  const field = BLOCK_REGISTRY[kind].configField;
  const blockType =
    found.block.config !== null || field === null
      ? type
      : field === "pool"
        ? copy.panel.typeNoPool(type)
        : copy.panel.typeNoAsset(type);
  return {
    blockKind: kind,
    protocolName: copy.protocolName(kind),
    blockType,
    network: found.network,
    networkName: copy.networkName(found.network),
  };
}

// ---------------------------------------------------------------------------
// Palette (AN8, D25)
// ---------------------------------------------------------------------------

/** What a palette row drags: a position kind, or a flow block the manager places. */
export type PaletteDragItem =
  | { family: "position"; kind: BlockKind }
  | { family: "flow"; kind: FlowKind; network?: NetworkId };

/** One palette row. `drag` null: not draggable (coming soon). */
export interface PaletteItem {
  /** The kind it stands for, also the id of its logo or icon. */
  id: BlockKind | FlowKind | "jupiter";
  name: string;
  /** The block type under the name; null for a flow row. */
  caption: string | null;
  drag: PaletteDragItem | null;
}

export interface PaletteSection {
  id: "mandate" | "flow" | "comingSoon";
  label: string;
  items: PaletteItem[];
}

export interface PaletteModel {
  /** In display order. An empty mandate section is left out. */
  sections: PaletteSection[];
  /** The caption under the mandate and flow lists. */
  caption: string;
  soonTag: string;
  soonTooltip: string;
}

/**
 * AN8, D25: the palette of a mandate. FROM YOUR MANDATE lists the enabled kinds whose protocol is in
 * the mandate (whatever the network: the drop targets say where); FLOW BLOCKS lists Swap, and Collect
 * fees only when an enabled pool protocol is in the mandate (Uniswap v4 today); COMING SOON lists the
 * coming-soon kinds whatever the mandate holds (C22, D12). No Bridge (the app places it, C4) and no
 * Output (the spine is fixed, C2).
 */
export function paletteModel(draft: MandateDraft, copy: BlockCopy): PaletteModel {
  const inMandate = (kind: BlockKind) => {
    const protocol = BLOCK_KIND_PROTOCOL[kind];
    if (isSolanaKind(kind))
      return (
        draft.runtime === "solana-local" &&
        draft.networks.includes("solana") &&
        (kind === "solanaHolding" || (protocol !== null && draft.protocols.includes(protocol)))
      );
    return protocol !== null && draft.protocols.includes(protocol);
  };
  const mandate: PaletteItem[] = BLOCK_KINDS.filter(
    (kind) => BLOCK_REGISTRY[kind].status === "enabled" && inMandate(kind),
  ).map((kind) => ({
    id: kind,
    name: copy.protocolName(kind),
    caption: copy.blockType(kind),
    drag: { family: "position", kind },
  }));
  const hasEnabledPool = BLOCK_KINDS.some(
    (kind) => isLiquidityKind(kind) && BLOCK_REGISTRY[kind].status === "enabled" && inMandate(kind),
  );
  const flow: PaletteItem[] = [
    { id: "swap", name: copy.flow.swap, caption: null, drag: { family: "flow", kind: "swap" } },
  ];
  if (
    draft.runtime === "solana-local" &&
    draft.networks.includes("solana") &&
    draft.protocols.includes("jupiter")
  )
    flow.push({
      id: "jupiter",
      name: copy.flow.jupiter ?? copy.flow.swap,
      caption: copy.networkName("solana"),
      drag: { family: "flow", kind: "swap", network: "solana" },
    });
  if (hasEnabledPool) {
    flow.push({
      id: "collectFees",
      name: copy.flow.collectFees,
      caption: null,
      drag: { family: "flow", kind: "collectFees" },
    });
  }
  const comingSoon: PaletteItem[] = BLOCK_KINDS.filter(
    (kind) => BLOCK_REGISTRY[kind].status === "comingSoon",
  ).map((kind) => ({ id: kind, name: copy.protocolName(kind), caption: null, drag: null }));

  const sections: PaletteSection[] = [];
  if (mandate.length > 0) {
    sections.push({ id: "mandate", label: copy.palette.fromMandate, items: mandate });
  }
  sections.push({ id: "flow", label: copy.palette.flowBlocks, items: flow });
  if (comingSoon.length > 0) {
    sections.push({ id: "comingSoon", label: copy.palette.comingSoon, items: comingSoon });
  }
  return {
    sections,
    caption: copy.palette.caption,
    soonTag: copy.palette.soon,
    soonTooltip: copy.palette.soonTooltip,
  };
}
