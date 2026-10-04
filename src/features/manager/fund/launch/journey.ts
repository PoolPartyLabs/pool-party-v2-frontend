/**
 * @id PP-MGR-LIB-045 (POO-2177)
 * @name FundLaunchJourneyStore
 * @implements-rules-version v2 (POO-2181); POO-2204 rules v1
 */
import { z } from "zod";
import { createRequestSchema } from "@/lib/api/v2/launchSchemas";
import { getChainById } from "@/lib/chains";
import type { FundLaunchDraft, LaunchJourney, LaunchStepPreview } from "./contracts";
import { journalKey, type LaunchJournal, loadJournal } from "./journal";
import { type CanvasPlan, deriveLaunchSteps, validateTickAlignment } from "./plan";
import { rawUsdc, reviewSchema } from "./review";

export { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
export function getLaunchSteps(draft: FundLaunchDraft): LaunchStepPreview[] {
  if (
    draft.plan.hub.chains.some(
      (chain) =>
        chain.sharePct <= 0 &&
        !(
          chain.sharePct === 0 &&
          chain.steps.some((step) => step.family === "position" && step.kind === "uniswapV4Pool")
        ),
    ) ||
    draft.plan.spokes.some((spoke) =>
      spoke.chains.some(
        (chain) =>
          chain.sharePct <= 0 &&
          !(
            chain.sharePct === 0 &&
            chain.steps.some((step) => step.family === "position" && step.kind === "uniswapV4Pool")
          ),
      ),
    )
  )
    throw new Error("INVALID_ALLOCATION");
  const steps = deriveLaunchSteps(
    draft.plan,
    draft.launchExecution ?? {},
    true,
    draft.networks.includes("robinhood"),
  );
  for (const step of steps.filter(
    (entry) => entry.protocol === "uniswap-v4" && entry.kind === "open",
  )) {
    const pool = draft.pools.find(
      (entry) =>
        entry.network === (step.chain === 42161 ? "arbitrum" : "robinhood") &&
        entry.poolId?.toLowerCase() === step.config?.poolId?.toLowerCase(),
    );
    if (pool?.poolKey) validateTickAlignment(step.config ?? {}, pool.poolKey.tickSpacing);
  }
  return steps.map((step) => ({
    id: step.id,
    chainId: step.chain,
    kind: step.kind,
    label: `manager.fundLaunch.${step.kind}`,
    signer:
      step.kind === "profile"
        ? "manager-message"
        : ["discover", "report", "arrival"].includes(step.kind)
          ? "server"
          : "manager-wallet",
    countsAsSignature: !["discover", "report", "arrival"].includes(step.kind),
  }));
}
export function journeyKey(journeyId: string): string {
  return `pp:v2:journey:1:${journeyId}`;
}
const launchChainSchema = z
  .object({
    id: z.string(),
    sharePct: z.number().finite(),
    steps: z.array(
      z
        .object({
          id: z.string(),
          family: z.enum(["position", "flow"]),
          kind: z.string(),
          auto: z.boolean().optional(),
          config: z
            .object({
              poolId: z.string().optional(),
              assetKey: z.string().optional(),
              priceLower: z.string().optional(),
              priceUpper: z.string().optional(),
              tickLower: z.number().finite().optional(),
              tickUpper: z.number().finite().optional(),
              fullRange: z.boolean().optional(),
              slippagePct: z.number().finite().optional(),
              displayInverted: z.boolean().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const launchPlanSchema = z
  .object({
    version: z.literal(1),
    hub: z.object({ chains: z.array(launchChainSchema) }).passthrough(),
    spokes: z.array(
      z
        .object({
          network: z.string(),
          sharePct: z.number().finite(),
          chains: z.array(launchChainSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export function assertLaunchPlan(value: unknown): asserts value is CanvasPlan {
  launchPlanSchema.parse(value);
}
export function readFrozenJournal(draftId: string, manager: string) {
  const journal = loadJournal(localStorage, draftId, manager);
  if (!journal) return null;
  z.object({
    checkpoints: z.record(
      z.object({
        txHash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .optional(),
        receiptStatus: z.enum(["success", "reverted", "unknown"]).optional(),
      }),
    ),
    addresses: z.record(z.string().regex(/^0x[0-9a-fA-F]{40}$/)),
  }).parse(journal);
  if (
    journal.steps.some((step) => {
      const checkpoint = journal.checkpoints[step.id];
      return checkpoint && checkpoint.chain !== step.chain;
    })
  )
    throw new Error("INVALID_JOURNAL");
  const frozen = z
    .object({ plan: z.unknown(), review: reviewSchema, request: createRequestSchema })
    .parse(journal.frozen);
  assertLaunchPlan(frozen.plan);
  if (
    frozen.request.manager.toLowerCase() !== manager.toLowerCase() ||
    frozen.request.minFirstDeposit !== rawUsdc(frozen.review.minimum).toString() ||
    frozen.request.seedAmount !== rawUsdc(frozen.review.seed).toString() ||
    frozen.request.performanceFeeBps !== frozen.review.performanceFeeBps ||
    frozen.request.managementFeeBps !== frozen.review.managementFeeBps ||
    frozen.request.payoutFeeBps !== frozen.review.payoutFeeBps
  )
    throw new Error("INVALID_JOURNAL");
  return journal;
}
export function readJourney(journeyId: string): LaunchJourney | null {
  if (typeof window === "undefined") return null;
  let storedId = journeyId;
  let raw = localStorage.getItem(journeyKey(storedId));
  if (raw === null) {
    try {
      storedId = decodeURIComponent(journeyId);
    } catch {
      throw new Error("INVALID_JOURNAL");
    }
    raw = localStorage.getItem(journeyKey(storedId));
  }
  if (raw === null) return null;
  const data = z
    .object({
      version: z.literal(1),
      journeyId: z.string(),
      draftId: z.string(),
      manager: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      createdAt: z.string(),
      draft: z.record(z.unknown()),
    })
    .passthrough()
    .parse(JSON.parse(raw));
  if (data.journeyId !== storedId || data.draft.id !== data.draftId)
    throw new Error("INVALID_JOURNAL");
  const journey = data as unknown as LaunchJourney;
  const journal = loadJournal(localStorage, journey.draftId, journey.manager);
  return { ...journey, ...(journal ? { journal } : {}) };
}
export function persistJourney(draft: FundLaunchDraft, manager: string): LaunchJourney {
  if (!getChainById(42161)) throw new Error("V2_UNAVAILABLE");
  const journeyId = `${manager.toLowerCase()}:${draft.id}`;
  const previous = readJourney(journeyId);
  if (previous) return previous;
  const journal = loadJournal(localStorage, draft.id, manager);
  if (!journal) getLaunchSteps(draft);
  const frozen = journal?.frozen as
    | { plan?: FundLaunchDraft["plan"]; review?: FundLaunchDraft["review"] }
    | undefined;
  const snapshot = {
    ...draft,
    ...(frozen?.plan ? { plan: frozen.plan } : {}),
    ...(frozen?.review ? { review: frozen.review } : {}),
  };
  const journey: LaunchJourney = {
    version: 1,
    journeyId,
    draftId: draft.id,
    manager: manager.toLowerCase(),
    draft: structuredClone(snapshot),
    createdAt: new Date().toISOString(),
    ...(journal ? { journal } : {}),
  };
  localStorage.setItem(journeyKey(journeyId), JSON.stringify(journey));
  return journey;
}
export function journeyPath(journeyId: string, locale: string): string {
  return `/${locale}/manager/fund-launch/${encodeURIComponent(journeyId)}`;
}
export function checkpointKey(journey: LaunchJourney): string {
  return journalKey(journey.draftId, journey.manager);
}
export function listLaunchJourneys(manager: string | null | undefined): {
  journeys: LaunchJourney[];
  unavailable: boolean;
} {
  if (!manager || typeof window === "undefined") return { journeys: [], unavailable: false };
  const journeys: LaunchJourney[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`pp:v2:journey:1:${manager.toLowerCase()}:`)) continue;
      try {
        const journey = readJourney(key.slice("pp:v2:journey:1:".length));
        if (
          journey?.manager.toLowerCase() === manager.toLowerCase() &&
          journey.draft.review?.name
        ) {
          launchStatus(journey);
          journeys.push(journey);
        }
      } catch {}
    }
    journeys.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    return { journeys, unavailable: false };
  } catch {
    return { journeys: [], unavailable: true };
  }
}
export function launchStatus(journey: LaunchJourney) {
  const steps =
    journey.journal?.steps ??
    getLaunchSteps(journey.draft).map((step) => ({
      ...step,
      chain: step.chainId,
      dependencies: [],
    }));
  return journalStatus(journey.journeyId, steps, journey.journal?.checkpoints ?? {});
}
function journalStatus(
  journeyId: string,
  steps: LaunchJournal["steps"],
  checkpoints: LaunchJournal["checkpoints"],
) {
  const current = steps.find((step) => checkpoints[step.id]?.status !== "confirmed") ?? null;
  const failed = steps.some((step) => checkpoints[step.id]?.status === "failed");
  const completed = steps.length > 0 && current === null;
  return {
    journeyId,
    status: completed ? ("complete" as const) : failed ? ("failed" as const) : ("paused" as const),
    current,
    outcome: completed
      ? ("completed" as const)
      : failed
        ? ("failed" as const)
        : ("in-progress" as const),
  };
}
export function getLaunchStatusForDraft(draftId: string, manager?: string | null) {
  if (!manager || typeof window === "undefined" || !/^0x[0-9a-fA-F]{40}$/.test(manager))
    return null;
  try {
    const journeyId = `${manager.toLowerCase()}:${draftId}`;
    const journey = readJourney(journeyId);
    if (journey) {
      if (journey.manager.toLowerCase() !== manager.toLowerCase() || journey.draftId !== draftId)
        return null;
      return launchStatus(journey);
    }
    const journal = readFrozenJournal(draftId, manager);
    if (!journal) return null;
    return journalStatus(journeyId, journal.steps, journal.checkpoints);
  } catch {
    return null;
  }
}
