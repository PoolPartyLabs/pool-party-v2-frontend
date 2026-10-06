/**
 * @id PP-MGR-LIB-037 (POO-2177)
 * @name launchPlanAdapter
 * @implements-rules-version v2 (POO-2181); POO-2204 rules v1
 * Owned structural adapter for the canvas BuildPlan v1.
 */
import { isConfigFor } from "../build/plan/blockConfig";

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
    auto?: boolean;
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
  fullRange?: boolean;
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
  chainKind?: "evm" | "svm";
  dependencies: string[];
  sharePct?: number;
  shareDenominator?: number;
  group?: string;
  blockId?: string;
  protocol?: "aave-v3" | "uniswap-v4";
  config?: { poolId?: string; assetKey?: string } & ExecutionConfig;
}

export interface SolanaLaunchStep extends Omit<LaunchStep, "kind" | "chain"> {
  kind:
    | "bind-solana"
    | "init-solana"
    | "cctp-fast"
    | "solana-arrival"
    | "kamino-supply"
    | "swap-to-ratio"
    | "raydium-open"
    | "report";
  chain: 42161 | "solana:mainnet";
  chainKind: "evm" | "svm";
  group: "solana";
}
export type ChainLaunchStep = LaunchStep | SolanaLaunchStep;

export function isEvmLaunchStep(step: ChainLaunchStep): step is LaunchStep {
  return step.group !== "solana" && step.chain !== "solana:mainnet";
}

export function launchPlanError(error: unknown) {
  return error instanceof Error && error.message === "DUPLICATE_AAVE_RESERVE"
    ? { code: "DUPLICATE_AAVE_RESERVE", messageKey: "fundLaunch.duplicateAaveReserve" as const }
    : { code: "BUILD_EXECUTION_GAP", messageKey: "fundLaunch.buildGap" as const };
}

function percent(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("INVALID_ALLOCATION");
  return value;
}
export function validateTickAlignment(config: ExecutionConfig, tickSpacing: number): void {
  if (config.tickLower === undefined && config.tickUpper === undefined && !config.fullRange) return;
  const lower = config.tickLower;
  const upper = config.tickUpper;
  if (
    !Number.isInteger(tickSpacing) ||
    tickSpacing <= 0 ||
    lower === undefined ||
    upper === undefined ||
    !Number.isInteger(lower) ||
    !Number.isInteger(upper) ||
    lower < -887272 ||
    upper > 887272 ||
    lower >= upper ||
    lower % tickSpacing !== 0 ||
    upper % tickSpacing !== 0 ||
    (config.fullRange === true &&
      (lower !== Math.ceil(-887272 / tickSpacing) * tickSpacing ||
        upper !== Math.floor(887272 / tickSpacing) * tickSpacing))
  )
    throw new Error("BUILD_TICK_ALIGNMENT");
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
  const aaveReserves = new Set<string>();
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
      const deferred =
        chain.sharePct === 0 && leaves.length === 1 && leaves[0]?.kind === "uniswapV4Pool";
      if (chain.sharePct === 0 && !deferred) throw new Error("INVALID_ALLOCATION");
      let leafTotal = 0;
      for (const block of chain.steps) {
        if (ids.has(block.id)) throw new Error("DUPLICATE_BLOCK");
        ids.add(block.id);
        if (block.family === "flow") {
          if (block.kind !== "collectFees" && block.kind !== "swap")
            throw new Error("INVALID_BUILD");
          if (
            block.kind === "swap" &&
            (block.auto !== true || !chain.steps.some((entry) => entry.kind === "uniswapV4Pool"))
          )
            throw new Error("BUILD_EXECUTION_GAP");
          continue;
        }
        if (
          !["aaveSupply", "uniswapV4Pool"].includes(block.kind) ||
          (block.kind === "aaveSupply" && chainId !== 42161) ||
          !block.config
        )
          throw new Error("UNSUPPORTED_POSITION");
        if (deferred) {
          if (!isConfigFor("uniswapV4Pool", block.config)) throw new Error("INVALID_BUILD");
          continue;
        }
        const settings = { ...execution[block.id], ...block.config };
        if (settings.tickLower !== undefined && settings.tickUpper !== undefined) {
          delete settings.priceLower;
          delete settings.priceUpper;
        }
        if (block.kind === "aaveSupply" && settings.assetKey) {
          const reserve = `${chainId}:${settings.assetKey.toLowerCase()}`;
          if (aaveReserves.has(reserve)) throw new Error("DUPLICATE_AAVE_RESERVE");
          aaveReserves.add(reserve);
        }
        if (typeof settings.slippagePct === "number") {
          if (
            !Number.isFinite(settings.slippagePct) ||
            settings.slippagePct < 0.1 ||
            settings.slippagePct > 5
          )
            throw new Error("INVALID_SLIPPAGE");
          settings.maxLossBps = Math.round(settings.slippagePct * 100);
        }
        if (leaves.length > 1 && settings.leafSharePct === undefined)
          throw new Error("BUILD_EXECUTION_GAP");
        const leafShare = percent(settings.leafSharePct ?? 100);
        if (chain.sharePct === 0 || leafShare === 0) throw new Error("INVALID_ALLOCATION");
        leafTotal += leafShare;
        const sharePct = (chain.sharePct * leafShare) / 100;
        if (!Number.isInteger(sharePct)) throw new Error("BUILD_EXECUTION_GAP");
        const extra = {
          sharePct,
          shareDenominator,
          group,
          blockId: block.id,
          protocol: block.kind === "aaveSupply" ? ("aave-v3" as const) : ("uniswap-v4" as const),
          config: { ...settings },
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
    if (group.sharePct === 0 && group.chains.every((chain) => chain.sharePct === 0)) {
      positions(group.chains, 4663, "profile", "robinhood");
      continue;
    }
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
