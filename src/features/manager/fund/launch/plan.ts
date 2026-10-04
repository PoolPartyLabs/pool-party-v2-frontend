/**
 * @id PP-MGR-LIB-037 (POO-2177)
 * @name launchPlanAdapter
 * @implements-rules-version v1
 * Owned structural adapter for the canvas BuildPlan v1.
 */
export interface CanvasPlan {
  // PP-INTEGRATION-POINT: canvas owners provide BuildPlan v1 and missing range/leaf execution fields.
  version: 1;
  hub: { chains: CanvasChain[] };
  spokes: { network: string; sharePct: number; chains: CanvasChain[] }[];
}
export interface CanvasChain {
  id: string;
  sharePct: number;
  steps: {
    id: string;
    family: "position" | "flow";
    kind: string;
    config?: {
      poolId?: string;
      assetKey?: string;
      priceLower?: string;
      priceUpper?: string;
      tickLower?: number;
      tickUpper?: number;
      fullRange?: boolean;
      slippagePct?: number;
      displayInverted?: boolean;
    } | null;
  }[];
}
export interface ExecutionConfig {
  leafSharePct?: number;
  priceLower?: string;
  priceUpper?: string;
  maxLossBps?: number;
  tickLower?: number;
  tickUpper?: number;
}
export interface LaunchStep {
  id: string;
  kind:
    | "approve"
    | "create"
    | "discover"
    | "spoke"
    | "profile"
    | "allocate"
    | "report"
    | "bridge"
    | "arrival"
    | "swap"
    | "open";
  chain: 42161 | 4663;
  dependencies: string[];
  sharePct?: number;
  shareDenominator?: number;
  group?: string;
  blockId?: string;
  protocol?: "aave-v3" | "uniswap-v4";
  config?: { poolId?: string; assetKey?: string } & ExecutionConfig;
}

function percent(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("INVALID_ALLOCATION");
  return value;
}

export function deriveLaunchSteps(
  plan: CanvasPlan,
  execution: Record<string, ExecutionConfig>,
  approval: boolean,
  spoke: boolean,
): LaunchStep[] {
  if (
    plan.version !== 1 ||
    plan.spokes.length > 1 ||
    plan.spokes.some((group) => group.network !== "robinhood") ||
    (plan.spokes.length > 0 && !spoke)
  )
    throw new Error("INVALID_BUILD");
  const total =
    plan.hub.chains.reduce((sum, chain) => sum + percent(chain.sharePct), 0) +
    plan.spokes.reduce((sum, group) => sum + percent(group.sharePct), 0);
  if (total <= 0 || total > 100) throw new Error("INVALID_ALLOCATION");
  const steps: LaunchStep[] = [];
  const add = (
    id: string,
    kind: LaunchStep["kind"],
    chain: LaunchStep["chain"],
    dependencies: string[],
    extra: Partial<LaunchStep> = {},
  ) => steps.push({ id, kind, chain, dependencies, ...extra });
  if (approval) add("approve", "approve", 42161, []);
  add("create", "create", 42161, approval ? ["approve"] : []);
  add("discover-hub", "discover", 42161, ["create"]);
  if (spoke) {
    add("spoke", "spoke", 4663, ["discover-hub"]);
    add("discover-spoke", "discover", 4663, ["spoke"]);
  }
  add("profile", "profile", 42161, [spoke ? "discover-spoke" : "discover-hub"]);
  const hubShare = plan.hub.chains.reduce((sum, chain) => sum + chain.sharePct, 0);
  if (hubShare > 0) add("allocate", "allocate", 42161, ["profile"], { sharePct: hubShare });
  const ids = new Set<string>();
  const positions = (
    chains: CanvasChain[],
    chainId: LaunchStep["chain"],
    dependency: string,
    group?: string,
    shareDenominator = 100,
  ) => {
    for (const chain of chains) {
      percent(chain.sharePct);
      const leaves = chain.steps.filter((step) => step.family === "position");
      if (leaves.length === 0) throw new Error("EMPTY_BUILD");
      let leafTotal = 0;
      for (const block of chain.steps) {
        if (ids.has(block.id)) throw new Error("DUPLICATE_BLOCK");
        ids.add(block.id);
        if (block.family === "flow") {
          if (block.kind !== "collectFees" && block.kind !== "swap")
            throw new Error("INVALID_BUILD");
          if (block.kind === "swap" && !chain.steps.some((entry) => entry.kind === "uniswapV4Pool"))
            throw new Error("BUILD_EXECUTION_GAP");
          continue;
        }
        if (
          !["aaveSupply", "uniswapV4Pool"].includes(block.kind) ||
          (block.kind === "aaveSupply" && chainId !== 42161) ||
          !block.config
        )
          throw new Error("UNSUPPORTED_POSITION");
        const settings = { ...block.config, ...execution[block.id] };
        if (settings.maxLossBps === undefined && typeof settings.slippagePct === "number")
          settings.maxLossBps = Math.round(settings.slippagePct * 100);
        if (leaves.length > 1 && settings.leafSharePct === undefined)
          throw new Error("BUILD_EXECUTION_GAP");
        const leafShare = percent(settings.leafSharePct ?? 100);
        leafTotal += leafShare;
        const sharePct = (chain.sharePct * leafShare) / 100;
        if (!Number.isInteger(sharePct)) throw new Error("BUILD_EXECUTION_GAP");
        const extra = {
          sharePct,
          shareDenominator,
          group,
          blockId: block.id,
          protocol: block.kind === "aaveSupply" ? ("aave-v3" as const) : ("uniswap-v4" as const),
          config: { ...block.config, ...settings },
        };
        if (block.kind === "uniswapV4Pool") {
          const ticks =
            Number.isInteger(settings.tickLower) &&
            Number.isInteger(settings.tickUpper) &&
            (settings.tickLower ?? 0) >= -887272 &&
            (settings.tickUpper ?? 0) <= 887272 &&
            (settings.tickLower ?? 0) < (settings.tickUpper ?? 0);
          if (
            !ticks &&
            (!settings.priceLower ||
              !settings.priceUpper ||
              !/^\d+(\.\d+)?$/.test(settings.priceLower) ||
              !/^\d+(\.\d+)?$/.test(settings.priceUpper) ||
              Number(settings.priceLower) <= 0 ||
              Number(settings.priceUpper) <= Number(settings.priceLower))
          )
            throw new Error("BUILD_EXECUTION_GAP");
          if (
            settings.maxLossBps === undefined ||
            !Number.isInteger(settings.maxLossBps) ||
            settings.maxLossBps < 1 ||
            settings.maxLossBps > 500
          )
            throw new Error("INVALID_SLIPPAGE");
          add(`${block.id}:swap`, "swap", chainId, [dependency], extra);
          add(`${block.id}:open`, "open", chainId, [`${block.id}:swap`], extra);
        } else add(`${block.id}:open`, "open", chainId, [dependency], extra);
      }
      if (leafTotal > 100) throw new Error("INVALID_ALLOCATION");
    }
  };
  positions(plan.hub.chains, 42161, "allocate");
  for (const group of plan.spokes) {
    if (group.sharePct === 0 && group.chains.length === 0) continue;
    if (
      group.sharePct <= 0 ||
      group.chains.reduce((sum, chain) => sum + percent(chain.sharePct), 0) > group.sharePct
    )
      throw new Error("INVALID_ALLOCATION");
    add("report", "report", 42161, ["profile"]);
    add("bridge", "bridge", 42161, ["report"], { sharePct: group.sharePct, group: "robinhood" });
    add("arrival", "arrival", 4663, ["bridge"], { group: "robinhood" });
    positions(group.chains, 4663, "arrival", "robinhood", group.sharePct);
  }
  return steps;
}

export function allocationRaw(principal: bigint, percent: number): bigint {
  if (principal < BigInt("0") || !Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new Error("INVALID_ALLOCATION");
  return (principal * BigInt(percent)) / BigInt("100");
}
