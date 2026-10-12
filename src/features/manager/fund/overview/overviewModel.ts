/** @id PP-MGR-LIB-058 @name overviewModel @implements-rules-version v1 (POO-2245) @implements-rules-version v1 (POO-2335) */
import type { FundListEntry } from "@/features/funds/fundListModel";
import { apiNetworkForChain, chainDisplayName } from "@/lib/chains/config";
import { initialsFor } from "@/lib/utils/initials";
import type { LaunchJourney } from "../launch/contracts";
import { launchStatus } from "../launch/journey";
import type { MandateDraft } from "../mandateDraft";
export type ReadStatus = "available" | "unavailable" | "corrupt";
export interface SetupSnapshot {
  drafts: MandateDraft[];
  journeys: LaunchJourney[];
  draftStatus: ReadStatus;
  journeyStatus: ReadStatus;
}
export type SetupItem =
  | { kind: "draft"; draft: MandateDraft }
  | { kind: "launch"; journey: LaunchJourney; completed: boolean };
export function overviewModel(
  funds: FundListEntry[] | null,
  setup: SetupSnapshot,
  manager?: string,
) {
  const journeys = setup.journeys.filter(
    (j) =>
      manager &&
      j.manager.toLowerCase() === manager.toLowerCase() &&
      j.draftId === j.draft.id &&
      j.journeyId === `${manager.toLowerCase()}:${j.draftId}`,
  );
  const drafts = setup.drafts.filter((d) => !journeys.some((j) => j.draftId === d.id));
  const blockedCores = new Set(
    journeys
      .filter((j) => launchStatus(j).outcome !== "completed")
      .map((j) => j.journal?.addresses.coreVault?.toLowerCase())
      .filter(Boolean),
  );
  const items: SetupItem[] = journeys
    .filter(
      (j) =>
        launchStatus(j).outcome !== "completed" ||
        !funds?.some(
          (f) => f.coreVault.toLowerCase() === j.journal?.addresses.coreVault?.toLowerCase(),
        ),
    )
    .map((journey) => ({
      kind: "launch",
      journey,
      completed: launchStatus(journey).outcome === "completed",
    }));
  items.push(...drafts.map((draft) => ({ kind: "draft" as const, draft })));
  return {
    rows: [
      ...new Map(
        (funds ?? [])
          .filter((f) => !blockedCores.has(f.coreVault.toLowerCase()))
          .map((f) => [f.coreVault.toLowerCase(), f]),
      ).values(),
    ],
    setup: items,
    firstUse: false,
    localUnavailable: setup.draftStatus !== "available" || setup.journeyStatus !== "available",
  };
}

export type OverviewStatusTone = "success" | "warning" | "muted";
export interface OverviewStrategyRow {
  name: string;
  initials: string;
  logoUrl: string | null;
  status: {
    key: "stateOpen" | "stateClosing" | "stateClosed" | "notAvailable";
    tone: OverviewStatusTone;
  };
  networks: Array<{ chainId: string; slug: string | null; name: string }>;
}
/** R9 (POO-2335): the strategy row parts of Figma 8427:2829. Network names come from chain config. */
export function overviewStrategyRow(fund: FundListEntry): OverviewStrategyRow {
  const name = fund.profile?.name?.trim() || `PP-${fund.creationNumber}`;
  const status: OverviewStrategyRow["status"] =
    fund.state === "Open"
      ? { key: "stateOpen", tone: "success" }
      : fund.state === "Closing"
        ? { key: "stateClosing", tone: "warning" }
        : fund.state === "Closed"
          ? { key: "stateClosed", tone: "muted" }
          : { key: "notAvailable", tone: "muted" };
  return {
    name,
    initials: initialsFor(name),
    logoUrl: fund.profile?.imageUrl || fund.profile?.image || null,
    status,
    networks: fund.chains.map((chain) => {
      const id = Number(chain.chainId);
      return {
        chainId: chain.chainId,
        slug: apiNetworkForChain(id) ?? null,
        name: chainDisplayName(id) ?? chain.chainId,
      };
    }),
  };
}
