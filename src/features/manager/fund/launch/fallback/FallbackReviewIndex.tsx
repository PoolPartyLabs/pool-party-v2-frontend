/**
 * @id PP-MGR-CMP-084 (POO-2183)
 * @name FallbackReviewIndex
 * @implements-rules-version v1
 * @i18n-namespace manager
 */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { isMockMode } from "@/lib/services";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import { listDrafts, subscribe } from "../../mandateDraftStore";
import { useV2MandateCatalog } from "../../useV2MandateCatalog";
import { listLaunchJourneys } from "../journey";
import { useV2LaunchStatus } from "../useV2LaunchStatus";
import { useV2LaunchWallet } from "../useV2LaunchWallet";
import { draftReadiness } from "./draftReadiness";

export function FallbackReviewIndex() {
  const translate = useTranslations("manager");
  const { isEnabled } = useFeatureFlags();
  if (!isEnabled("fundContracts") || isMockMode)
    return <p role="alert">{translate("fundLaunch.realOnly")}</p>;
  return <SavedDrafts />;
}

function SavedDrafts() {
  const translate = useTranslations("manager");
  const wallet = useV2LaunchWallet();
  const catalog = useV2MandateCatalog();
  const [snapshot, setSnapshot] = useState<{ manager: string; drafts: MandateDraft[] } | null>(
    null,
  );
  useEffect(() => {
    const manager = wallet.manager;
    if (!manager) return;
    // PP-INTEGRATION-POINT: existing browser-local draft store, read-only; no invented wallet ownership.
    const refresh = () => {
      const savedDrafts = listDrafts();
      const savedIds = new Set(savedDrafts.map((draft) => draft.id));
      const orphanedLaunches = listLaunchJourneys(manager)
        .journeys.filter((journey) => !savedIds.has(journey.draftId))
        .map((journey) => journey.draft);
      setSnapshot({ manager, drafts: [...savedDrafts, ...orphanedLaunches] });
    };
    refresh();
    const unsubscribe = subscribe(refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pp:v2:launch-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pp:v2:launch-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [wallet.manager]);
  const drafts = snapshot?.manager === wallet.manager ? snapshot?.drafts : null;
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1>{translate("fallbackIndex.title")}</h1>
      <p>{translate("fallbackIndex.localDrafts")}</p>
      {!wallet.manager ? (
        <p role="status">{translate("fallbackIndex.connect")}</p>
      ) : drafts === null ? (
        <p role="status">{translate("fallbackIndex.loading")}</p>
      ) : drafts.length === 0 ? (
        <p>{translate("fallbackIndex.empty")}</p>
      ) : (
        <ul className="space-y-6">
          {drafts.map((draft) => (
            <DraftRow
              key={`${wallet.manager}:${draft.id}`}
              draft={draft}
              catalog={catalog}
              balance={wallet.balance}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftRow({
  draft,
  catalog,
  balance,
}: {
  draft: MandateDraft;
  catalog: MandateCatalog;
  balance: bigint | null;
}) {
  const translate = useTranslations("manager");
  const formatter = useFormatter();
  const launch = useV2LaunchStatus(draft.id);
  const blockers = draftReadiness(draft, catalog, balance);
  const saved = draft.savedAt ? new Date(draft.savedAt) : null;
  const validDate = saved && Number.isFinite(saved.getTime());
  return (
    <li className="flex flex-col gap-2">
      <h2>{draft.name ?? translate("fallbackIndex.unnamed")}</h2>
      <p>
        {translate("fallbackIndex.lastSaved")}{" "}
        {validDate ? (
          <time dateTime={saved.toISOString()}>
            {formatter.dateTime(saved, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Europe/London",
            })}
          </time>
        ) : (
          translate("fallbackIndex.unsaved")
        )}
      </p>
      <div aria-live="polite">
        {blockers.length ? (
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{translate(`fallbackIndex.${blocker}`)}</li>
            ))}
          </ul>
        ) : (
          <p>{translate("fallbackIndex.ready")}</p>
        )}
      </div>
      <Link
        className="underline focus-visible:outline-2"
        href={`/manager/fund-launch/review/${encodeURIComponent(draft.id)}`}
      >
        {translate("fallbackIndex.reviewLaunch")}
      </Link>
      {launch && launch.outcome !== "completed" ? (
        <>
          <p>{translate("fallbackIndex.inProgress")}</p>
          <Link
            className="underline focus-visible:outline-2"
            href={`/manager/fund-launch/${encodeURIComponent(launch.journeyId)}`}
          >
            {translate("fallbackIndex.resume")}
          </Link>
        </>
      ) : null}
    </li>
  );
}
