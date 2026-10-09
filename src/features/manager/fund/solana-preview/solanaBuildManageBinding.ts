/**
 * @id PP-MGR-LIB-076
 * @name solanaBuildManageBinding
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, pure adapter; the shared Build screen owns bounded local intents.
 */
import { isConfigFor } from "../build/plan/blockConfig";
import {
  type BuildPlan,
  isPlanBlocked,
  type PlanContext,
  type PlanReducerResult,
} from "../build/plan/buildPlan";
import { chainsWithNetwork, findBlock } from "../build/plan/planDerive";
import { validatePlan } from "../build/plan/planInvariants";
import { applyBlockConfig } from "../build/plan/planReducers";
import type { PreviewBlock } from "./previewModel";
import { parseAllocation } from "./previewModel";
import type { SolanaManageConfig } from "./solanaManageModel";

const protocols = {
  solanaOrcaPool: "orca",
  solanaRaydiumPool: "raydium",
  solanaKaminoSupply: "kamino",
  solanaHolding: "holding",
} as const;
export function localManageBlocks(plan: BuildPlan): PreviewBlock[] {
  return chainsWithNetwork(plan).flatMap(({ chain, network }) =>
    network !== "solana"
      ? []
      : chain.steps.flatMap((step) => {
          if (
            step.family !== "position" ||
            !(step.kind in protocols) ||
            !step.config ||
            !isConfigFor(step.kind, step.config) ||
            !("pair" in step.config)
          )
            return [];
          return [
            {
              id: step.id,
              protocol: protocols[step.kind as keyof typeof protocols],
              allocationBps: chain.sharePct * 100,
              pair: step.config.pair,
            },
          ];
        }),
  );
}

/** Budget belongs to a chain; only its first position owns the editable allocation. */
export function localManageAllocations(
  plan: BuildPlan,
): Record<string, { groupId: string; editable: boolean }> {
  return Object.fromEntries(
    chainsWithNetwork(plan).flatMap(({ chain }) => {
      const first = chain.steps.find((step) => step.family === "position");
      return chain.steps
        .filter((step) => step.family === "position")
        .map((step) => [step.id, { groupId: chain.id, editable: step.id === first?.id }]);
    }),
  );
}

export function applyLocalManageConfig(
  plan: BuildPlan,
  ctx: PlanContext,
  blockId: string,
  config: SolanaManageConfig,
): PlanReducerResult {
  const refuse = (): PlanReducerResult => ({
    blocked: { reason: "not_in_mandate", targetId: blockId },
  });
  const found = findBlock(plan, blockId);
  const share = parseAllocation(config.allocation);
  if (
    ctx.draft.runtime !== "solana-local" ||
    found?.network !== "solana" ||
    found.block.family !== "position" ||
    !(found.block.kind in protocols) ||
    !found.block.config ||
    !("catalogId" in found.block.config) ||
    share === null ||
    config.range !== null
  )
    return refuse();
  const first = found.chain.steps.find((step) => step.family === "position");
  if (first?.id !== blockId && share !== found.chain.sharePct * 100) return refuse();
  const next = applyBlockConfig(
    plan,
    ctx,
    blockId,
    { catalogId: found.block.config.catalogId, pair: config.pair },
    first?.id === blockId ? share / 100 : undefined,
  );
  if (isPlanBlocked(next)) return next;
  // Validate the whole resulting plan against CURRENT exact mint/protocol selections and budgets.
  // A descriptor never grants a canonical pool, range, balance, clock or signing capability.
  return validatePlan(next, ctx).length ? refuse() : next;
}
