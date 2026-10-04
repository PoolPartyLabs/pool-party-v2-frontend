/**
 * @id PP-MGR-CMP-082 (POO-2181)
 * @name FundLaunchJourneysList
 * @implements-rules-version v2
 * Wallet-local launch history using the existing journey store.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { launchStatus, listLaunchJourneys } from "./journey";

export interface FundLaunchJourneysListProps {
  manager: string | undefined;
}
export function FundLaunchJourneysList({ manager }: FundLaunchJourneysListProps) {
  const t = useTranslations("strategies.funds");
  const [snapshot, setSnapshot] = useState<{
    manager: string | undefined;
    data: ReturnType<typeof listLaunchJourneys>;
  } | null>(null);
  useEffect(() => {
    const refresh = () => setSnapshot({ manager, data: listLaunchJourneys(manager) });
    refresh();
    window.addEventListener("pp:v2:launch-changed", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("pp:v2:launch-changed", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [manager]);
  const data = snapshot?.manager === manager ? snapshot?.data : null;
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-semibold">{t("launchJourneys")}</h2>
      {!data ? (
        <p role="status">{t("loading")}</p>
      ) : data.unavailable ? (
        <p role="alert">{t("journeysUnavailable")}</p>
      ) : data.journeys.length === 0 ? (
        <p>{t("noJourneys")}</p>
      ) : (
        <ul className="space-y-4">
          {data.journeys.map((journey) => {
            const status = launchStatus(journey);
            const core = journey.journal?.addresses.coreVault;
            return (
              <li
                key={journey.journeyId}
                className="flex flex-wrap items-center gap-3 border-b border-border pb-3"
              >
                <span className="flex-1">
                  {journey.draft.review.name} ·{" "}
                  {status.outcome === "completed" ? t("journeyCompleted") : t("journeyInProgress")}
                </span>
                <Link
                  className="rounded-md border border-border px-3 py-2 focus-visible:outline-2"
                  href={`/manager/fund-launch/${encodeURIComponent(journey.journeyId)}`}
                >
                  {status.outcome === "completed" ? t("viewJourney") : t("resumeLaunch")}
                </Link>
                {core && /^0x[0-9a-fA-F]{40}$/.test(core) ? (
                  <Link className="underline" href={`/funds/${core}?view=manager`}>
                    {t("viewDetails")}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
