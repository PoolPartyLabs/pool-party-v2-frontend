/**
 * @id PP-STR-SCR-006
 * @name FundDetail
 * @implements-rules-version v1 (POO-2216); v1 (POO-2220); v1 (POO-2224)
 * @analytics-events strategy_detail_viewed, app_cta_blocked, app_error_shown
 * Investor V2 projection in the existing Details frame; technical manager view is separate.
 */
"use client";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { InvestModal } from "@/features/strategies/components/InvestModal";
import { ManagerCard } from "@/features/strategies/components/ManagerCard";
import { StrategyDetailFrame } from "@/features/strategies/components/StrategyDetailFrame";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { FundView } from "@/lib/api/v2/fundSchemas";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
import { isMockMode } from "@/lib/services";
import { readErc20Balance } from "@/lib/tokens/readErc20";
import { formatPercent, formatTokenAmount, formatUsdPrecise } from "@/lib/utils/format";
import { FundTechnicalDetail } from "./FundTechnicalDetail";
import { loadPersonalFundDetailsAction, loadPublicFundDetailsAction } from "./fundDetailsActions";
import {
  detailedCoverage,
  fundResumeAmount,
  hasFundInterest,
  type PersonalFundState,
} from "./fundDetailsModel";

export interface FundDetailProps {
  core: string;
}
export function FundDetail({ core }: FundDetailProps) {
  const t = useTranslations("strategies.funds");
  const { isEnabled } = useFeatureFlags();
  const { family, hydrated } = useContractFamily();
  if (!isEnabled("fundContracts") || (hydrated && family !== "v2")) return <p>{t("switchV2")}</p>;
  return hydrated ? <FundInvestorDetails core={core} /> : <p role="status">{t("loading")}</p>;
}
function FundInvestorDetails({ core }: FundDetailProps) {
  const t = useTranslations("strategies.DetailsV2");
  const { address } = useAuth();
  const { track } = useAnalytics();
  const { isSignedIn } = useSiweSession();
  const [publicRead, setPublicRead] = useState<Awaited<
    ReturnType<typeof loadPublicFundDetailsAction>
  > | null>(null);
  const [personal, setPersonal] = useState<PersonalFundState>({ status: "loading" });
  const [balanceRead, setBalanceRead] = useState<{ identity: string; value: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const [identity, setIdentity] = useState("");
  const key = `${core}:${address ?? ""}:${isSignedIn}:${revision}`;
  useEffect(() => {
    let active = true;
    setIdentity(key);
    setPublicRead(null);
    setPersonal(address && isSignedIn ? { status: "loading" } : { status: "disconnected" });
    void loadPublicFundDetailsAction(core)
      .then((result) => {
        if (active) setPublicRead(result);
      })
      .catch(() => {
        if (active) setPublicRead({ ok: false, code: "V2_UNAVAILABLE" });
      });
    if (address && isSignedIn)
      void loadPersonalFundDetailsAction(core)
        .then((result) => {
          if (!active) return;
          setPersonal(
            result.ok &&
              result.data.holder &&
              result.data.wallet?.toLowerCase() === address.toLowerCase()
              ? { status: "ready", holder: result.data.holder, wallet: result.data.wallet }
              : { status: "error", code: result.ok ? "V2_SESSION" : result.error.code },
          );
        })
        .catch(() => {
          if (active) setPersonal({ status: "error", code: "V2_UNAVAILABLE" });
        });
    return () => {
      active = false;
    };
  }, [core, address, isSignedIn, key]);
  useEffect(() => {
    if (isMockMode || !publicRead?.ok || !address || identity !== key) return;
    let active = true;
    // PP-INTEGRATION-POINT: same existing ERC20 balance reader as provisioning, hub USDC only.
    void readErc20Balance(
      publicRead.fund.mandate.usdc as `0x${string}`,
      address as `0x${string}`,
      42161,
    )
      .then((raw) => {
        if (active) setBalanceRead({ identity: key, value: Number(formatUnits(raw, 6)) });
      })
      .catch(() => {
        if (active) setBalanceRead(null);
      });
    return () => {
      active = false;
    };
  }, [identity, key, publicRead, address]);
  const errorCode =
    publicRead && !publicRead.ok
      ? publicRead.code
      : personal.status === "error"
        ? personal.code
        : null;
  useEffect(() => {
    if (identity === key && errorCode)
      track("app_error_shown", {
        strategy_id: core,
        error_code: errorCode,
        error_origin: "upstream",
      });
  }, [identity, key, errorCode, track, core]);
  if (identity !== key || !publicRead) return <p role="status">{t("loading")}</p>;
  if (!publicRead.ok)
    return (
      <div role="alert">
        <p>{t("unavailable")}</p>
        <button type="button" onClick={() => setRevision((v) => v + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  return (
    <FundDetailsPresenter
      key={key}
      fund={publicRead.fund}
      personal={personal}
      balance={balanceRead?.identity === key ? balanceRead.value : null}
      onRetry={() => setRevision((v) => v + 1)}
    />
  );
}
export function FundDetailsPresenter({
  fund,
  personal,
  balance = null,
  onRetry,
}: {
  fund: FundView;
  personal: PersonalFundState;
  balance?: number | null;
  onRetry?: () => void;
}) {
  const t = useTranslations("strategies.DetailsV2");
  const fundText = useTranslations("strategies.funds");
  const query = useSearchParams();
  const { track } = useAnalytics();
  useTrackView("strategy_detail_viewed", { strategy_id: fund.coreVault });
  const [investOpen, setInvestOpen] = useState(false);
  const [resume, setResume] = useState<number | null>(null);
  const fromPortfolio = query.get("from") === "portfolio";
  const withdrawalRequested = query.get("withdraw") === "1";
  const managerView =
    query.get("view") === "manager" &&
    personal.status === "ready" &&
    personal.wallet.toLowerCase() === fund.manager.toLowerCase();
  useEffect(() => {
    const amount = fundResumeAmount(query, personal);
    if (amount !== null) {
      setResume(amount);
      setInvestOpen(true);
    }
  }, [query, personal]);
  const money = (raw: string | undefined, decimals = 6) =>
    raw === undefined
      ? t("unavailable")
      : formatTokenAmount(Number(formatUnits(BigInt(raw), decimals)), "USDC", 6);
  const number = (raw: string, decimals: number) =>
    formatTokenAmount(Number(formatUnits(BigInt(raw), decimals)), "", 6).trim();
  const pct = (bps: unknown) =>
    typeof bps === "number" ? formatPercent(bps / 100, 2) : t("unavailable");
  const fundName = fund.profile?.name?.trim() || `PP-${fund.creationNumber}`;
  const fundLogo = fund.profile?.imageUrl || fund.profile?.image || undefined;
  const managerName = fund.profile?.managerDisplayName?.trim() || fund.manager;
  const chainName = (id: string) =>
    id === "42161" ? "Arbitrum" : id === "4663" ? "Robinhood" : id;
  const tokenName = (chainId: string, address: string) =>
    fund.positionsSummary?.positions
      .filter((position) => position.chainId === chainId)
      .flatMap((position) => position.tokens)
      .find((token) => token.address.toLowerCase() === address.toLowerCase())?.symbol ||
    `${address.slice(0, 6)}…${address.slice(-4)}`;
  const protocolName = (chainId: string, address: string) => {
    const chain = fund.chains.find((chain) => chain.chainId === chainId);
    if (chain?.uniswapV4Adapter?.toLowerCase() === address.toLowerCase()) return "Uniswap v4";
    if (chain?.uniswapV3SwapAdapter?.toLowerCase() === address.toLowerCase()) return "Uniswap v3";
    if (chain?.aaveV3Adapter?.toLowerCase() === address.toLowerCase()) return "Aave v3";
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  };
  const holder = personal.status === "ready" ? personal.holder : null;
  const owned = holder ? hasFundInterest(holder) : false;
  const closed = fund.state !== "Open";
  const coverage = detailedCoverage(fund);
  const positions = fund.positionsSummary?.positions ?? [];
  const blocked = (action: string) =>
    track("app_cta_blocked", {
      strategy_id: fund.coreVault,
      reason: `capability_unavailable:${action}`,
    });
  const unavailableAction = (label: string) => (
    <button
      type="button"
      aria-disabled="true"
      onClick={() => blocked(label)}
      className="rounded-lg border border-border px-3 py-2 text-muted-foreground text-sm"
    >
      {label}: {t("unavailable")}
    </button>
  );
  const actions = (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      {!closed ? (
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground"
          onClick={() => setInvestOpen(true)}
        >
          {owned ? t("addFunds") : t("invest")}
        </button>
      ) : (
        <p>{fund.state === "Closed" ? t("closed") : t("closing")}</p>
      )}
      {owned ? (
        <>
          {unavailableAction(t("collect"))}
          {unavailableAction(t("withdraw"))}
        </>
      ) : null}
      {withdrawalRequested && !owned ? unavailableAction(t("withdraw")) : null}
      {!owned && !closed ? (
        <>
          <Row label={t("minimum")} value={money(fund.mandate.minFirstDeposit)} />
          <Row label={t("currency")} value="USDC" />
        </>
      ) : null}
    </div>
  );
  const position =
    personal.status === "loading" ? (
      <div role="status" className="rounded-xl border border-border p-5">
        {t("loading")}
      </div>
    ) : personal.status === "error" ? (
      <div role="alert" className="rounded-xl border border-border p-5">
        <p>{t("holderError")}</p>
        <button type="button" onClick={onRetry}>
          {t("retry")}
        </button>
      </div>
    ) : owned && holder ? (
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">{t("yourPosition")}</h2>
        <Row label={t("currentValue")} value={money(holder.value)} />
        <Row label={t("shares")} value={number(holder.shares, 18)} />
        <Row label={t("income")} value={money(holder.incomeOwed)} />
        {holder.payout.open ? (
          <>
            <Row label={t("pendingPayout")} value={money(holder.payout.usdcOutstanding)} />
            <p>{t("processing")}</p>
          </>
        ) : null}
      </section>
    ) : null;
  const manager = (
    <ManagerCard
      name={managerName}
      address={fund.manager}
      verified={false}
      trailingAction={unavailableAction(t("follow"))}
    />
  );
  if (managerView) return <FundTechnicalDetail core={fund.coreVault} />;
  return (
    <StrategyDetailFrame
      backHref={fromPortfolio ? "/portfolio" : "/strategies"}
      backLabel={t("back")}
      rail={
        <>
          {position}
          {actions}
          {manager}
        </>
      }
      flows={
        <InvestModal
          family="v2"
          fund={{
            core: fund.coreVault,
            name: fundName,
            logoUrl: fundLogo,
            minFirstDepositRaw: fund.mandate.minFirstDeposit,
            holderSharesRaw: holder?.shares ?? null,
          }}
          balance={balance}
          open={investOpen}
          onOpenChange={setInvestOpen}
          resumeAmount={resume}
          fromPortfolio={fromPortfolio}
          walletAddress={personal.status === "ready" ? personal.wallet : undefined}
        />
      }
    >
      <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
        <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap">
          <StrategyLogo url={fundLogo} name={fundName} className="size-12 text-lg font-semibold" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-bold text-xl">{fundName}</h1>
            <p className="break-words text-muted-foreground text-sm [overflow-wrap:anywhere]">
              {managerName}
            </p>
            <span className="rounded border border-border px-1.5 py-0.5 text-xs font-medium">
              V2
            </span>
          </div>
          <div className="w-full min-w-0 text-left sm:w-auto sm:text-right">
            <p className="break-words font-bold text-2xl tabular-nums">
              {money(fund.sharePrice, 24)}
            </p>
            <p className="text-muted-foreground text-xs">{t("sharePrice")}</p>
          </div>
        </div>
        <Row label={t("risk")} value={t("unavailable")} />
      </section>
      <div className="lg:hidden">{position}</div>
      <div className="lg:hidden">{actions}</div>
      <div className="lg:hidden">{manager}</div>
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">{t("history")}</h2>
        <div className="mt-4 flex h-32 items-center justify-center rounded-lg border border-border border-dashed lg:h-40">
          {t("unavailable")}
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        {[
          [t("minimum"), money(fund.mandate.minFirstDeposit)],
          [t("totalValue"), money(fund.shareAssets)],
          [
            t("preparation"),
            fund.fees
              ? `${fund.fees.standardPayoutTermSeconds / 3600} ${t("hours")}`
              : t("unavailable"),
          ],
          [t("performanceFee"), pct(fund.fees?.performanceFeeBps)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl border border-border bg-surface p-5">
            <p className="break-words text-muted-foreground text-sm">{label}</p>
            <p className="break-words font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>
      <Disclosure title={t("about")}>
        <p className="break-words [overflow-wrap:anywhere]">
          {fund.profile?.description?.trim() || t("unavailable")}
        </p>
      </Disclosure>
      <Disclosure title={t("composition")}>
        <p>
          {coverage === null
            ? t("unavailable")
            : t("coverage", { percent: String(100 - coverage) })}
        </p>
        {positions.map((p) => (
          <div key={`${p.chainId}:${p.positionKey}`} className="border-border border-t py-3">
            <Row
              label={`${p.adapterKind} · ${p.tokens.map((token) => token.symbol).join(" / ")}`}
              value={
                p.currentValueUsd !== undefined && p.currentValueUsd !== null
                  ? formatUsdPrecise(Number(p.currentValueUsd))
                  : p.valueUsd !== null
                    ? formatUsdPrecise(Number(p.valueUsd))
                    : t("unavailable")
              }
            />
            <Row
              label={t("share")}
              value={
                p.shareOfNav === null ? t("unavailable") : formatPercent(Number(p.shareOfNav), 2)
              }
            />
          </div>
        ))}
      </Disclosure>
      <Disclosure title={t("mandate")}>
        <p>{t("scope")}</p>
        <Row
          label={fundText("chains")}
          value={fund.chains
            .map(
              (chain) =>
                `${chainName(chain.chainId)}${chain.status === "pending" ? ` (${fundText("pending")})` : ""}`,
            )
            .join(" · ")}
        />
        <Row
          label={t("allowed")}
          value={
            fund.mandate.tokens.length
              ? fund.mandate.tokens
                  .map(
                    (token) =>
                      `${tokenName(token.chainId, token.token)} (${chainName(token.chainId)})`,
                  )
                  .join(" · ")
              : t("unavailable")
          }
        />
        <Row
          label={fundText("protocols")}
          value={
            fund.mandate.adapters.length
              ? fund.mandate.adapters
                  .map(
                    (adapter) =>
                      `${protocolName(adapter.chainId, adapter.adapter)} (${chainName(adapter.chainId)})`,
                  )
                  .join(" · ")
              : t("unavailable")
          }
        />
        <Row label={fundText("limits")} value={t("unavailable")} />
      </Disclosure>
      <Disclosure title={t("fees")}>
        <Row label={t("deposit")} value={pct(fund.fees?.flowFeeBps)} />
        <Row label={t("management")} value={pct(fund.fees?.managementFeeBps)} />
        <Row label={t("faster")} value={pct(fund.fees?.payoutFeeBps)} />
        <Row label={t("networkCost")} value={t("unavailable")} />
      </Disclosure>
    </StrategyDetailFrame>
  );
}
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium tabular-nums">
        {value}
      </span>
    </div>
  );
}
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-border bg-surface p-5">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="mt-4 flex flex-col gap-3 text-sm">{children}</div>
    </details>
  );
}
