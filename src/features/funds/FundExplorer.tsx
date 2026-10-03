/**
 * @id PP-STR-SCR-004 (POO-2175)
 * @name FundExplorer
 * @implements-rules-version v2
 * Isolated v2 discovery, holder portfolio and manager fund list.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import { loadFundsAction } from "./fundActions";
import { fundErrorKey } from "./fundModel";
export interface FundExplorerProps {
  view: "explore" | "holder" | "manager";
}
export function FundExplorer({ view }: FundExplorerProps) {
  const t = useTranslations("strategies.funds");
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
      {!result ? (
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
            <Link
              className="rounded-xl border border-border p-5 hover:bg-accent focus-visible:outline-2"
              href={`/funds/${fund.coreVault}`}
              key={`v2:${fund.coreVault}`}
            >
              <h2 className="font-semibold">{fund.profile?.name ?? `PP-${fund.creationNumber}`}</h2>
              <p className="text-sm text-muted-foreground">{fund.profile?.description}</p>
              <p className="break-all text-sm">
                {t("manager")}: {fund.manager}
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
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
