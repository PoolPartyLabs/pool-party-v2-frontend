/**
 * @id PP-MGR-LIB-045 (POO-2177)
 * @name FundLaunchJourneyStore
 * @implements-rules-version v1
 */
import { z } from "zod";
import { getChainById } from "@/lib/chains";
import type { FundLaunchDraft, LaunchJourney, LaunchStepPreview } from "./contracts";
import { journalKey, loadJournal } from "./journal";
import { deriveLaunchSteps } from "./plan";

const bases = {
  42161: "https://arbiscan.io",
  4663: "https://robinhoodchain.blockscout.com",
} as const;
export function explorerTxUrl(chainId: number, hash: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !(chainId in bases)) return null;
  return `${bases[chainId as keyof typeof bases]}/tx/${hash}`;
}
export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !(chainId in bases)) return null;
  return `${bases[chainId as keyof typeof bases]}/address/${address}`;
}
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
  const raw = localStorage.getItem(journeyKey(journeyId));
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
  if (data.journeyId !== journeyId || data.draft.id !== data.draftId)
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
