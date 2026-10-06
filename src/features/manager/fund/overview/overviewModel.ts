/** @id PP-MGR-LIB-058 @name overviewModel @implements-rules-version v1 (POO-2245) */
import type { FundListEntry } from "@/features/funds/fundListModel";
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
