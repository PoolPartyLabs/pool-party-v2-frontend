/**
 * @id PP-STR-SCR-004 (POO-2175)
 * @name FundExplorer
 * @implements-rules-version v2 (POO-2175, POO-2181); v1 (POO-2179 explorer records)
 * Isolated v2 discovery, holder portfolio and manager fund list.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { FundDraftsSlot } from "@/features/manager/fund/components/FundDraftsSlot";
import { FundLaunchJourneysList } from "@/features/manager/fund/launch/FundLaunchJourneysList";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { isMockMode } from "@/lib/services";
import { FundListCard } from "./FundListCard";
import { loadFundsAction } from "./fundActions";
import { fundErrorKey } from "./fundModel";
export interface FundExplorerProps {
  view: "explore" | "holder" | "manager";
}
export function FundExplorer({ view }: FundExplorerProps) {
  const t = useTranslations("strategies.funds");
  const managerText = useTranslations("manager.dashboard");
  const fallbackText = useTranslations("manager.fallbackIndex");
  const { isEnabled } = useFeatureFlags();
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const [snapshot, setSnapshot] = useState<{
    identity: string;
    result: Awaited<ReturnType<typeof loadFundsAction>>;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const identity = `${view}:${address ?? ""}:${isSignedIn}`;
  const result = snapshot?.identity === identity ? snapshot.result : null;
  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1);
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ completed?: boolean }>).detail?.completed) refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("pp:v2:launch:")) refresh();
    };
    window.addEventListener("pp:v2:launch-changed", changed);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("pp:v2:launch-changed", changed);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    const requestKey = `${address ?? ""}:${retry}`;
    if (!requestKey) return;
    let active = true;
    setSnapshot(null);
    if (view !== "explore" && !isMockMode && !isSignedIn) return;
    void loadFundsAction(view)
      .then((value) => {
        if (active) setSnapshot({ identity, result: value });
      })
      .catch(() => {
        if (active)
          setSnapshot({
            identity,
            result: { ok: false, error: { status: 502, code: "V2_UNAVAILABLE" } },
          });
      });
    return () => {
      active = false;
    };
  }, [view, address, isSignedIn, retry, identity]);
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {view === "holder" ? t("holdings") : view === "manager" ? t("managerView") : t("title")}
      </h1>
      {view === "manager" ? (
        <>
          <Link className="rounded-lg border border-border px-4 py-2 w-fit" href="/manager/new">
            {managerText("createNew")}
          </Link>
          <FundDraftsSlot />
          {!isMockMode && isEnabled("fundContracts") ? (
            <Link className="underline focus-visible:outline-2" href="/manager/fund-launch/review">
              {fallbackText("title")}
            </Link>
          ) : null}
          <FundLaunchJourneysList manager={address} />
        </>
      ) : null}
      {view !== "explore" &&
      !isMockMode &&
      (!isSignedIn ||
        !address ||
        (result?.ok && result.data.wallet?.toLowerCase() !== address.toLowerCase())) ? (
        <p role="status">{t("session")}</p>
      ) : !result ? (
        <p role="status">{t("loading")}</p>
      ) : !result.ok ? (
        <div role="alert">
          <p>{t(result.error.status === 503 ? "dormant" : fundErrorKey(result.error.code))}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : result.data.funds.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {result.data.funds.map((fund) => (
            <div key={`v2:${fund.coreVault}`} className="flex flex-col gap-2">
              <FundListCard fund={fund} managerView={view === "manager"} />
              {result.data.holders[fund.coreVault] ? (
                <p>
                  {t("shares")}:{" "}
                  {formatUnits(BigInt(result.data.holders[fund.coreVault]?.shares ?? "0"), 18)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
