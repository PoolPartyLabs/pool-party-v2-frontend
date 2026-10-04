/**
 * @id PP-MGR-LIB-021
 * @name planReducers
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module. A refusal returns `{ blocked }` and the Build
 *   screen (PP-MGR-SCR-002, slice S7) reports it as `builder_build_blocked`.
 *
 * Every edit the canvas can make to a plan, each one keeping the plan legal.
 *
 * The same contract as the mandate reducers (`mandateDraft.ts`), for the same reasons:
 *
 * - PURE and IMMUTABLE. A reducer returns a new plan and leaves its input alone; the hook
 *   (`useBuildPlan`) keeps the previous draft when a reducer refuses, so one that mutated on its way
 *   to a refusal would leave the canvas showing a change the store rejected.
 * - NO CLOCK, NO RANDOMNESS. Every new id comes from `ctx.newId`, so equal input gives equal output.
 * - ONLY THE EDITED CHAIN MOVES (C18). Every other chain and spoke keeps its object identity, which
 *   is also what lets the layout and the renderer skip what did not change.
 *
 * Every success runs {@link reconcileAutoBlocks}: the app-owned Swap · auto blocks are a function of
 * the plan (C13, INV6), never an edit of their own, so no reducer places or removes one by hand.
 *
 * Refusals, and the reason each reports, follow the shared contract (plan section 3.1). A kind the
 * catalog does not offer on that network (`kindAvailability` "not_on_network") is reported as
 * `not_in_mandate`, so `PlanBlockReason` gains no value for it.
 */
import { HUB_NETWORK, type NetworkId, tokenKey } from "../../mandateDraft";
import {
  configShapeOfKind,
  findMandatePool,
  isConfigFor,
  isRangeOnGrid,
  poolRefKey,
} from "./blockConfig";
import {
  type AaveBlockConfig,
  BLOCK_KIND_PROTOCOL,
  type BlockKind,
  type BuildPlan,
  type Chain,
  isPlanBlocked,
  type PlanBlockReason,
  type PlanContext,
  type PlanReducerResult,
  type PoolBlockConfig,
  type PositionBlock,
  type Spoke,
  type Step,
} from "./buildPlan";
import { allocatedPct, findBlock } from "./planDerive";
import {
  arrivingTokenAt,
  type InsertChoice,
  type InsertSlot,
  insertOptions,
  isPoolKind,
  kindAvailability,
  needsAutoSwap,
} from "./planRules";

/** Shares are compared with this slack, so 33.3 + 33.3 + 33.4 is not "more than 100". */
const SHARE_EPSILON = 1e-9;

function blocked(reason: PlanBlockReason, targetId: string | null): PlanReducerResult {
  return { blocked: { reason, targetId } };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function hasPosition(steps: readonly Step[]): boolean {
  return steps.some((step) => step.family === "position");
}

/** A new empty card of a kind. The cast is the one place a kind and its config type meet. */
function emptyPosition(kind: BlockKind, id: string): PositionBlock {
  return { id, family: "position", kind, config: null } as PositionBlock;
}

// ---------------------------------------------------------------------------
// Plan surgery that keeps every untouched chain and spoke by identity
// ---------------------------------------------------------------------------

/** Rewrite one chain of the plan (or drop it, when `edit` returns null); everything else is kept. */
function editChain(
  plan: BuildPlan,
  chainId: string,
  edit: (chain: Chain) => Chain | null,
): BuildPlan {
  const editList = (chains: Chain[]): Chain[] | null => {
    const index = chains.findIndex((chain) => chain.id === chainId);
    const current = chains[index];
    if (!current) return null;
    const next = edit(current);
    return next === null
      ? chains.filter((_, i) => i !== index)
      : chains.map((chain, i) => (i === index ? next : chain));
  };
  const hubChains = editList(plan.hub.chains);
  if (hubChains) return { ...plan, hub: { ...plan.hub, chains: hubChains } };
  const spokes = plan.spokes.map((spoke) => {
    const chains = editList(spoke.chains);
    return chains ? { ...spoke, chains } : spoke;
  });
  return { ...plan, spokes };
}

/** Replace a chain's steps; a chain left with no position is removed (INV4). */
function withSteps(plan: BuildPlan, chainId: string, steps: Step[]): BuildPlan {
  return editChain(plan, chainId, (chain) => (hasPosition(steps) ? { ...chain, steps } : null));
}

/** Where a chain hangs: the hub (spokeIndex null) or a spoke. */
function locateChain(
  plan: BuildPlan,
  chainId: string,
): { chain: Chain; spokeIndex: number | null } | null {
  const hub = plan.hub.chains.find((chain) => chain.id === chainId);
  if (hub) return { chain: hub, spokeIndex: null };
  for (const [spokeIndex, spoke] of plan.spokes.entries()) {
    const chain = spoke.chains.find((c) => c.id === chainId);
    if (chain) return { chain, spokeIndex };
  }
  return null;
}

// ---------------------------------------------------------------------------
// reconcileAutoBlocks
// ---------------------------------------------------------------------------

/** One chain's steps with its Swap · auto blocks exactly where C13 wants them. */
function reconcileSteps(
  steps: Step[],
  network: NetworkId,
  ctx: Pick<PlanContext, "draft" | "newId">,
): Step[] {
  const out: Step[] = [];
  steps.forEach((step, index) => {
    if (step.family === "flow" && step.auto) return;
    if (step.family === "position") {
      const arriving = arrivingTokenAt(out, out.length, network, ctx.draft);
      if (needsAutoSwap(step, arriving)) {
        // Keep the id of the Swap · auto that already sat here, so it is the SAME block.
        const previous = steps[index - 1];
        const kept =
          previous?.family === "flow" && previous.auto && previous.kind === "swap"
            ? previous
            : null;
        out.push(kept ?? { id: ctx.newId(), family: "flow", kind: "swap", auto: true });
      }
    }
    out.push(step);
  });
  const unchanged = out.length === steps.length && out.every((step, i) => step === steps[i]);
  return unchanged ? steps : out;
}

function reconcileChains(
  chains: Chain[],
  network: NetworkId,
  ctx: Pick<PlanContext, "draft" | "newId">,
): Chain[] {
  let changed = false;
  const next = chains.map((chain) => {
    const steps = reconcileSteps(chain.steps, network, ctx);
    if (steps === chain.steps) return chain;
    changed = true;
    return { ...chain, steps };
  });
  return changed ? next : chains;
}

/**
 * C13, INV6: put a Swap · auto directly before every pool, and directly before a Supply whose
 * asset is known and differs from the token arriving there (the hub's USDC, a spoke's deposit token,
 * after a Borrow its asset, after a manager Swap unknown), and take every other auto block away.
 *
 * A Swap · auto that stays keeps its id. A plan that already satisfies the rule comes back as the
 * same object, and so does every chain that did not change.
 */
export function reconcileAutoBlocks(
  plan: BuildPlan,
  ctx: Pick<PlanContext, "draft" | "newId">,
): BuildPlan {
  const hubChains = reconcileChains(plan.hub.chains, HUB_NETWORK, ctx);
  let spokesChanged = false;
  const spokes = plan.spokes.map((spoke): Spoke => {
    const chains = reconcileChains(spoke.chains, spoke.network, ctx);
    if (chains === spoke.chains) return spoke;
    spokesChanged = true;
    return { ...spoke, chains };
  });
  if (hubChains === plan.hub.chains && !spokesChanged) return plan;
  return {
    ...plan,
    hub: hubChains === plan.hub.chains ? plan.hub : { ...plan.hub, chains: hubChains },
    spokes: spokesChanged ? spokes : plan.spokes,
  };
}

// ---------------------------------------------------------------------------
// Rows and spokes
// ---------------------------------------------------------------------------

/**
 * I1, C13, C22: a new chain at the right end of a row, holding one empty block, share 0.
 *
 * A pool chain arrives as [Swap · auto, pool]; a Supply chain as [Supply]. Collect fees is never
 * added with the pool (coordinator default D2). Refusals, in order: `coming_soon` (C22),
 * `not_in_mandate` (the protocol is not in the mandate or not offered on that network, or the
 * network itself is no longer in the mandate), then `unknown_target` (the network has no row on the
 * canvas), then `borrow_needs_supply` (a Borrow is never the head of a chain, C14).
 */
export function addChain(
  plan: BuildPlan,
  ctx: PlanContext,
  network: NetworkId,
  kind: BlockKind,
): PlanReducerResult {
  const availability = kindAvailability(kind, network, ctx);
  if (availability === "coming_soon") return blocked("coming_soon", network);
  if (availability !== "enabled") return blocked("not_in_mandate", network);
  const isHub = network === HUB_NETWORK;
  // A spoke placed while its network was in the mandate stays on the canvas after the mandate drops
  // it (open point 6, D6: never deleted silently), but nothing new is built on it (C6).
  if (!isHub && !ctx.draft.networks.includes(network)) return blocked("not_in_mandate", network);
  if (!isHub && !plan.spokes.some((spoke) => spoke.network === network)) {
    return blocked("unknown_target", network);
  }
  if (kind === "aaveBorrow") return blocked("borrow_needs_supply", network);

  const chain: Chain = { id: ctx.newId(), sharePct: 0, steps: [] };
  chain.steps = [emptyPosition(kind, ctx.newId())];
  const next: BuildPlan = isHub
    ? { ...plan, hub: { ...plan.hub, chains: [...plan.hub.chains, chain] } }
    : {
        ...plan,
        spokes: plan.spokes.map((spoke) =>
          spoke.network === network ? { ...spoke, chains: [...spoke.chains, chain] } : spoke,
        ),
      };
  return reconcileAutoBlocks(next, ctx);
}

/**
 * I2, INV1, C3, C4: a new spoke at the right of the existing ones, share 0, no chain.
 *
 * No Bridge is stored: a spoke's Bridge is derived (C4), so it comes and goes with the spoke.
 * Refuses the hub and a network outside the mandate (`not_in_mandate`), and a network already on
 * the canvas (`network_on_canvas`).
 */
export function addSpoke(plan: BuildPlan, ctx: PlanContext, network: NetworkId): PlanReducerResult {
  if (network === HUB_NETWORK || !ctx.draft.networks.includes(network)) {
    return blocked("not_in_mandate", network);
  }
  if (plan.spokes.some((spoke) => spoke.network === network)) {
    return blocked("network_on_canvas", network);
  }
  return reconcileAutoBlocks(
    { ...plan, spokes: [...plan.spokes, { network, sharePct: 0, chains: [] }] },
    ctx,
  );
}

/** I7 (coordinator default D5): remove a spoke, only while it has no chain. */
export function removeSpoke(
  plan: BuildPlan,
  ctx: PlanContext,
  network: NetworkId,
): PlanReducerResult {
  const spoke = plan.spokes.find((s) => s.network === network);
  if (!spoke) return blocked("unknown_target", network);
  if (spoke.chains.length > 0) return blocked("spoke_not_empty", network);
  return reconcileAutoBlocks(
    { ...plan, spokes: plan.spokes.filter((s) => s.network !== network) },
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * I4, C12, C13, C14, INV5: insert a block at a port, pushing the rest of that chain down (C18).
 *
 * Only what `insertOptions` lists for that slot is accepted (the I4 list, D1). Refusals, in order:
 * `unknown_target` (no such block); for a Borrow, `coming_soon` / `not_in_mandate` (its
 * availability on that network) and then `borrow_needs_supply` (anywhere but directly after a
 * Supply, A6); then `slot_not_allowed` (the slot has no port, or does not offer that choice).
 */
export function insertAt(
  plan: BuildPlan,
  ctx: PlanContext,
  slot: InsertSlot,
  choice: InsertChoice,
): PlanReducerResult {
  const found = findBlock(plan, slot.blockId);
  if (!found) return blocked("unknown_target", slot.blockId);
  if (choice.family === "position" && choice.kind === "aaveBorrow") {
    const availability = kindAvailability("aaveBorrow", found.network, ctx);
    if (availability === "coming_soon") return blocked("coming_soon", slot.blockId);
    if (availability !== "enabled") return blocked("not_in_mandate", slot.blockId);
    if (slot.side !== "after" || found.block.kind !== "aaveSupply") {
      return blocked("borrow_needs_supply", slot.blockId);
    }
  }
  const offered = insertOptions(plan, slot).some(
    (option) => option.family === choice.family && option.kind === choice.kind,
  );
  if (!offered) return blocked("slot_not_allowed", slot.blockId);

  const step: Step =
    choice.family === "position"
      ? emptyPosition(choice.kind, ctx.newId())
      : { id: ctx.newId(), family: "flow", kind: choice.kind, auto: false };
  const at = slot.side === "before" ? found.index : found.index + 1;
  const steps = [...found.chain.steps.slice(0, at), step, ...found.chain.steps.slice(at)];
  return reconcileAutoBlocks(withSteps(plan, found.chain.id, steps), ctx);
}

/**
 * I6, INV4, INV6, C18: remove a block and close the gap.
 *
 * A position takes with it the Swap · auto directly above it, the Collect fees directly after it
 * (a pool) and the Borrow directly under it (a Supply). The last position of a chain takes the chain
 * (INV4); the last chain of a spoke leaves the spoke, empty, with its Bridge and its centred Add
 * protocol circle. An app-owned block is refused (`auto_owned`, INV6); a manager Swap or Collect
 * fees goes on its own (the reducer exists for the panel batch, where pills become selectable).
 */
export function removeBlock(plan: BuildPlan, ctx: PlanContext, blockId: string): PlanReducerResult {
  const found = findBlock(plan, blockId);
  if (!found) return blocked("unknown_target", blockId);
  const { block, chain, index } = found;
  if (block.family === "flow" && block.auto) return blocked("auto_owned", blockId);

  const drop = new Set<number>([index]);
  if (block.family === "position") {
    const above = chain.steps[index - 1];
    const below = chain.steps[index + 1];
    if (above?.family === "flow" && above.auto) drop.add(index - 1);
    if (isPoolKind(block.kind) && below?.family === "flow" && below.kind === "collectFees") {
      drop.add(index + 1);
    }
    if (
      block.kind === "aaveSupply" &&
      below?.family === "position" &&
      below.kind === "aaveBorrow"
    ) {
      drop.add(index + 1);
    }
  }
  const steps = chain.steps.filter((_, i) => !drop.has(i));
  return reconcileAutoBlocks(withSteps(plan, chain.id, steps), ctx);
}

/**
 * HU2, C13: set (or clear, with null) a card's configuration, then reconcile its Swap · auto.
 *
 * The pool must be a mandate pool of the block's network and protocol, named by its bare PoolId
 * (or a mock row's id, `findMandatePool`), the asset a mandate token of the block's network
 * (`not_in_mandate`, C6). A config whose shape does not match the block's kind, or that the stored
 * plan could not read back (`isConfigFor`: a field of the panel contract with a wrong type or out of
 * range), a flow block or an unknown id is `unknown_target`, and so is a range off the pool's grid
 * when the row carries its pool key (`isRangeOnGrid`: ticks on the pool's own spacing, Full on its
 * finite aligned extremes; a mock row has no pool key and nothing to check). Null always succeeds:
 * it empties the block. The config is stored as given (a copy, so fields the panel batch adds
 * survive) with the row's own ids, the bare PoolId of `poolRefKey` and the `tokenKey`, whatever
 * casing it came in: the launch compares them strictly (review M3 of PR #51).
 */
export function setBlockConfig(
  plan: BuildPlan,
  ctx: PlanContext,
  blockId: string,
  config: PoolBlockConfig | AaveBlockConfig | null,
): PlanReducerResult {
  const found = findBlock(plan, blockId);
  if (found?.block.family !== "position") return blocked("unknown_target", blockId);
  const block = found.block;
  let stored: PoolBlockConfig | AaveBlockConfig | null = null;
  if (config !== null) {
    if (!isConfigFor(block.kind, config)) return blocked("unknown_target", blockId);
    if (configShapeOfKind(block.kind) === "pool") {
      const poolConfig = config as PoolBlockConfig;
      const pool = findMandatePool(ctx.draft.pools, found.network, poolConfig.poolId);
      if (!pool || pool.protocol !== BLOCK_KIND_PROTOCOL[block.kind]) {
        return blocked("not_in_mandate", blockId);
      }
      const spacing = pool.poolKey?.tickSpacing;
      if (spacing !== undefined && !isRangeOnGrid(poolConfig, spacing)) {
        return blocked("unknown_target", blockId);
      }
      stored = { ...poolConfig, poolId: poolRefKey(pool) };
    } else {
      const assetKey = (config as AaveBlockConfig).assetKey.toLowerCase();
      const token = ctx.draft.tokens.find(
        (t) => t.network === found.network && tokenKey(t) === assetKey,
      );
      if (!token) return blocked("not_in_mandate", blockId);
      stored = { ...(config as AaveBlockConfig), assetKey: tokenKey(token) };
    }
  }
  const next = { ...block, config: stored } as PositionBlock;
  const steps = found.chain.steps.map((step, i) => (i === found.index ? next : step));
  return reconcileAutoBlocks(withSteps(plan, found.chain.id, steps), ctx);
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

/** A share outside 0..100 is refused: above 100 exceeds the strategy, below 0 is no share at all. */
function shareRefusal(pct: number, targetId: string): PlanReducerResult | null {
  if (!Number.isFinite(pct) || pct < 0) return blocked("unknown_target", targetId);
  if (pct > 100) return blocked("share_exceeds_parent", targetId);
  return null;
}

/**
 * HU5, C8, INV3: set a chain's share. A hub chain is checked against the strategy (hub chains plus
 * spokes never exceed 100); a spoke's chain against its spoke (its chains never exceed the spoke).
 */
export function setChainShare(
  plan: BuildPlan,
  ctx: PlanContext,
  chainId: string,
  pct: number,
): PlanReducerResult {
  const refusal = shareRefusal(pct, chainId);
  if (refusal) return refusal;
  const located = locateChain(plan, chainId);
  if (!located) return blocked("unknown_target", chainId);
  const others = (chains: readonly Chain[]) =>
    sum(chains.filter((chain) => chain.id !== chainId).map((chain) => chain.sharePct));
  const spoke = located.spokeIndex === null ? null : plan.spokes[located.spokeIndex];
  const total = spoke
    ? others(spoke.chains) + pct
    : others(plan.hub.chains) + pct + sum(plan.spokes.map((s) => s.sharePct));
  const ceiling = spoke ? spoke.sharePct : 100;
  if (total > ceiling + SHARE_EPSILON) return blocked("share_exceeds_parent", chainId);
  return reconcileAutoBlocks(
    editChain(plan, chainId, (chain) => ({ ...chain, sharePct: pct })),
    ctx,
  );
}

/**
 * HU5, C8, INV3: set a spoke's share. Refused when the hub chains plus the spokes would exceed 100,
 * or when the spoke would drop below what its own chains already hold.
 */
export function setSpokeShare(
  plan: BuildPlan,
  ctx: PlanContext,
  network: NetworkId,
  pct: number,
): PlanReducerResult {
  const refusal = shareRefusal(pct, network);
  if (refusal) return refusal;
  const spoke = plan.spokes.find((s) => s.network === network);
  if (!spoke) return blocked("unknown_target", network);
  const total =
    sum(plan.hub.chains.map((chain) => chain.sharePct)) +
    sum(plan.spokes.filter((s) => s.network !== network).map((s) => s.sharePct)) +
    pct;
  if (total > 100 + SHARE_EPSILON) return blocked("share_exceeds_parent", network);
  if (sum(spoke.chains.map((chain) => chain.sharePct)) > pct + SHARE_EPSILON) {
    return blocked("share_exceeds_parent", network);
  }
  return reconcileAutoBlocks(
    {
      ...plan,
      spokes: plan.spokes.map((s) => (s.network === network ? { ...s, sharePct: pct } : s)),
    },
    ctx,
  );
}

// ---------------------------------------------------------------------------
// The panel's Apply and Remove (POO-2184, handoff P3, P7, P8, P10)
// ---------------------------------------------------------------------------

/** Chain one reducer after another: a refusal ends the composition and comes back as it was. */
function then(
  result: PlanReducerResult,
  next: (plan: BuildPlan) => PlanReducerResult,
): PlanReducerResult {
  return isPlanBlocked(result) ? result : next(result);
}

/**
 * Finding 11, P3, P8, DP3: the panel's Apply, as ONE reducer, so it lands whole or not at all.
 *
 * Writes the block's config through {@link setBlockConfig} (its checks, its Swap · auto), then, when
 * `sharePct` is given, its chain's share through {@link setChainShare}. On a spoke the spoke's share
 * is the sum of its chains (open point 3, DP3), so {@link setSpokeShare} moves it too: raised BEFORE
 * the chain when the sum grows (the chain is checked against its spoke), lowered AFTER the chain
 * when it shrinks (the spoke is checked against its chains). A spoke holding more than its chains
 * comes down to their sum on the next Apply that gives a share.
 *
 * Only the first position of a chain has an Allocation (P8), so a share for any other block is
 * `unknown_target`, and so is a share that is not a whole percent from 0 (the launch takes whole
 * percents, `launch/plan.ts`); a share over what the parent holds is the share reducers' own
 * `share_exceeds_parent`. Any refusal comes back as it came, and the plan stays as it was.
 */
export function applyBlockConfig(
  plan: BuildPlan,
  ctx: PlanContext,
  blockId: string,
  config: PoolBlockConfig | AaveBlockConfig | null,
  sharePct?: number,
): PlanReducerResult {
  const found = findBlock(plan, blockId);
  if (found?.block.family !== "position") return blocked("unknown_target", blockId);
  if (sharePct !== undefined) {
    const first = found.chain.steps.find((step) => step.family === "position");
    if (first?.id !== blockId) return blocked("unknown_target", blockId);
    if (!Number.isInteger(sharePct) || sharePct < 0) return blocked("unknown_target", blockId);
  }
  const chainId = found.chain.id;
  const configured = setBlockConfig(plan, ctx, blockId, config);
  if (sharePct === undefined) return configured;
  return then(configured, (current) => {
    const spoke = current.spokes.find((s) => s.chains.some((chain) => chain.id === chainId));
    if (!spoke) return setChainShare(current, ctx, chainId, sharePct);
    const total =
      sharePct + sum(spoke.chains.filter((c) => c.id !== chainId).map((c) => c.sharePct));
    if (total > spoke.sharePct) {
      return then(setSpokeShare(current, ctx, spoke.network, total), (raised) =>
        setChainShare(raised, ctx, chainId, sharePct),
      );
    }
    return then(setChainShare(current, ctx, chainId, sharePct), (lowered) =>
      setSpokeShare(lowered, ctx, spoke.network, total),
    );
  });
}

/**
 * P10, I6, DP3: the panel's Remove block. {@link removeBlock} with its cascade, then, for a block
 * on a spoke, the spoke's share brought down to what its remaining chains hold, so the share of a
 * chain that leaves goes back to Idle input on a spoke as it does on the hub.
 */
export function removeBlockReleasingShare(
  plan: BuildPlan,
  ctx: PlanContext,
  blockId: string,
): PlanReducerResult {
  const network = findBlock(plan, blockId)?.network ?? null;
  return then(removeBlock(plan, ctx, blockId), (removed) => {
    const spoke = removed.spokes.find((s) => s.network === network);
    if (!spoke) return removed;
    const held = sum(spoke.chains.map((chain) => chain.sharePct));
    return held < spoke.sharePct ? setSpokeShare(removed, ctx, spoke.network, held) : removed;
  });
}

/** What the remove confirm says about one block (P10). */
export interface RemovalDescription {
  blockId: string;
  /** The block has no config: the confirm reads "Remove this block?" and nothing more. */
  empty: boolean;
  /** The share of the strategy that goes back to Idle input; 0 when the chain keeps it. */
  returnedPct: number;
  /** The block's chain goes with it (it was the chain's last position). */
  chainRemoved: boolean;
  /**
   * Every other step removed with it (its Swap · auto, its Collect fees, the Borrow under it and
   * what hangs under that Borrow), in plan order, as the plan held them.
   */
  removedWith: Step[];
}

/** Every step of a plan, in plan order. */
function allSteps(plan: BuildPlan): Step[] {
  return [
    ...plan.hub.chains.flatMap((chain) => chain.steps),
    ...plan.spokes.flatMap((spoke) => spoke.chains.flatMap((chain) => chain.steps)),
  ];
}

/**
 * P10: what removing a block takes with it, computed from the REAL remove
 * ({@link removeBlockReleasingShare}, built on {@link removeBlock}): the steps before minus the
 * steps after, and `allocatedPct` before minus after. So it cannot drift from the I6 cascade.
 * Null when the remove would be refused (an app-owned block, an unknown id).
 *
 * Two notes for the caller (review L3 and L4 of PR #51):
 * - it RUNS the remove, whose Swap · auto reconciliation may take ids from `ctx.newId`; called at
 *   render time, pass a throwaway id source (`newId: () => "describe-only"`) so describing never
 *   advances the real one;
 * - build the confirm sentence from `removedWith`, never from the handoff's wording: I6 removes the
 *   Borrow directly under a Supply, not everything placed under that Borrow.
 */
export function describeRemoval(
  plan: BuildPlan,
  ctx: PlanContext,
  blockId: string,
): RemovalDescription | null {
  const found = findBlock(plan, blockId);
  const after = removeBlockReleasingShare(plan, ctx, blockId);
  if (!found || isPlanBlocked(after)) return null;
  const kept = new Set(allSteps(after).map((step) => step.id));
  return {
    blockId,
    empty: found.block.family === "position" && found.block.config === null,
    returnedPct: allocatedPct(plan) - allocatedPct(after),
    chainRemoved: locateChain(after, found.chain.id) === null,
    removedWith: allSteps(plan).filter((step) => step.id !== blockId && !kept.has(step.id)),
  };
}
