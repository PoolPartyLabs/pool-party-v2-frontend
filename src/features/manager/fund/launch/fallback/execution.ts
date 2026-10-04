/**
 * @id PP-MGR-LIB-047 (POO-2183)
 * @name fallbackExecutionAtLaunch
 * @implements-rules-version v1
 */
import type { FundLaunchDraft } from "../contracts";
import { getLaunchSteps } from "../journey";
import type { CanvasChain } from "../plan";

export type FallbackSettings = NonNullable<CanvasChain["steps"][number]["config"]>;
export type FallbackEdits = Record<string, FallbackSettings>;
export type FallbackBlock = CanvasChain["steps"][number] & { network: string };

export function alignTick(tick: number, spacing: number, direction: "up" | "down"): number {
  if (!Number.isInteger(tick) || !Number.isInteger(spacing) || spacing < 1 || spacing > 887272)
    throw new Error("EXECUTION_UNAVAILABLE");
  return (direction === "up" ? Math.ceil(tick / spacing) : Math.floor(tick / spacing)) * spacing;
}

export function fullRangeTicks(spacing: number) {
  return {
    tickLower: alignTick(-887272, spacing, "up"),
    tickUpper: alignTick(887272, spacing, "down"),
  };
}

export function fallbackBlocks(draft: FundLaunchDraft): FallbackBlock[] {
  return [
    ...draft.plan.hub.chains.flatMap((chain) =>
      chain.steps.map((block) => ({ ...block, network: "arbitrum" })),
    ),
    ...draft.plan.spokes.flatMap((spoke) =>
      spoke.chains.flatMap((chain) =>
        chain.steps.map((block) => ({ ...block, network: spoke.network })),
      ),
    ),
  ];
}

export function hasPanelSettings(block: FallbackBlock): boolean {
  return !!block.config && Object.keys(block.config).length > 0;
}

export function resolveFallbackSettings(
  draft: FundLaunchDraft,
  block: FallbackBlock,
  edits: FallbackSettings = {},
  hubBaseAssetKey?: string,
): FallbackSettings {
  const panel = hasPanelSettings(block);
  const selected = panel ? (block.config ?? {}) : edits;
  if (block.kind === "uniswapV4Pool") {
    const candidates = draft.pools.filter(
      (pool) => pool.network === block.network && pool.protocol === "uniswap-v4" && !pool.hasHook,
    );
    const pool = selected.poolId
      ? candidates.find((entry) => entry.poolId === selected.poolId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!pool?.poolId || !/^0x[0-9a-fA-F]{64}$/.test(pool.poolId) || !pool.poolKey)
      throw new Error("EXECUTION_UNAVAILABLE");
    const range = fullRangeTicks(pool.poolKey.tickSpacing);
    const settings = panel
      ? selected
      : {
          poolId: pool.poolId,
          fullRange: true,
          displayInverted: false,
          slippagePct: 1,
          ...range,
          ...edits,
          ...(edits.fullRange !== false ? range : {}),
        };
    const { tickLower, tickUpper, slippagePct } = settings;
    if (
      !Number.isInteger(tickLower) ||
      !Number.isInteger(tickUpper) ||
      (tickLower ?? -Infinity) < range.tickLower ||
      (tickUpper ?? Infinity) > range.tickUpper ||
      (tickLower ?? 0) >= (tickUpper ?? 0) ||
      (tickLower ?? 0) % pool.poolKey.tickSpacing !== 0 ||
      (tickUpper ?? 0) % pool.poolKey.tickSpacing !== 0 ||
      typeof slippagePct !== "number" ||
      !Number.isFinite(slippagePct) ||
      slippagePct < 0.1 ||
      slippagePct > 5 ||
      (settings.fullRange === true &&
        (tickLower !== range.tickLower || tickUpper !== range.tickUpper))
    )
      throw new Error("EXECUTION_UNAVAILABLE");
    return { ...settings };
  }
  if (block.kind === "aaveSupply") {
    const candidates = draft.tokens
      .filter(
        (token) =>
          token.network === "arbitrum" &&
          draft.aaveV3Reserves?.some(
            (address) => address.toLowerCase() === token.address.toLowerCase(),
          ),
      )
      .map((token) => `arbitrum:${token.address.toLowerCase()}`);
    const assetKey = selected.assetKey ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (
      block.network !== "arbitrum" ||
      !assetKey ||
      !/^arbitrum:0x[0-9a-fA-F]{40}$/.test(assetKey) ||
      !candidates.includes(assetKey.toLowerCase()) ||
      !hubBaseAssetKey ||
      assetKey.toLowerCase() !== hubBaseAssetKey.toLowerCase()
    )
      throw new Error("EXECUTION_UNAVAILABLE");
    return panel ? { ...selected } : { assetKey };
  }
  throw new Error("EXECUTION_UNAVAILABLE");
}

export function applyFallbackExecutionAtLaunch(
  draft: FundLaunchDraft,
  edits: FallbackEdits,
  hubBaseAssetKey?: string,
): FundLaunchDraft {
  const execution = { ...draft.launchExecution };
  const chains = (entries: CanvasChain[], network: string): CanvasChain[] =>
    entries.map((chain) => ({
      ...chain,
      steps: chain.steps.map((block) => {
        if (block.family !== "position")
          return { ...block, config: block.config ? { ...block.config } : block.config };
        const config = resolveFallbackSettings(
          draft,
          { ...block, network },
          edits[block.id],
          hubBaseAssetKey,
        );
        const leafSharePct = execution[block.id]?.leafSharePct;
        execution[block.id] = leafSharePct === undefined ? {} : { leafSharePct };
        return { ...block, config };
      }),
    }));
  // PP-INTEGRATION-POINT: immutable launch snapshot consumed by startFundLaunch; no canvas/store writes.
  return {
    ...draft,
    launchExecution: execution,
    plan: {
      ...draft.plan,
      hub: { ...draft.plan.hub, chains: chains(draft.plan.hub.chains, "arbitrum") },
      spokes: draft.plan.spokes.map((spoke) => ({
        ...spoke,
        chains: chains(spoke.chains, spoke.network),
      })),
    } as FundLaunchDraft["plan"],
  };
}

export function fallbackLaunchPreview(
  draft: FundLaunchDraft,
  edits: FallbackEdits,
  hubBaseAssetKey?: string,
) {
  let snapshot: FundLaunchDraft;
  try {
    snapshot = applyFallbackExecutionAtLaunch(draft, edits, hubBaseAssetKey);
  } catch {
    return { steps: [], blockers: ["EXECUTION_UNAVAILABLE"] };
  }
  try {
    return { steps: getLaunchSteps(snapshot), blockers: [] };
  } catch {
    return { steps: [], blockers: ["BUILD_EXECUTION_GAP"] };
  }
}
