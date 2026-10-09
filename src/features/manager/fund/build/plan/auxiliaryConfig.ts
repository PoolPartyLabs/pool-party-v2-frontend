/**
 * @id PP-MGR-LIB-057
 * @name auxiliaryConfig
 * @implements-rules-version v1 (POO-2237)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none, pure configuration reducers; usePanelDraft reports local edit outcomes.
 *
 * Manual Swap and spoke panel rules. No API, quotes, amounts or execution. The existing
 * launch adapter continues to refuse manual swaps. Token refs come from the explicit mandate.
 */
import {
  type MandateDraft,
  type NetworkId,
  normalizeTokenIdentity,
  tokenKey,
} from "../../mandateDraft";
import { isManualSwapConfig } from "./blockConfig";
import type { BuildPlan, Chain, PanelConfig, PlanContext, PlanReducerResult } from "./buildPlan";
import { findBlock } from "./planDerive";
import { applyBlockConfig, setSpokeShare } from "./planReducers";

export { isManualSwapConfig } from "./blockConfig";

export const spokePanelId = (network: NetworkId): string => `spoke:${network}`;

export function manualSwapTokens(draft: MandateDraft, network: NetworkId) {
  if (!draft.networks.includes(network)) return [];
  return [
    ...new Map(
      draft.tokens
        .filter((token) => token.network === network)
        .map((token) => [tokenKey(token), token]),
    ).values(),
  ];
}

export function validManualSwapConfig(
  value: unknown,
  draft: MandateDraft,
  network: NetworkId,
): boolean {
  if (!isManualSwapConfig(value)) return false;
  if (
    network === "solana" &&
    (draft.runtime !== "solana-local" || !draft.protocols.includes("jupiter"))
  )
    return false;
  const keys = new Set(manualSwapTokens(draft, network).map(tokenKey));
  const input = normalizeTokenIdentity(network, value.tokenInKey);
  const output = normalizeTokenIdentity(network, value.tokenOutKey);
  return input !== output && keys.has(input) && keys.has(output);
}

export function spokeAllocationBounds(plan: BuildPlan, draft: MandateDraft, network: NetworkId) {
  const sum = (shares: number[]) => Math.round(shares.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
  const spoke = plan.spokes.find((candidate) => candidate.network === network);
  const others = sum([
    ...plan.hub.chains.map((chain) => chain.sharePct),
    ...plan.spokes
      .filter((candidate) => candidate.network !== network)
      .map((candidate) => candidate.sharePct),
  ]);
  const cap = draft.caps.networks[network];
  return {
    min: sum(spoke?.chains.map((chain) => chain.sharePct) ?? []),
    max: Math.max(0, Math.min(100 - others, cap && !cap.noCap ? cap.pct : 100)),
  };
}

export function applyPanelConfig(
  plan: BuildPlan,
  ctx: PlanContext,
  blockId: string,
  config: PanelConfig | null,
  sharePct?: number,
): PlanReducerResult {
  const refuse = (
    reason: "unknown_target" | "not_in_mandate" | "auto_owned" | "share_exceeds_parent",
  ): PlanReducerResult => ({ blocked: { reason, targetId: blockId } });
  if (config && "spoke" in config) {
    const spoke = plan.spokes.find((candidate) => spokePanelId(candidate.network) === blockId);
    if (!spoke) return refuse("unknown_target");
    if (!ctx.draft.networks.includes(spoke.network)) return refuse("not_in_mandate");
    const bounds = spokeAllocationBounds(plan, ctx.draft, spoke.network);
    if (
      sharePct === undefined ||
      !Number.isFinite(sharePct) ||
      sharePct < bounds.min ||
      sharePct > bounds.max
    )
      return refuse("share_exceeds_parent");
    return setSpokeShare(plan, ctx, spoke.network, sharePct);
  }
  if (config && "tokenInKey" in config) {
    const found = findBlock(plan, blockId);
    if (found?.block.family !== "flow" || found.block.kind !== "swap")
      return refuse("unknown_target");
    if (found.block.auto) return refuse("auto_owned");
    if (!validManualSwapConfig(config, ctx.draft, found.network)) return refuse("not_in_mandate");
    const stored = {
      tokenInKey: normalizeTokenIdentity(found.network, config.tokenInKey),
      tokenOutKey: normalizeTokenIdentity(found.network, config.tokenOutKey),
      slippagePct: config.slippagePct,
    };
    const update = (chain: Chain): Chain =>
      chain.id !== found.chain.id
        ? chain
        : {
            ...chain,
            steps: chain.steps.map((step) =>
              step.id === blockId && step.family === "flow" ? { ...step, config: stored } : step,
            ),
          };
    return {
      ...plan,
      hub: { chains: plan.hub.chains.map(update) },
      spokes: plan.spokes.map((spoke) =>
        spoke.network === found.network ? { ...spoke, chains: spoke.chains.map(update) } : spoke,
      ),
    };
  }
  return applyBlockConfig(plan, ctx, blockId, config, sharePct);
}
