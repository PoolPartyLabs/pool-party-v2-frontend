/**
 * @id PP-MGR-LIB-021
 * @name planDerive
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module.
 *
 * Facts the canvas derives from a plan and never stores: where a block is, which network it is on
 * (C5), whether the Income (fees) block exists (C10), how much of the capital is allocated, and
 * whether a block is configured (HU2).
 */
import { HUB_NETWORK, type NetworkId } from "../../mandateDraft";
import type { BuildPlan, Chain, PositionBlock, Step } from "./buildPlan";

/** Every chain of the plan with the network it hangs on, hub first, then the spokes in order. */
export function chainsWithNetwork(
  plan: BuildPlan,
): Array<{ chain: Chain; network: NetworkId; spokeIndex: number | null }> {
  const out: Array<{ chain: Chain; network: NetworkId; spokeIndex: number | null }> = [];
  for (const chain of plan.hub.chains) out.push({ chain, network: HUB_NETWORK, spokeIndex: null });
  plan.spokes.forEach((spoke, spokeIndex) => {
    for (const chain of spoke.chains) out.push({ chain, network: spoke.network, spokeIndex });
  });
  return out;
}

/** A block, the chain that holds it, the network it sits on and its index in the chain. */
export function findBlock(
  plan: BuildPlan,
  blockId: string,
): { block: Step; chain: Chain; network: NetworkId; index: number } | null {
  for (const { chain, network } of chainsWithNetwork(plan)) {
    const index = chain.steps.findIndex((step) => step.id === blockId);
    const block = chain.steps[index];
    if (block) return { block, chain, network, index };
  }
  return null;
}

/** C5: a block's network is where it sits. There is no network field on a block. */
export function blockNetwork(plan: BuildPlan, blockId: string): NetworkId | null {
  return findBlock(plan, blockId)?.network ?? null;
}

/** C10: the Income (fees) block exists iff at least one Collect fees exists, anywhere. */
export function hasIncome(plan: BuildPlan): boolean {
  return chainsWithNetwork(plan).some(({ chain }) =>
    chain.steps.some((step) => step.family === "flow" && step.kind === "collectFees"),
  );
}

/**
 * The share of the strategy's capital the plan places: hub chains plus spokes (C8). The chains
 * inside a spoke are a split of that spoke's share, so they are not added again. What is left stays
 * in Idle input.
 */
export function allocatedPct(plan: BuildPlan): number {
  const hub = plan.hub.chains.reduce((sum, chain) => sum + chain.sharePct, 0);
  return plan.spokes.reduce((sum, spoke) => sum + spoke.sharePct, hub);
}

/** HU2: a block is configured iff its `config` is not null. Nothing else decides it. */
export function isConfigured(block: PositionBlock): boolean {
  return block.config !== null;
}
