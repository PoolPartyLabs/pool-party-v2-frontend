/**
 * @id PP-MGR-LIB-021
 * @name planRules
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none, a pure domain module.
 *
 * The rules of the canvas that are not reducers: which kinds a row may hold (C22, INV2), where the
 * insert ports sit (C17), what fits each port (I4) and which token arrives at a block (C13). One
 * source of truth for what is legal: the reducers, the invariants, the layout (S3) and the menus
 * (S5) all read these, and none keeps a copy.
 *
 * `insertOptions` returns the I4 list ONLY (coordinator default D1): before a card, Swap; after a
 * pool, Collect fees; after a Supply, Borrow and Swap; after a Borrow, Swap (C13). Whether a pool
 * or another Supply may sit directly under a Supply is open point 1 of the handoff; `validatePlan`
 * accepts any plan that satisfies INV5, but nothing here offers more than this list.
 *
 * It is STRUCTURAL: it reads the plan, never the mandate. Whether the Borrow it lists is available
 * in this mandate on this network is `kindAvailability`'s answer, which `insertAt` checks and the
 * port menu (S5) shows.
 */
import { depositTokenRefFor, type NetworkId, tokenKey } from "../../mandateDraft";
import {
  BLOCK_KIND_PROTOCOL,
  BLOCK_KIND_STATUS,
  type BlockKind,
  type BuildPlan,
  type PlanContext,
  type PoolBlockKind,
  type PositionBlock,
  type Step,
} from "./buildPlan";
import { findBlock } from "./planDerive";

export type InsertSide = "before" | "after";

/** A port: the top ("before") or bottom ("after") edge of one card. */
export interface InsertSlot {
  side: InsertSide;
  blockId: string;
}

/** What a port's menu can insert (I4). */
export type InsertChoice =
  | { family: "flow"; kind: "swap" }
  | { family: "flow"; kind: "collectFees" }
  | { family: "position"; kind: "aaveBorrow" };

/** C17 on a minimal step shape, so the layout (S3) and the menus (S5) share one rule. */
export interface PortStepShape {
  family: "position" | "flow";
  kind: string;
  configured: boolean;
}

export type KindAvailability = "enabled" | "coming_soon" | "not_in_mandate" | "not_on_network";

/** Whether a kind is one of the two pool kinds. */
export function isPoolKind(kind: string): kind is PoolBlockKind {
  return kind === "uniswapV4Pool" || kind === "uniswapV3Pool";
}

/** LP capability is distinct from the canonical Uniswap pool configuration. */
export function isLiquidityKind(kind: string): boolean {
  return isPoolKind(kind) || kind === "solanaOrcaPool" || kind === "solanaRaydiumPool";
}
export function isSolanaKind(kind: string): boolean {
  return kind.startsWith("solana");
}

/** A plan step as the port rule reads it. A pill counts as configured: only cards can be empty. */
export function toPortStepShape(step: Step): PortStepShape {
  return {
    family: step.family,
    kind: step.kind,
    configured: step.family === "position" ? step.config !== null : true,
  };
}

/**
 * C17: the ports of every card of a chain, by index in `steps`. Pills get no entry.
 *
 * Top port iff the card is configured, the step directly before it is not a pill, and it is not a
 * Borrow directly under a Supply. Bottom port iff configured, the step directly after it is not a
 * pill, and it is not a Supply directly above a Borrow (C14: nothing goes between a loan and its
 * collateral). An empty block has no port until it is configured.
 */
export function portSlotsOf(
  steps: readonly PortStepShape[],
): Array<{ index: number; top: boolean; bottom: boolean }> {
  const out: Array<{ index: number; top: boolean; bottom: boolean }> = [];
  steps.forEach((step, index) => {
    if (step.family !== "position") return;
    const before = steps[index - 1];
    const after = steps[index + 1];
    const underItsSupply = step.kind === "aaveBorrow" && before?.kind === "aaveSupply";
    const overItsBorrow = step.kind === "aaveSupply" && after?.kind === "aaveBorrow";
    out.push({
      index,
      top: step.configured && before?.family !== "flow" && !underItsSupply,
      bottom: step.configured && after?.family !== "flow" && !overItsBorrow,
    });
  });
  return out;
}

/** I4: what fits a port, from the I4 list only (D1). Empty when the card has no port there. */
export function insertOptions(plan: BuildPlan, slot: InsertSlot): InsertChoice[] {
  const found = findBlock(plan, slot.blockId);
  if (found?.block.family !== "position") return [];
  const port = portSlotsOf(found.chain.steps.map(toPortStepShape)).find(
    (entry) => entry.index === found.index,
  );
  if (!port || !(slot.side === "before" ? port.top : port.bottom)) return [];
  if (slot.side === "before") return [{ family: "flow", kind: "swap" }];
  const kind = found.block.kind;
  if (isLiquidityKind(kind)) return [{ family: "flow", kind: "collectFees" }];
  if (kind === "aaveSupply") {
    return [
      { family: "position", kind: "aaveBorrow" },
      { family: "flow", kind: "swap" },
    ];
  }
  if (kind === "aaveBorrow") return [{ family: "flow", kind: "swap" }];
  return [];
}

/**
 * C22, INV2: whether a kind can be placed on a network, in this order of precedence:
 *
 * 1. `coming_soon`: the C22 table, whatever the mandate holds;
 * 2. `not_in_mandate`: the kind's protocol is not in `draft.protocols` (Pendle and GMX have no
 *    protocol at all, so they can never be in it);
 * 3. `not_on_network`: the catalog's `availableOn` for that protocol lacks the network.
 *
 * Whether the network is the hub or a spoke ON THE CANVAS is not its job: `addChain` answers
 * `unknown_target` for a network with no row. The reducers report `not_on_network` as the reason
 * `not_in_mandate`, so `PlanBlockReason` gains no value for it.
 */
export function kindAvailability(
  kind: BlockKind,
  network: NetworkId,
  ctx: Pick<PlanContext, "draft" | "catalog">,
): KindAvailability {
  if (isSolanaKind(kind)) {
    if (ctx.draft.runtime !== "solana-local") return "not_in_mandate";
    if (network !== "solana" || !ctx.draft.networks.includes("solana")) return "not_on_network";
    if (kind === "solanaHolding") return "enabled";
  }
  if (BLOCK_KIND_STATUS[kind] === "comingSoon") return "coming_soon";
  const protocol = BLOCK_KIND_PROTOCOL[kind];
  if (protocol === null || !ctx.draft.protocols.includes(protocol)) return "not_in_mandate";
  const entry = ctx.catalog.protocols.find((p) => p.id === protocol);
  if (!entry?.availableOn.includes(network)) return "not_on_network";
  return "enabled";
}

/**
 * The token that arrives at the head of a chain on this network: the hub's USDC, a spoke's own
 * deposit token (USDG on Robinhood Chain). The mandate's locked row wins, since it is the one the
 * manager saw; the chain config answers for a draft that somehow lacks it.
 */
function headTokenKey(network: NetworkId, draft: PlanContext["draft"]): string | null {
  const locked = draft.tokens.find((t) => t.locked && t.network === network);
  if (locked) return tokenKey(locked);
  const deposit = depositTokenRefFor(network);
  return deposit ? tokenKey(deposit) : null;
}

/**
 * The token arriving at `steps[index]`, or null when it is not known. App-owned Swap · auto blocks
 * are skipped: they are what this answer decides. Directly under the row, the network's deposit
 * token; after a Borrow, its asset (unknown while the Borrow is empty); after anything else (a
 * manager Swap, a pool, a Supply, a Collect fees) the plan does not say, so null.
 */
export function arrivingTokenAt(
  steps: readonly Step[],
  index: number,
  network: NetworkId,
  draft: PlanContext["draft"],
): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (!step || (step.family === "flow" && step.auto)) continue;
    if (step.family === "position" && step.kind === "aaveBorrow") {
      return step.config?.assetKey ?? null;
    }
    return null;
  }
  return headTokenKey(network, draft);
}

/** C13: the token arriving at a block of the plan, or null when unknown (or no such block). */
export function arrivingTokenKey(
  plan: BuildPlan,
  ctx: Pick<PlanContext, "draft">,
  blockId: string,
): string | null {
  const found = findBlock(plan, blockId);
  if (!found) return null;
  return arrivingTokenAt(found.chain.steps, found.index, found.network, ctx.draft);
}

/**
 * C13: whether the app places a Swap · auto directly before this card. Always before a pool; before
 * a Supply iff its asset is known and differs from the token that arrives (also known); never
 * before anything else.
 */
export function needsAutoSwap(block: PositionBlock, arriving: string | null): boolean {
  if (isLiquidityKind(block.kind)) return true;
  if (block.kind === "solanaHolding") return block.config?.pair === "SOL / USDC";
  if (block.kind !== "aaveSupply" || block.config === null || arriving === null) return false;
  return block.config.assetKey.toLowerCase() !== arriving.toLowerCase();
}
