/**
 * @id PP-MGR-LIB-028
 * @name planReadiness
 * @implements-rules-version v1 (POO-2184 rules v1); POO-2204 rules v1
 * @analytics-events none, a pure domain module. It names the refusal; the Build screen
 *   (PP-MGR-SCR-002) emits `builder_build_blocked` with it through `buildAnalytics.ts`, and the
 *   Review page (POO-2172) shows it among the Launch blockers.
 *
 * Whether a plan is ready for Review, as data (verification finding 4, coordinator decision A2).
 * This is the pure part of S7's Next: Review gate (`reviewVerdict`, `buildScreenModel.ts`), moved
 * here so Next: Review and the Review page's Launch blockers call ONE function, extended with what
 * the launch adapter (`launch/plan.ts`, `getLaunchSteps`) refuses. `getLaunchSteps` stays the
 * authority; `launchAgreement.test.ts` holds the two together.
 *
 * The checks run in a fixed order and the FIRST that fails is the answer, with the block to bring
 * into view (REVEAL, never select), or null when the fault is not one block. S7's checks keep their
 * order (its tests pin it); PA1's run after them, so a plan S7 refused keeps its answer and only a
 * plan S7 let through can meet a new one:
 *
 * 1. the plan is empty (no card anywhere; a spoke with no chain holds no block);
 * 2. a block or a network the mandate no longer holds (D6), or a plan the reducers could never have
 *    produced (a broken sequence, a missing or orphaned Swap · auto, a chain with no card);
 * 3. a coming-soon block (C22);
 * 4. an empty block, one nobody configured (G6);
 * 5. shares that add up to more than the capital above them (C8, INV3);
 * 6. a pool picked but not finished: no range or no slippage yet (`isPoolConfigComplete`);
 * 7. a chain whose share is not a whole percent above 0 (the launch refuses `INVALID_ALLOCATION`;
 *    the panels write whole percents only, so in practice this is the 0% a block gets on Use, P7);
 * 8. a spoke holding more than the sum of its chains, an emptied spoke that kept its share
 *    included (review M1 of PR #51): the launch bridges the spoke's whole share and deploys only
 *    its chains, and refuses a share that is not whole (`INVALID_ALLOCATION`). A spoke holding
 *    LESS than its chains is check 5;
 * 9. a chain with more than one position, or anything under a Supply (the launch runs one position
 *    per chain: `BUILD_EXECUTION_GAP`, `UNSUPPORTED_POSITION` for a Borrow);
 * 10. a second Supply of the same reserve on one network (one Aave open per reserve);
 * 11. a Swap in a chain with no pool: a Supply of a token other than the one that arrives (its
 *     Swap · auto) or a manager Swap. The launch runs no swap outside a pool yet
 *     (`BUILD_EXECUTION_GAP`), so the Supply's asset must be the token that arrives.
 *
 * Reading order inside a check: the plan's own order, hub first, then the spokes, top to bottom.
 */
import { isPoolConfigComplete } from "./blockConfig";
import type { BuildPlan, Chain, PositionBlock, Step } from "./buildPlan";
import { chainsWithNetwork, findBlock } from "./planDerive";
import type { PlanViolation, PlanViolationCode } from "./planInvariants";
import { isPoolKind } from "./planRules";

/** The readiness refusals, in the order the checks run. */
export const PLAN_READINESS_REFUSALS = [
  "review_empty_plan",
  "review_invalid_block",
  "review_coming_soon_block",
  "review_empty_block",
  "review_over_share",
  "review_incomplete_block",
  "review_zero_share",
  "review_unused_spoke_share",
  "review_stacked_positions",
  "review_duplicate_reserve",
  "review_unsupported_swap",
] as const;

export type PlanReadinessRefusal = (typeof PLAN_READINESS_REFUSALS)[number];

/** What a refusal points at: a card or a pill, a chain (its first block) or a spoke's group. */
export type ReadinessTarget =
  | { kind: "block"; blockId: string }
  | { kind: "chain"; chainId: string }
  | { kind: "network"; network: string };

export type PlanReadiness =
  | { ready: true }
  | { ready: false; refusal: PlanReadinessRefusal; target: ReadinessTarget | null };

/**
 * Which check a violation fails. Total over `PlanViolationCode`, so a new invariant code fails to
 * compile here instead of slipping past the gate.
 */
const VIOLATION_CHECK: Readonly<
  Record<
    PlanViolationCode,
    "review_invalid_block" | "review_coming_soon_block" | "review_over_share"
  >
> = {
  network_not_in_mandate: "review_invalid_block",
  duplicate_network: "review_invalid_block",
  kind_not_in_mandate: "review_invalid_block",
  kind_not_on_network: "review_invalid_block",
  config_not_in_mandate: "review_invalid_block",
  // Not reachable through the reducers: a hand-edited stored plan only.
  chain_without_position: "review_invalid_block",
  sequence: "review_invalid_block",
  orphan_auto: "review_invalid_block",
  missing_auto: "review_invalid_block",
  kind_coming_soon: "review_coming_soon_block",
  share_exceeds_parent: "review_over_share",
  negative_share: "review_over_share",
};

/** A violation's `targetId` as a target: a block, a chain or a spoke network of this plan. */
function resolveTarget(plan: BuildPlan, targetId: string | null): ReadinessTarget | null {
  if (targetId === null) return null;
  if (findBlock(plan, targetId)) return { kind: "block", blockId: targetId };
  if (chainsWithNetwork(plan).some(({ chain }) => chain.id === targetId)) {
    return { kind: "chain", chainId: targetId };
  }
  if (plan.spokes.some((spoke) => spoke.network === targetId)) {
    return { kind: "network", network: targetId };
  }
  return null;
}

function refuse(refusal: PlanReadinessRefusal, blockId: string | null): PlanReadiness {
  return { ready: false, refusal, target: blockId === null ? null : { kind: "block", blockId } };
}

function positionsOf(chain: Chain): PositionBlock[] {
  return chain.steps.filter((step): step is PositionBlock => step.family === "position");
}

/** [6] A pool block picked but not finished: its config lacks a field the launch reads. */
function isUnfinishedPool(card: PositionBlock): boolean {
  if (card.kind !== "uniswapV4Pool" && card.kind !== "uniswapV3Pool") return false;
  return !isPoolConfigComplete(card.config);
}

/** [8] The first step that stacks a chain: a second position, or anything under a Supply. */
function stackedStep(chain: Chain): Step | null {
  let seen = false;
  let underSupply = false;
  for (const step of chain.steps) {
    if (underSupply) return step;
    if (step.family !== "position") continue;
    if (seen) return step;
    seen = true;
    underSupply = step.kind === "aaveSupply";
  }
  return null;
}

/** [10] The block to reveal for a Swap outside a pool: the Supply its Swap · auto feeds, else it. */
function swapWithoutPool(chain: Chain): string | null {
  if (chain.steps.some((step) => step.family === "position" && isPoolKind(step.kind))) return null;
  const index = chain.steps.findIndex((step) => step.family === "flow" && step.kind === "swap");
  const swap = chain.steps[index];
  if (swap?.family !== "flow") return null;
  const fed = chain.steps[index + 1];
  return swap.auto && fed ? fed.id : swap.id;
}

/** [AN4, D19, finding 4] Whether the plan is ready for Review, or the first check it fails. */
export function planReadiness(
  plan: BuildPlan,
  violations: readonly PlanViolation[],
): PlanReadiness {
  const chains = chainsWithNetwork(plan);
  const cards = chains.flatMap(({ chain }) => positionsOf(chain));
  if (cards.length === 0) return { ready: false, refusal: "review_empty_plan", target: null };

  for (const check of ["review_invalid_block", "review_coming_soon_block"] as const) {
    const first = violations.find((violation) => VIOLATION_CHECK[violation.code] === check);
    if (first) return { ready: false, refusal: check, target: resolveTarget(plan, first.targetId) };
  }

  const empty = cards.find((card) => card.config === null);
  if (empty) return refuse("review_empty_block", empty.id);

  const share = violations.find((v) => VIOLATION_CHECK[v.code] === "review_over_share");
  if (share) {
    return {
      ready: false,
      refusal: "review_over_share",
      target: resolveTarget(plan, share.targetId),
    };
  }

  const deferredPoolChains = new Set(
    chains
      .filter(
        ({ chain }) =>
          chain.sharePct === 0 && positionsOf(chain).some((card) => isPoolKind(card.kind)),
      )
      .map(({ chain }) => chain.id),
  );
  const activeCards = chains
    .filter(({ chain }) => !deferredPoolChains.has(chain.id))
    .flatMap(({ chain }) => positionsOf(chain));
  const unfinished = activeCards.find(isUnfinishedPool);
  if (unfinished) return refuse("review_incomplete_block", unfinished.id);

  const unshared = chains.find(
    ({ chain }) =>
      !deferredPoolChains.has(chain.id) &&
      !(Number.isInteger(chain.sharePct) && chain.sharePct > 0),
  );
  if (unshared) return refuse("review_zero_share", positionsOf(unshared.chain)[0]?.id ?? null);

  if (!chains.some(({ chain }) => chain.sharePct > 0)) {
    return refuse("review_zero_share", cards[0]?.id ?? null);
  }

  const unused = plan.spokes.find(
    (spoke) =>
      spoke.sharePct > spoke.chains.reduce((total, chain) => total + chain.sharePct, 0) + 1e-9,
  );
  if (unused) {
    return {
      ready: false,
      refusal: "review_unused_spoke_share",
      target: { kind: "network", network: unused.network },
    };
  }

  for (const { chain } of chains) {
    const stacked = stackedStep(chain);
    if (stacked) return refuse("review_stacked_positions", stacked.id);
  }

  const reserves = new Set<string>();
  for (const { chain, network } of chains) {
    for (const card of positionsOf(chain)) {
      if (card.kind !== "aaveSupply" || card.config === null) continue;
      const reserve = `${network}|${card.config.assetKey.toLowerCase()}`;
      if (reserves.has(reserve)) return refuse("review_duplicate_reserve", card.id);
      reserves.add(reserve);
    }
  }

  for (const { chain } of chains) {
    const target = swapWithoutPool(chain);
    if (target) return refuse("review_unsupported_swap", target);
  }

  return { ready: true };
}
