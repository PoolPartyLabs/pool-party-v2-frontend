/** @id PP-MGR-HOK-023 @name useOverviewSetup @implements-rules-version v1 (POO-2245) */
"use client";
import { useEffect, useState } from "react";
import { listLaunchJourneysSnapshot } from "../launch/journey";
import { listDraftsSnapshot, subscribe } from "../mandateDraftStore";
import type { SetupSnapshot } from "./overviewModel";
export function useOverviewSetup(manager?: string) {
  const [snapshot, setSnapshot] = useState<{ manager?: string; data: SetupSnapshot } | null>(null);
  useEffect(() => {
    const read = () => {
      const drafts = listDraftsSnapshot();
      const journeys = listLaunchJourneysSnapshot(manager);
      setSnapshot({
        manager,
        data: {
          drafts: drafts.drafts,
          journeys: journeys.journeys,
          draftStatus: drafts.status,
          journeyStatus: journeys.status,
        },
      });
    };
    read();
    const unsub = subscribe(read);
    window.addEventListener("pp:v2:launch-changed", read);
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => {
      unsub();
      window.removeEventListener("pp:v2:launch-changed", read);
      window.removeEventListener("storage", read);
      window.removeEventListener("focus", read);
    };
  }, [manager]);
  return snapshot && snapshot.manager === manager ? snapshot.data : null;
}
