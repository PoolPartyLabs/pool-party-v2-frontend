/**
 * @id PP-STR-SCR-004 (POO-2175)
 * @name FundExplorer
 * @implements-rules-version v2 (POO-2175); v1 (POO-2179 explorer records)
 * Isolated v2 discovery, holder portfolio and manager fund list.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { FundDraftsSlot } from "@/features/manager/fund/components/FundDraftsSlot";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import { ExplorerFields } from "./ExplorerFields";
import { loadFundsAction } from "./fundActions";
import { fundErrorKey } from "./fundModel";
export interface FundExplorerProps {
  view: "explore" | "holder" | "manager";
}
export function FundExplorer({ view }: FundExplorerProps) {
  const t = useTranslations("strategies.funds");
  const managerText = useTranslations("manager.dashboard");
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadFundsAction>> | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const requestKey = `${address ?? ""}:${retry}`;
    if (!requestKey) return;
    let active = true;
    setResult(null);
    if (view !== "explore" && !isMockMode && !isSignedIn) return;
    void loadFundsAction(view).then((value) => {
      if (active) setResult(value);
    });
    return () => {
      active = false;
    };
  }, [view, address, isSignedIn, retry]);
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
        </>
      ) : null}
      {view !== "explore" && !isMockMode && !isSignedIn ? (
        <p role="status">{t("session")}</p>
      ) : !result ? (
        <p role="status">{t("loading")}</p>
      ) : !result.ok ? (
        <div role="alert">
          <p>{t(fundErrorKey(result.error.code))}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : result.data.funds.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {result.data.funds.map((fund) => (
            <article className="rounded-xl border border-border p-5" key={`v2:${fund.coreVault}`}>
              <h2 className="font-semibold">
                <Link
                  className="hover:underline focus-visible:outline-2"
                  href={`/funds/${fund.coreVault}`}
                >
                  {fund.profile?.name ?? `PP-${fund.creationNumber}`}
                </Link>
              </h2>
              <p className="text-sm text-muted-foreground">{fund.profile?.description}</p>
              <p className="break-all text-sm">
                {t("manager")}: <ExplorerFields value={fund.manager} chainId={42161} />
              </p>
              <p>
                {fund.chains
                  .map((chain) => (chain.chainId === "42161" ? "Arbitrum" : "Robinhood"))
                  .join(" · ")}
              </p>
              {result.data.holders[fund.coreVault] ? (
                <p>
                  {t("shares")}:{" "}
                  {formatUnits(BigInt(result.data.holders[fund.coreVault]?.shares ?? "0"), 18)}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
