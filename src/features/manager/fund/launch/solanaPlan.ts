import { isFeatureEnabled } from "@/lib/features";
import { requireSolanaLpChoice } from "@/lib/solana/lpChoices";
import { resolveMaxPriceImpactBps } from "@/lib/solana/swap";
import type { ChainLaunchStep, LaunchStep, SolanaLaunchStep } from "./plan";

export interface SolanaLaunchSelection {
  sharePct: number;
  kamino: boolean;
  raydiumPool?: string;
  maxPriceImpactBps?: number;
}

export function normalizeSolanaLaunchSelection(
  selection: SolanaLaunchSelection,
): SolanaLaunchSelection {
  if (
    typeof selection.kamino !== "boolean" ||
    (selection.raydiumPool !== undefined &&
      (typeof selection.raydiumPool !== "string" || selection.raydiumPool.length === 0)) ||
    Object.keys(selection).some(
      (key) => !["sharePct", "kamino", "raydiumPool", "maxPriceImpactBps"].includes(key),
    )
  )
    throw new Error("INVALID_SOLANA_PLAN");
  if (selection.raydiumPool) requireSolanaLpChoice(selection.raydiumPool);
  return {
    sharePct: selection.sharePct,
    kamino: selection.kamino,
    raydiumPool: selection.raydiumPool,
    maxPriceImpactBps:
      selection.raydiumPool || selection.maxPriceImpactBps !== undefined
        ? resolveMaxPriceImpactBps(selection.maxPriceImpactBps)
        : undefined,
  };
}

/** DEC-188, DEC-190, DEC-191, DEC-193: append without changing either EVM spoke. */
export function withSolanaLaunchSteps(
  evmSteps: LaunchStep[],
  selection?: SolanaLaunchSelection,
): ChainLaunchStep[] {
  if (!selection) return evmSteps;
  if (!isFeatureEnabled("solanaSpoke")) throw new Error("SOLANA_DISABLED");
  selection = normalizeSolanaLaunchSelection(selection);
  if (
    !Number.isInteger(selection.sharePct) ||
    selection.sharePct <= 0 ||
    selection.sharePct > 100 ||
    (!selection.kamino && !selection.raydiumPool) ||
    !evmSteps.some((step) => step.id === "create") ||
    !evmSteps.some((step) => step.id === "profile") ||
    evmSteps.some((step) => step.id.startsWith("solana:"))
  )
    throw new Error("INVALID_SOLANA_PLAN");
  const evmShare = evmSteps
    .filter((step) => step.kind === "allocate" || step.kind === "bridge")
    .reduce((sum, step) => sum + (step.sharePct ?? 0), 0);
  if (evmShare + selection.sharePct > 100) throw new Error("INVALID_ALLOCATION");
  const step = (
    id: string,
    kind: SolanaLaunchStep["kind"],
    dependencies: string[],
    svm = true,
  ): SolanaLaunchStep => ({
    id: `solana:${id}`,
    kind,
    chain: svm ? "solana:mainnet" : 42161,
    chainKind: svm ? "svm" : "evm",
    dependencies,
    group: "solana",
    sharePct: selection.sharePct,
  });
  const binding = step("bind", "bind-solana", [], false);
  const steps = evmSteps.map((entry) => ({
    ...entry,
    chainKind: "evm" as const,
    dependencies:
      entry.kind === "create" ? [...entry.dependencies, binding.id] : entry.dependencies,
  }));
  const init = step("init", "init-solana", ["discover-hub", binding.id]);
  const report = step("report", "report", ["profile", init.id], false);
  const send = step("send", "cctp-fast", [report.id], false);
  const arrival = step("arrival", "solana-arrival", [send.id]);
  const result: ChainLaunchStep[] = [binding, ...steps, init, report, send, arrival];
  if (selection.kamino) result.push(step("supply", "kamino-supply", [arrival.id]));
  if (selection.raydiumPool) {
    result.push({
      ...step("ratio", "swap-to-ratio", [arrival.id]),
      config: { poolId: selection.raydiumPool, maxPriceImpactBps: selection.maxPriceImpactBps },
    });
    result.push({
      ...step("open", "raydium-open", ["solana:ratio"]),
      config: { poolId: selection.raydiumPool, maxPriceImpactBps: selection.maxPriceImpactBps },
    });
  }
  return result;
}
