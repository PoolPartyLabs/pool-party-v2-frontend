/**
 * @id PP-STR-SCR-005 (POO-2175)
 * @name FundDetail
 * @implements-rules-version v2
 * Fund valuation, holder exposure, position history and manager read-only progress.
 */
"use client";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import type { FundBalances, FundPositionDetail, FundTransit } from "@/lib/api/v2/fundSchemas";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
import { FundActionsPanel } from "./FundActionsPanel";
import {
  loadFundAction,
  loadFundManagerAction,
  loadFundPositionAction,
  loadFundTransitAction,
} from "./fundActions";
import { fundErrorKey, reportFreshness } from "./fundModel";
export interface FundDetailProps {
  core: string;
}
export function FundDetail({ core }: FundDetailProps) {
  const t = useTranslations("strategies.funds");
  const { isEnabled } = useFeatureFlags();
  const { family, hydrated } = useContractFamily();
  if (!isEnabled("fundContracts") || (hydrated && family !== "v2")) return <p>{t("switchV2")}</p>;
  return hydrated ? <FundDetailData core={core} /> : <p role="status">{t("loading")}</p>;
}
function FundDetailData({ core }: FundDetailProps) {
  const t = useTranslations("strategies.funds");
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadFundAction>> | null>(null);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<FundPositionDetail | null>(null);
  const [manager, setManager] = useState<{
    transits: FundTransit[];
    balances: FundBalances[];
    cursor: string | null;
  } | null>(null);
  const [transit, setTransit] = useState<FundTransit | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const detailRun = useRef(0);
  useEffect(() => {
    const requestKey = `${address ?? ""}:${isSignedIn}:${revision}`;
    if (!requestKey) return;
    let active = true;
    detailRun.current += 1;
    setResult(null);
    setHistory(null);
    setManager(null);
    setTransit(null);
    setElapsed(0);
    void loadFundAction(core).then((value) => {
      if (active) setResult(value);
    });
    const timer = setInterval(() => {
      if (active) setElapsed((value) => value + 1);
    }, 1000);
    return () => {
      active = false;
      detailRun.current += 1;
      clearInterval(timer);
    };
  }, [core, address, isSignedIn, revision]);
  useEffect(() => {
    let active = true;
    if (result?.ok && result.data.wallet?.toLowerCase() === result.data.fund.manager.toLowerCase())
      void loadFundManagerAction(core).then((value) => {
        if (!active) return;
        if (value.ok)
          setManager({
            transits: value.data.transits.items,
            balances: value.data.balances,
            cursor: value.data.transits.nextCursor,
          });
        else setDetailError(fundErrorKey(value.error.code));
      });
    return () => {
      active = false;
    };
  }, [result, core]);
  if (!result) return <p role="status">{t("loading")}</p>;
  if (!result.ok)
    return (
      <div role="alert">
        <p>{t(fundErrorKey(result.error.code))}</p>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  const { fund, holder, wallet } = result.data;
  const money = (value: string | undefined, decimals = 6) =>
    value === undefined ? t("unavailable") : formatUnits(BigInt(value), decimals);
  const nav = [
    { label: t("sharePrice"), value: fund.sharePrice, decimals: 24 },
    { label: t("nav"), value: fund.shareAssets },
    { label: t("gross"), value: fund.grossAssets },
    { label: t("idle"), value: fund.idle },
    { label: t("freeIdle"), value: fund.freeIdle },
    { label: t("reserve"), value: fund.payoutReserve },
    { label: t("inFlight"), value: fund.inFlightValue },
  ];
  const fresh =
    fund.mandate.spokes.length === 0 ||
    reportFreshness(
      fund.lastReport?.ageSeconds ?? null,
      fund.mandate.spokes[0]?.maxReportAge ?? 0,
      elapsed,
    );
  return (
    <article className="flex flex-col gap-6">
      <header>
        {fund.profile?.imageUrl && /^https:\/\//.test(fund.profile.imageUrl) ? (
          <Image
            src={fund.profile.imageUrl}
            alt={fund.profile.name ?? `PP-${fund.creationNumber}`}
            width={80}
            height={80}
            unoptimized
            className="rounded-xl"
          />
        ) : null}
        <h1 className="text-2xl font-semibold">
          {fund.profile?.name ?? `PP-${fund.creationNumber}`}
        </h1>
        <p>{fund.profile?.description}</p>
        <p className="break-all">
          {t("manager")}: {fund.profile?.managerDisplayName ?? fund.manager}
        </p>
        <p>
          {t("state")}: {fund.state}
        </p>
      </header>
      <dl className="grid gap-4 rounded-xl border border-border p-5 md:grid-cols-3">
        {nav.map((row) => (
          <div key={row.label}>
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="font-semibold">{money(row.value, row.decimals)} USDC</dd>
          </div>
        ))}
      </dl>
      <section>
        <h2 className="font-semibold">{t("report")}</h2>
        <p aria-live="polite">
          {fund.lastReport
            ? t("reportAge", { seconds: fund.lastReport.ageSeconds + elapsed })
            : t("unavailable")}{" "}
          · {fresh ? t("fresh") : t("refreshing")}
        </p>
      </section>
      <section>
        <h2 className="font-semibold">{t("chains")}</h2>
        {fund.chains.map((chain) => (
          <p key={chain.chainId}>
            {chain.chainId === "42161" ? "Arbitrum" : "Robinhood"}:{" "}
            {chain.status === "created" ? t("created") : t("pending")}
          </p>
        ))}
      </section>
      <section>
        <h2 className="font-semibold">{t("limits")}</h2>
        <p>{t("notOnChain")}</p>
        {fund.limitsUsage ? <ReadOnlyFields value={fund.limitsUsage} /> : <p>{t("unavailable")}</p>}
      </section>
      {holder ? (
        <section className="rounded-xl border border-border p-5">
          <h2 className="font-semibold">{t("holdings")}</h2>
          <dl className="grid gap-3 md:grid-cols-3">
            {[
              { label: t("shares"), value: money(holder.shares, 18) },
              { label: t("value"), value: money(holder.value) },
              { label: t("income"), value: money(holder.incomeOwed) },
              { label: t("pendingPayout"), value: money(holder.payout.usdcOutstanding) },
              { label: t("claimability"), value: holder.claimable ? t("ready") : t("notReady") },
            ].map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {holder.payout.open ? (
            <p>
              {t("termEnds")}: {new Date(Number(holder.payout.termEndsAt) * 1000).toLocaleString()}
            </p>
          ) : null}
        </section>
      ) : null}
      <section>
        <h2 className="font-semibold">{t("positions")}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {fund.positionsSummary?.positions.map((position) => (
            <div
              className="rounded-xl border border-border p-5"
              key={`${position.chainId}:${position.positionKey}`}
            >
              <h3>
                {position.adapterKind === "aave-v3" ? "Aave v3" : "Uniswap v4"} ·{" "}
                {position.tokens.map((token) => token.symbol).join(" / ")}
              </h3>
              <p>
                {t("value")}: {position.valueUsd ?? t("unavailable")} USD
              </p>
              <p>
                {t("income")}: {position.uncollectedIncomeUsd ?? t("unavailable")} USD
              </p>
              {position.uniswap ? (
                <>
                  <p>
                    {t("range")}: {position.uniswap.tickLower} – {position.uniswap.tickUpper}
                  </p>
                  <p>{position.uniswap.inRange ? t("inRange") : t("outRange")}</p>
                </>
              ) : null}
              {position.aave ? (
                <p>
                  {t("balance")}: {position.aave.currentBalance.decimal} · APY{" "}
                  {position.aave.supplyApy ?? t("unavailable")}%
                </p>
              ) : null}
              {position.currentAmounts ? <ReadOnlyFields value={position.currentAmounts} /> : null}
              {position.uncollectedIncome ? (
                <ReadOnlyFields value={position.uncollectedIncome} />
              ) : null}
              {holder?.positionsSummary?.positions.find(
                (exposure) =>
                  exposure.positionKey === position.positionKey &&
                  exposure.chainId === position.chainId,
              )?.holderExposure ? (
                <ReadOnlyFields
                  value={
                    holder.positionsSummary.positions.find(
                      (exposure) =>
                        exposure.positionKey === position.positionKey &&
                        exposure.chainId === position.chainId,
                    )?.holderExposure
                  }
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  const request = ++detailRun.current;
                  setHistory(null);
                  void loadFundPositionAction(
                    core,
                    Number(position.chainId),
                    position.positionKey,
                  ).then((value) => {
                    if (request !== detailRun.current) return;
                    if (value.ok) setHistory(value.data);
                    else setDetailError(fundErrorKey(value.error.code));
                  });
                }}
              >
                {t("history")}
              </button>
            </div>
          )) ?? <p>{t("empty")}</p>}
        </div>
        {history ? (
          <div className="mt-4">
            <h3>{t("history")}</h3>
            <p>{history.history.complete ? t("complete") : t("partialHistory")}</p>
            {history.history.events.length === 0 ? (
              <p>{t("empty")}</p>
            ) : (
              history.history.events.map((event) => (
                <p className="break-all" key={event.transactionHash}>
                  {event.type} · {event.timestamp} · {event.transactionHash}
                </p>
              ))
            )}
          </div>
        ) : null}
      </section>
      {wallet && holder ? (
        <FundActionsPanel
          key={`${core}:${wallet}`}
          fund={fund}
          holder={holder}
          wallet={wallet}
          refresh={() => setRevision((value) => value + 1)}
        />
      ) : (
        <p>{t("session")}</p>
      )}
      {manager ? (
        <section>
          <h2 className="font-semibold">{t("managerView")}</h2>
          <h3>{t("balances")}</h3>
          {manager.balances.map((balance) => (
            <ReadOnlyFields key={balance.chainId} value={balance} />
          ))}
          <h3>{t("transits")}</h3>
          {manager.transits.length === 0 ? (
            <p>{t("empty")}</p>
          ) : (
            manager.transits.map((item) => (
              <button
                className="block"
                type="button"
                key={item.transitId}
                onClick={() => {
                  const request = ++detailRun.current;
                  void loadFundTransitAction(core, item.transitId).then((value) => {
                    if (request !== detailRun.current) return;
                    if (value.ok) setTransit(value.data);
                    else setDetailError(fundErrorKey(value.error.code));
                  });
                }}
              >
                {item.direction} · {item.stage} · {item.amountSent}
              </button>
            ))
          )}
          {manager.cursor ? (
            <button
              type="button"
              onClick={() => {
                const request = ++detailRun.current;
                void loadFundManagerAction(core, manager.cursor ?? undefined).then((value) => {
                  if (request !== detailRun.current) return;
                  if (value.ok)
                    setManager((previous) => ({
                      transits: [...(previous?.transits ?? []), ...value.data.transits.items],
                      balances: value.data.balances,
                      cursor: value.data.transits.nextCursor,
                    }));
                });
              }}
            >
              {t("loadMore")}
            </button>
          ) : null}
          {transit ? <ReadOnlyFields value={transit} /> : null}
        </section>
      ) : null}
      {detailError ? <p role="alert">{t(detailError)}</p> : null}
    </article>
  );
}
function ReadOnlyFields({ value }: { value: unknown }) {
  const t = useTranslations("strategies.funds");
  const labels: Record<string, string> = {
    raw: t("amount"),
    decimal: t("amount"),
    amount0: t("amount"),
    amount1: t("amount"),
    valueUsd: t("value"),
    currentPercent: t("limits"),
    percent: t("limits"),
    enforcedOnChain: t("notOnChain"),
    chainId: t("chains"),
    tokens: t("positions"),
    token: t("positions"),
    unallocatedBalance: t("balance"),
    operatingCash: t("balance"),
    stage: t("state"),
    state: t("state"),
    legs: t("transits"),
    direction: t("transits"),
    amountSent: t("amount"),
    credited: t("paid"),
    nextStepHint: t("notReady"),
    readyForNextStep: t("ready"),
    status: t("state"),
    balancesStatus: t("state"),
    networks: t("chains"),
    network: t("chains"),
  };
  if (value === null || value === undefined) return <span>{t("unavailable")}</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((entry) => (
          <li key={JSON.stringify(entry)}>
            <ReadOnlyFields value={entry} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl className="space-y-1">
        {Object.entries(value)
          .filter(([key]) => key !== "protocolVersion")
          .map(([key, entry]) => (
            <div className="flex flex-wrap gap-2 break-all text-sm" key={key}>
              <dt>{labels[key] ?? t("value")}</dt>
              <dd>
                <ReadOnlyFields value={entry} />
              </dd>
            </div>
          ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
