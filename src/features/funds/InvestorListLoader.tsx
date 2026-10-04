/**
 * @id PP-STR-CMP-038
 * @name InvestorListLoader
 * @implements-rules-version v1 (POO-2215)
 * @analytics-events strategy_list_viewed (presenter), portfolio_viewed; navigation from existing presenters
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { TrackView } from "@/components/analytics/TrackView";
import { PortfolioView } from "@/features/portfolio/PortfolioView";
import { StrategiesExploreScreen } from "@/features/strategies/StrategiesExploreScreen";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import { loadInvestorListAction } from "./investorListActions";
import { projectInvestorFund, projectInvestorHolding } from "./investorListModel";

export function InvestorListLoader({ view }: { view: "explore" | "holder" }) {
  const t = useTranslations("strategies.investorV2");
  const status = useTranslations("strategies.funds");
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const identity = `v2:${view}:${address ?? ""}:${isSignedIn}`;
  const [snapshot, setSnapshot] = useState<{
    identity: string;
    result: Awaited<ReturnType<typeof loadInvestorListAction>>;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [count, setCount] = useState(5);
  const [closedCount, setClosedCount] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: view === "holder" ? "yield" : "tvl",
    dir: "desc",
  });
  const [sortExplicit, setSortExplicit] = useState(false);
  const result = snapshot?.identity === identity ? snapshot.result : null;

  useEffect(() => {
    let current = true;
    void revision; // Explicit refresh trigger preserves the last good snapshot.
    if (view === "holder" && !isMockMode && (!isSignedIn || !address)) return;
    // PP-INTEGRATION-POINT: server action verifies the session; no private identity sent as input.
    void loadInvestorListAction(view)
      .then((result) => {
        if (current) setSnapshot({ identity, result });
      })
      .catch(() => {
        if (current)
          setSnapshot({
            identity,
            result: { ok: false, error: { status: 502, code: "V2_UNAVAILABLE" } },
          });
      });
    return () => {
      current = false;
    };
  }, [identity, view, address, isSignedIn, revision]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") setRevision((n) => n + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 45000);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const rows = useMemo(() => {
    if (!result?.ok) return [];
    const q = query.trim().toLowerCase();
    const filtered = result.data.funds
      .map(projectInvestorFund)
      .filter((item) => !q || `${item.name} ${item.manager} ${item.id}`.toLowerCase().includes(q));
    if (q && !sortExplicit)
      return filtered.sort((a, b) => {
        const rank = (name: string) =>
          name.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) ? 1 : 2;
        return rank(a.name) - rank(b.name);
      });
    return filtered.sort((a, b) => {
      const av = sort.key === "min" ? a.minInvestment : a.tvlUsd;
      const bv = sort.key === "min" ? b.minInvestment : b.tvlUsd;
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return (av - bv) * (sort.dir === "asc" ? 1 : -1);
    });
  }, [result, query, sort, sortExplicit]);
  const sessionMismatch =
    view === "holder" &&
    !isMockMode &&
    result?.ok &&
    result.data.wallet?.toLowerCase() !== address?.toLowerCase();
  if (sessionMismatch || (view === "holder" && !isMockMode && (!address || !isSignedIn)))
    return <p role="status">{status("session")}</p>;
  if (!result)
    return (
      <div className="animate-pulse rounded-xl border border-border bg-surface h-64" role="status">
        {status("loading")}
      </div>
    );
  if (!result.ok)
    return (
      <div role="alert">
        <p>{t("error")}</p>
        <button type="button" onClick={() => setRevision((n) => n + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  const reset = () => setCount(5);
  const personalMatches =
    isSignedIn && !!address && result.data.wallet?.toLowerCase() === address.toLowerCase();
  if (view === "explore")
    return (
      <StrategiesExploreScreen
        investorV2
        strategies={rows.slice(0, count)}
        ownedIds={
          personalMatches
            ? result.data.funds
                .filter((f) => f.manager.toLowerCase() === result.data.wallet?.toLowerCase())
                .map((f) => f.coreVault)
            : []
        }
        investedIds={personalMatches ? Object.keys(result.data.holders) : []}
        paged={{
          total: rows.length,
          hasMore: count < rows.length,
          loading: false,
          onLoadMore: () => setCount((n) => n + 5),
          onQueryChange: (q) => {
            setQuery(q);
            reset();
          },
          onRiskChange: reset,
          onCategoriesChange: reset,
          onSortChange: (s) => {
            setSortExplicit(true);
            setSort(s);
            reset();
          },
        }}
      />
    );
  const entries = result.data.funds.flatMap((fund) => {
    const holder = result.data.holders[fund.coreVault];
    return holder && result.data.wallet
      ? [
          {
            strategy: projectInvestorFund(fund),
            position: projectInvestorHolding(fund, holder, result.data.wallet),
          },
        ]
      : [];
  });
  const active = entries.filter(
    (e) =>
      e.position.currentValue > 0 ||
      e.position.status !== "closed" ||
      result.data.holders[e.strategy.id]?.payout.open ||
      BigInt(result.data.holders[e.strategy.id]?.incomeOwed ?? "0") > 0n,
  );
  if (sort.key === "value")
    active.sort(
      (a, b) => (a.position.currentValue - b.position.currentValue) * (sort.dir === "asc" ? 1 : -1),
    );
  const exited = entries.filter((e) => !active.includes(e));
  const totalValue = null; // API discovery has no completeness signal; do not print a partial total.
  return (
    <>
      <TrackView event="portfolio_viewed" />
      <PortfolioView
        investorV2
        totalValue={totalValue}
        currentValue={totalValue}
        invested={null}
        totalYield={null}
        totalEarned={null}
        avgApy={null}
        chartData={[]}
        allocation={null}
        positions={active.slice(0, count)}
        paged={{
          active: {
            hasMore: count < active.length,
            loading: false,
            onLoadMore: () => setCount((n) => n + 5),
            onSortChange: (s) => {
              setSortExplicit(true);
              setSort(s);
              reset();
            },
          },
          closed: {
            entries: closedCount ? exited.slice(0, closedCount) : null,
            hasMore: closedCount < exited.length,
            loading: false,
            onReveal: () => setClosedCount(5),
            onLoadMore: () => setClosedCount((n) => n + 5),
          },
        }}
      />
    </>
  );
}
