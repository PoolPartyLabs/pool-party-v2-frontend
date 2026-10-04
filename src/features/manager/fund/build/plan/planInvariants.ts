/**
 * @id PP-MGR-LIB-021
 * @name planInvariants
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module.
 *
 * The six plan invariants of the handoff ("Plan model"), as a list of what is broken. It changes
 * nothing: a plan read back from a draft whose mandate was edited afterwards can name a pool, a
 * protocol or a network the mandate no longer holds (open point 6), and coordinator default D6 says
 * the canvas never deletes silently. The Build screen shows each violating block as invalid and Next:
 * Review refuses while the list is not empty.
 *
 * 1. Spoke networks are mandate networks other than the hub, at most once each.
 * 2. Every kind belongs to a protocol of the mandate that is available on the block's network; a
 *    coming-soon kind is never valid; a configured block names a pool or asset of the mandate.
 * 3. Hub chain shares plus spoke shares never exceed 100; a spoke's chains never exceed the spoke;
 *    every share is at least 0.
 * 4. A chain has at least one position block.
 * 5. Collect fees only directly after a pool; a Borrow only directly after a Supply; after a pool,
 *    only its Collect fees, and nothing after that; a manager Swap sits before a position (the app's
 *    Swap · auto may sit between) or directly after an Aave block.
 * 6. Auto blocks are owned by the app: a Swap · auto exactly where `reconcileAutoBlocks` puts one.
 *
 * PP-NOTE: invariant 5 reads "nothing follows a pool except its Collect fees" as "a pool ends its
 * chain, or its Collect fees does". That is the coordinator's reading (recorded with the PR #31
 * review), consistent with C10 and C11, and the product owner may overturn it. No drawing continues
 * a chain after a pool, and coordinator default D1 accepts every other sequence the invariant allows
 * (canvas A's Supply, Swap · auto, pool).
 */
import { HUB_NETWORK, type NetworkId, tokenKey } from "../../mandateDraft";
import { findMandatePool } from "./blockConfig";
import {
  BLOCK_KIND_PROTOCOL,
  BLOCK_KIND_STATUS,
  type BuildPlan,
  type Chain,
  type PlanContext,
  type PositionBlock,
  type Step,
} from "./buildPlan";
import { chainsWithNetwork } from "./planDerive";
import { arrivingTokenAt, isPoolKind, kindAvailability, needsAutoSwap } from "./planRules";

export type PlanViolationCode =
  // INV1
  | "network_not_in_mandate"
  | "duplicate_network"
  // INV2
  | "kind_not_in_mandate"
  | "kind_not_on_network"
  | "kind_coming_soon"
  | "config_not_in_mandate"
  // INV3
  | "share_exceeds_parent"
  | "negative_share"
  // INV4
  | "chain_without_position"
  // INV5
  | "sequence"
  // INV6
  | "orphan_auto"
  | "missing_auto";

/** One broken invariant. `targetId` is the block, chain or network it is about, or null. */
export interface PlanViolation {
  invariant: 1 | 2 | 3 | 4 | 5 | 6;
  code: PlanViolationCode;
  targetId: string | null;
}

/** Shares are compared with this slack, as the share reducers do. */
const SHARE_EPSILON = 1e-9;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Whether a configured block names something the mandate holds on the block's network. */
function configInMandate(
  block: PositionBlock,
  network: NetworkId,
  draft: PlanContext["draft"],
): boolean {
  const config = block.config as Record<string, unknown> | null;
  if (config === null) return true;
  if (isPoolKind(block.kind)) {
    const poolId = config.poolId;
    if (typeof poolId !== "string") return false;
    // The bare PoolId of a real-mode row, or a mock row's id, inside the block's network.
    const pool = findMandatePool(draft.pools, network, poolId);
    return pool?.protocol === BLOCK_KIND_PROTOCOL[block.kind];
  }
  if (block.kind === "aaveSupply" || block.kind === "aaveBorrow") {
    const assetKey = config.assetKey;
    if (typeof assetKey !== "string") return false;
    return draft.tokens.some(
      (token) => token.network === network && tokenKey(token) === assetKey.toLowerCase(),
    );
  }
  // Pendle and GMX carry no config yet; any value is one the mandate cannot hold.
  return false;
}

/** INV2 for one block: availability first (one cause, one report), then its config. */
function kindViolation(
  block: PositionBlock,
  network: NetworkId,
  ctx: Pick<PlanContext, "draft" | "catalog">,
): PlanViolationCode | null {
  if (BLOCK_KIND_STATUS[block.kind] === "comingSoon") return "kind_coming_soon";
  const availability = kindAvailability(block.kind, network, ctx);
  if (availability === "not_in_mandate") return "kind_not_in_mandate";
  if (availability === "not_on_network") return "kind_not_on_network";
  return configInMandate(block, network, ctx.draft) ? null : "config_not_in_mandate";
}

/** The next step after `index` that is not an app-owned auto block. */
function nextNonAuto(steps: readonly Step[], index: number): Step | undefined {
  return steps.slice(index + 1).find((step) => !(step.family === "flow" && step.auto));
}

/** INV5 for one chain: the ids of the steps that sit where they may not. */
function sequenceViolations(steps: readonly Step[]): string[] {
  const out: string[] = [];
  steps.forEach((step, index) => {
    const before = steps[index - 1];
    if (step.family === "flow" && step.kind === "collectFees") {
      if (!(before?.family === "position" && isPoolKind(before.kind))) out.push(step.id);
    }
    if (step.family === "position" && step.kind === "aaveBorrow") {
      if (!(before?.family === "position" && before.kind === "aaveSupply")) out.push(step.id);
    }
    if (step.family === "flow" && step.kind === "swap" && !step.auto) {
      const afterAave =
        before?.family === "position" &&
        (before.kind === "aaveSupply" || before.kind === "aaveBorrow");
      const beforePosition = nextNonAuto(steps, index)?.family === "position";
      if (!afterAave && !beforePosition) out.push(step.id);
    }
    // After a pool, only its Collect fees, and nothing after that Collect fees.
    // PP-NOTE: this is the COORDINATOR'S READING of the handoff text "nothing follows a pool except
    // its Collect fees": the pool, or its Collect fees, ends the chain, which matches C10 and C11
    // (a chain's last block drops into the return lines). So a position after the Collect fees and
    // a second Collect fees are both violations. The product owner may overturn this reading.
    if (before?.family === "position" && isPoolKind(before.kind)) {
      if (!(step.family === "flow" && step.kind === "collectFees")) out.push(step.id);
    }
    const twoBack = steps[index - 2];
    if (
      before?.family === "flow" &&
      before.kind === "collectFees" &&
      twoBack?.family === "position" &&
      isPoolKind(twoBack.kind)
    ) {
      out.push(step.id);
    }
  });
  return [...new Set(out)];
}

/** INV6 for one chain: Swap · auto blocks where C13 wants none, and cards missing theirs. */
function autoViolations(
  steps: readonly Step[],
  network: NetworkId,
  draft: PlanContext["draft"],
): PlanViolation[] {
  const out: PlanViolation[] = [];
  steps.forEach((step, index) => {
    if (step.family === "flow" && step.auto) {
      const next = steps[index + 1];
      const wanted =
        step.kind === "swap" &&
        next?.family === "position" &&
        needsAutoSwap(next, arrivingTokenAt(steps, index + 1, network, draft));
      if (!wanted) out.push({ invariant: 6, code: "orphan_auto", targetId: step.id });
      return;
    }
    if (step.family !== "position") return;
    if (!needsAutoSwap(step, arrivingTokenAt(steps, index, network, draft))) return;
    const before = steps[index - 1];
    if (!(before?.family === "flow" && before.auto && before.kind === "swap")) {
      out.push({ invariant: 6, code: "missing_auto", targetId: step.id });
    }
  });
  return out;
}

/**
 * INV1 to INV6: every violation in the plan, ordered by invariant and then by plan order (hub
 * first, spokes left to right, chains left to right, steps top to bottom). Empty means valid.
 */
export function validatePlan(
  plan: BuildPlan,
  ctx: Pick<PlanContext, "draft" | "catalog">,
): PlanViolation[] {
  const byInvariant: PlanViolation[][] = [[], [], [], [], [], []];
  const report = (violation: PlanViolation) =>
    byInvariant[violation.invariant - 1]?.push(violation);

  // INV1
  const seen = new Set<NetworkId>();
  for (const spoke of plan.spokes) {
    if (spoke.network === HUB_NETWORK || !ctx.draft.networks.includes(spoke.network)) {
      report({ invariant: 1, code: "network_not_in_mandate", targetId: spoke.network });
    }
    if (seen.has(spoke.network)) {
      report({ invariant: 1, code: "duplicate_network", targetId: spoke.network });
    }
    seen.add(spoke.network);
  }

  // INV3
  const shareOf = (chains: readonly Chain[]) => sum(chains.map((chain) => chain.sharePct));
  const top = shareOf(plan.hub.chains) + sum(plan.spokes.map((spoke) => spoke.sharePct));
  if (top > 100 + SHARE_EPSILON) {
    report({ invariant: 3, code: "share_exceeds_parent", targetId: null });
  }
  for (const spoke of plan.spokes) {
    // One cause, one report: a negative spoke share is the fault, not the chains above it.
    if (!(spoke.sharePct >= 0)) {
      report({ invariant: 3, code: "negative_share", targetId: spoke.network });
    } else if (shareOf(spoke.chains) > spoke.sharePct + SHARE_EPSILON) {
      report({ invariant: 3, code: "share_exceeds_parent", targetId: spoke.network });
    }
  }

  for (const { chain, network } of chainsWithNetwork(plan)) {
    if (!(chain.sharePct >= 0)) {
      report({ invariant: 3, code: "negative_share", targetId: chain.id });
    }
    // INV4
    if (!chain.steps.some((step) => step.family === "position")) {
      report({ invariant: 4, code: "chain_without_position", targetId: chain.id });
    }
    // INV2
    for (const step of chain.steps) {
      if (step.family !== "position") continue;
      const code = kindViolation(step, network, ctx);
      if (code) report({ invariant: 2, code, targetId: step.id });
    }
    // INV5
    for (const targetId of sequenceViolations(chain.steps)) {
      report({ invariant: 5, code: "sequence", targetId });
    }
    // INV6
    for (const violation of autoViolations(chain.steps, network, ctx.draft)) report(violation);
  }

  return byInvariant.flat();
}
