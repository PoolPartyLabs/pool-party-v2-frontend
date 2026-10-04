/**
 * @id PP-MGR-LIB-045 (POO-2177)
 * @name FundLaunchJourneyStore
 * @implements-rules-version v2 (POO-2181)
 */
import { z } from "zod";
import { getChainById } from "@/lib/chains";
import type { FundLaunchDraft, LaunchJourney, LaunchStepPreview } from "./contracts";
import { journalKey, loadJournal } from "./journal";
import { deriveLaunchSteps } from "./plan";

export { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
export function getLaunchSteps(draft: FundLaunchDraft): LaunchStepPreview[] {
  if (
    draft.plan.hub.chains.some((chain) => chain.sharePct <= 0) ||
    draft.plan.spokes.some((spoke) => spoke.chains.some((chain) => chain.sharePct <= 0))
  )
    throw new Error("INVALID_ALLOCATION");
  return deriveLaunchSteps(
    draft.plan,
    draft.launchExecution ?? {},
    true,
    draft.networks.includes("robinhood"),
  ).map((step) => ({
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
  getLaunchSteps(draft);
  const journal = loadJournal(localStorage, draft.id, manager);
  const journey: LaunchJourney = {
    version: 1,
    journeyId,
    draftId: draft.id,
    manager: manager.toLowerCase(),
    draft: structuredClone(draft),
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
  const current =
    steps.find((step) => journey.journal?.checkpoints[step.id]?.status !== "confirmed") ?? null;
  const failed = steps.some((step) => journey.journal?.checkpoints[step.id]?.status === "failed");
  const completed = steps.length > 0 && current === null;
  return {
    journeyId: journey.journeyId,
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
  const journey = listLaunchJourneys(manager).journeys.find((entry) => entry.draftId === draftId);
  if (!journey) return null;
  try {
    return launchStatus(journey);
  } catch {
    return null;
  }
}
