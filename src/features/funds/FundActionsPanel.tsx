/**
 * @id PP-STR-CMP-032 (POO-2175)
 * @name FundActionsPanel
 * @implements-rules-version v2 (POO-2175); v1 (POO-2179 explorer records)
 * Investor confirmation, authoritative previews and wallet receipt flow.
 */
"use client";
import { useWallets } from "@privy-io/react-auth";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatUnits } from "viem";
import { Toaster } from "@/components/ui/Toast";
import type { FundBuild, FundHolder, FundView } from "@/lib/api/v2/fundSchemas";
import { isMockMode } from "@/lib/services";
import { findWalletForAddress } from "@/lib/tx/sendTransaction";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import { ExplorerFields } from "./ExplorerFields";
import { FundTransactionRecord } from "./FundTransactionRecord";
import {
  buildFundAction,
  type FundIntent,
  loadFundAction,
  pollFundReportAction,
  startFundReportAction,
} from "./fundActions";
import { approveAndRebuild, ensureFreshValuation } from "./fundFlow";
import { estimateDeposit, fundErrorKey, rawAmount } from "./fundModel";
import {
  fundTransactionCode,
  sendFundTransaction,
  type FundTransactionRecord as TransactionRecord,
} from "./fundTransactions";
export interface FundActionsPanelProps {
  fund: FundView;
  holder: FundHolder;
  wallet: string;
  refresh: () => void;
}
export function FundActionsPanel(props: FundActionsPanelProps) {
  return isMockMode ? (
    <InvestorActions {...props} send={async () => {}} />
  ) : (
    <WalletInvestorActions {...props} />
  );
}
function WalletInvestorActions(props: FundActionsPanelProps) {
  const { wallets } = useWallets();
  return (
    <InvestorActions
      {...props}
      send={async (built, active, action, observe) => {
        if (!active()) throw new Error("V2_CANCELED");
        const wallet = findWalletForAddress(wallets, props.wallet);
        if (!wallet) throw new Error("V2_SESSION");
        await wallet.switchChain(42161);
        if (!active()) throw new Error("V2_CANCELED");
        const provider = await wallet.getEthereumProvider();
        if (!active()) throw new Error("V2_CANCELED");
        for (const tx of built.transactions) {
          if (!active()) throw new Error("V2_CANCELED");
          await sendFundTransaction(provider, tx, props.wallet, action, observe);
        }
      }}
    />
  );
}
function InvestorActions({
  fund,
  holder,
  wallet,
  refresh,
  send,
}: FundActionsPanelProps & {
  send: (
    built: FundBuild,
    active: () => boolean,
    action: string,
    observe: (record: TransactionRecord) => void,
  ) => Promise<void>;
}) {
  const t = useTranslations("strategies.funds");
  const [amount, setAmount] = useState("");
  const [minShares, setMinShares] = useState("1");
  const [loss, setLoss] = useState("100");
  const [intent, setIntent] = useState<FundIntent | null>(null);
  const [built, setBuilt] = useState<FundBuild | null>(null);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [reports, setReports] = useState<Record<string, unknown>[]>([]);
  const toastIds = useRef(new Set<string>());
  const toasterId = `fund-actions:${fund.coreVault}:${wallet}`;
  const identityRun = useRef(0);
  const run = useRef(0);
  const busy = phase === "building" || phase === "refreshing" || phase === "sending";
  useEffect(() => {
    const identity = `${fund.coreVault}:${wallet}`;
    if (!identity) return;
    run.current += 1;
    identityRun.current += 1;
    setTransactions([]);
    setReports([]);
    setBuilt(null);
    setIntent(null);
    setPhase("idle");
    return () => {
      run.current += 1;
      identityRun.current += 1;
      for (const id of toastIds.current) toast.dismiss(id);
      toastIds.current.clear();
    };
  }, [fund.coreVault, wallet]);
  useEffect(() => {
    const input = `${amount}:${minShares}:${loss}`;
    if (!input) return;
    run.current += 1;
    setBuilt(null);
    setIntent(null);
    setPhase("idle");
  }, [amount, minShares, loss]);
  async function fresh(active: () => boolean) {
    return ensureFreshValuation({
      active,
      refreshing: () => setPhase("refreshing"),
      wait: () => new Promise((resolve) => setTimeout(resolve, isMockMode ? 10 : 15_000)),
      read: async () => {
        const result = await loadFundAction(fund.coreVault);
        if (!result.ok) throw new Error(result.error.code);
        return result.data.fund;
      },
      start: async () => {
        const result = await startFundReportAction(fund.coreVault);
        if (!result.ok) throw new Error(result.error.code);
        if (active())
          setReports((previous) => [
            ...previous.filter((job) => job.jobId !== result.data.jobId),
            { jobId: result.data.jobId, status: "pending" },
          ]);
        return result.data.jobId;
      },
      poll: async (job) => {
        const result = await pollFundReportAction(fund.coreVault, job);
        if (!result.ok) throw new Error(result.error.code);
        if (active())
          setReports((previous) =>
            previous.map((entry) =>
              entry.jobId === job
                ? {
                    jobId: job,
                    status: result.data.status,
                    ...(typeof result.data.publishTxHash === "string"
                      ? { publishTxHash: result.data.publishTxHash }
                      : {}),
                    ...(typeof result.data.deliveryTxHash === "string"
                      ? { deliveryTxHash: result.data.deliveryTxHash }
                      : {}),
                  }
                : entry,
            ),
          );
        return result.data.status;
      },
    });
  }
  async function build(input: FundIntent, active: () => boolean) {
    if (
      input.action !== "exit-closed-fund" &&
      input.action !== "settle-income-withdrawal" &&
      input.action !== "request-income-withdrawal"
    )
      await fresh(active);
    if (!active()) throw new Error("V2_CANCELED");
    setPhase("building");
    const result = await buildFundAction(fund.coreVault, input);
    if (!result.ok) throw new Error(result.error.code);
    return result.data;
  }
  async function prepare(action: FundIntent["action"], mode?: "Instant" | "Standard") {
    const id = ++run.current;
    const active = () => run.current === id;
    setError(null);
    setBuilt(null);
    setPhase("building");
    try {
      const input: FundIntent = { action, maxLossBps: Number(loss), ...(mode ? { mode } : {}) };
      if (!/^\d{1,5}$/.test(loss) || Number(loss) > 10_000) throw new Error("V2_INVALID_AMOUNT");
      if (action === "deposit" || action === "request-payout") input.amount = rawAmount(amount);
      if (action === "deposit") {
        if (!/^\d{1,60}$/.test(minShares)) throw new Error("V2_INVALID_AMOUNT");
        input.minShares = (BigInt(minShares) * BigInt("1000000000000000000")).toString();
        if (
          BigInt(holder.shares) === BigInt(0) &&
          BigInt(input.amount ?? "0") < BigInt(fund.mandate.minFirstDeposit)
        )
          throw new Error("BelowMinFirstDeposit");
      }
      const result = await build(input, active);
      if (!active()) return;
      setIntent(input);
      setBuilt(result);
      setPhase("review");
    } catch (failure) {
      if (active()) {
        setError(fundErrorKey(failure instanceof Error ? failure.message : "V2_UNAVAILABLE"));
        setPhase("idle");
      }
    }
  }
  async function confirm() {
    if (!built || !intent || busy) return;
    const id = ++run.current;
    const active = () => run.current === id;
    setError(null);
    setPhase("sending");
    const identity = identityRun.current;
    const observe = (record: TransactionRecord) => {
      if (identity !== identityRun.current) return;
      setTransactions((previous) => {
        const index = previous.findIndex(
          (entry) => entry.chainId === record.chainId && entry.hash === record.hash,
        );
        return index < 0
          ? [...previous, record]
          : previous.map((entry, offset) => (offset === index ? record : entry));
      });
      const toastId = `${fund.coreVault}:${wallet}:${record.chainId}:${record.hash}`;
      toastIds.current.add(toastId);
      toast(<FundTransactionRecord record={record} />, {
        id: toastId,
        toasterId,
        duration: record.status === "pending" ? Infinity : 10_000,
      });
    };
    try {
      if (built.nextAction) {
        const next = await approveAndRebuild(
          built,
          async (transaction) => {
            await send(transaction, active, "approve", observe);
            if (active()) setBuilt(null);
          },
          () => build(intent, active),
          active,
        );
        if (!active()) return;
        setBuilt(next);
        setPhase("review");
        return;
      }
      const latest = await build(intent, active);
      if (!active()) return;
      if (latest.nextAction || JSON.stringify(latest.preview) !== JSON.stringify(built.preview)) {
        setBuilt(latest);
        setPhase("review");
        return;
      }
      setPhase("sending");
      const action =
        intent.action === "request-payout"
          ? intent.mode === "Instant"
            ? "instant"
            : "standard"
          : (
              {
                deposit: "deposit",
                "claim-payout": "claim",
                "request-income-withdrawal": "withdrawIncome",
                "settle-income-withdrawal": "settleIncome",
                "exit-closed-fund": "exit",
              } as const
            )[intent.action];
      await send(latest, active, action, observe);
      if (!active()) return;
      setBuilt(null);
      setPhase("success");
      refresh();
    } catch (failure) {
      if (active()) {
        const code = fundTransactionCode(failure);
        setError(fundErrorKey(code));
        if (code === "TX_CONFIRMATION_UNKNOWN") setBuilt(null);
        setPhase("review");
      }
    }
  }
  let estimate: ReturnType<typeof estimateDeposit> | null = null;
  try {
    if (amount)
      estimate = estimateDeposit(rawAmount(amount), fund.sharePrice, fund.fees?.flowFeeBps ?? 25);
  } catch {}
  const preview = built?.preview;
  const display = preview ?? (intent?.action === "deposit" || !intent ? estimate : null);
  const fields = [
    { key: "sharesMinted", label: t("shares"), decimals: 18 },
    { key: "usdcCharged", label: t("charged"), decimals: 6 },
    { key: "flowFee", label: t("flowFee"), decimals: 6 },
    { key: "refundToCaller", label: t("refund"), decimals: 6 },
    { key: "usdcGross", label: t("gross"), decimals: 6 },
    { key: "payoutFee", label: t("payoutFee"), decimals: 6 },
    { key: "usdcPaid", label: t("paid"), decimals: 6 },
    { key: "sharesBurned", label: t("shares"), decimals: 18 },
    { key: "usdcRequested", label: t("amount"), decimals: 6 },
    { key: "usdcOutstanding", label: t("pendingPayout"), decimals: 6 },
    { key: "marketCost", label: t("payoutFee"), decimals: 6 },
    { key: "sharePrice", label: t("sharePrice"), decimals: 24 },
    { key: "shareAssets", label: t("nav"), decimals: 6 },
  ];
  return (
    <section className="rounded-xl border border-border p-5 space-y-4">
      <Toaster id={toasterId} />
      <h2 className="font-semibold">{t("actions")}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          {t("amount")}
          <input
            className="w-full rounded border p-2"
            inputMode="decimal"
            value={amount}
            disabled={busy}
            onChange={(event) =>
              setAmount(sanitizeNumericInput(event.target.value, { maxDecimals: 6 }))
            }
          />
        </label>
        <label>
          {t("minShares")}
          <input
            className="w-full rounded border p-2"
            inputMode="numeric"
            value={minShares}
            disabled={busy}
            onChange={(event) =>
              setMinShares(sanitizeNumericInput(event.target.value, { maxDecimals: 0 }))
            }
          />
        </label>
        <label>
          {t("maxLoss")}
          <input
            className="w-full rounded border p-2"
            inputMode="numeric"
            value={loss}
            disabled={busy}
            onChange={(event) =>
              setLoss(sanitizeNumericInput(event.target.value, { maxDecimals: 0 }))
            }
          />
        </label>
      </div>
      <p>
        {t("minimum")}: {formatUnits(BigInt(fund.mandate.minFirstDeposit), 6)} USDC
      </p>
      <p>{t("standardTerm")}</p>
      <p>
        {t("payoutFee")}: {(fund.fees?.payoutFeeBps ?? fund.mandate.payoutFeeBps) / 100}%
      </p>
      <div className="flex flex-wrap gap-2">
        {fund.state === "Open" ? (
          <>
            <button type="button" disabled={busy} onClick={() => void prepare("deposit")}>
              {t("deposit")}
            </button>
            <button
              type="button"
              disabled={busy || holder.payout.open}
              onClick={() => void prepare("request-payout", "Instant")}
            >
              {t("instant")}
            </button>
            <button
              type="button"
              disabled={busy || holder.payout.open}
              onClick={() => void prepare("request-payout", "Standard")}
            >
              {t("standard")}
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={busy || !holder.claimable}
          onClick={() => void prepare("claim-payout")}
        >
          {t("claim")}
        </button>
        <button
          type="button"
          disabled={busy || BigInt(holder.incomeOwed) === BigInt(0)}
          onClick={() => void prepare("request-income-withdrawal")}
        >
          {t("withdrawIncome")}
        </button>
        <button
          type="button"
          disabled={busy || !holder.incomeWithdrawal[1]}
          onClick={() => void prepare("settle-income-withdrawal")}
        >
          {t("settleIncome")}
        </button>
        {fund.state === "Closed" ? (
          <button type="button" disabled={busy} onClick={() => void prepare("exit-closed-fund")}>
            {t("exit")}
          </button>
        ) : null}
      </div>
      {display ? (
        <div aria-live="polite">
          <h3>{preview ? t("authoritative") : t("estimate")}</h3>
          <dl>
            {fields.map((field) => {
              const value = (display as Record<string, unknown>)[field.key];
              return typeof value === "string" ? (
                <div className="flex justify-between gap-3" key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{formatUnits(BigInt(value), field.decimals)}</dd>
                </div>
              ) : null;
            })}
          </dl>
          {preview ? (
            <dl>
              {Object.entries(preview)
                .filter(
                  ([key]) =>
                    key !== "protocolVersion" && !fields.some((field) => field.key === key),
                )
                .map(([key, value]) => (
                  <div className="flex justify-between gap-3 break-all" key={key}>
                    <dt>{t("value")}</dt>
                    <dd>
                      {typeof value === "boolean" ? (
                        value ? (
                          t("ready")
                        ) : (
                          t("notReady")
                        )
                      ) : typeof value === "string" || typeof value === "number" ? (
                        <ExplorerFields
                          value={value}
                          field={key}
                          chainId={Number(fund.mandate.hubChainId)}
                        />
                      ) : (
                        t("unavailable")
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </div>
      ) : null}
      {built ? (
        <div>
          <p>{built.nextAction ? t("approveFirst") : t("confirmPrompt")}</p>
          <button type="button" disabled={busy} onClick={() => void confirm()}>
            {built.nextAction ? t("approve") : t("confirm")}
          </button>
        </div>
      ) : null}
      {phase !== "idle" && phase !== "review" ? (
        <p role="status">
          {phase === "refreshing"
            ? t("refreshing")
            : phase === "success"
              ? t("success")
              : t("loading")}
        </p>
      ) : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {reports.length > 0 ? (
        <section aria-live="polite" aria-label={t("report")}>
          <h3>{t("report")}</h3>
          <ExplorerFields
            value={reports}
            chainByField={{
              publishTxHash:
                fund.mandate.spokes.length === 1
                  ? Number(fund.mandate.spokes[0]?.chainId)
                  : undefined,
              deliveryTxHash: Number(fund.mandate.hubChainId),
            }}
          />
        </section>
      ) : null}
      {transactions.length > 0 ? (
        <section
          aria-live="polite"
          aria-label={t("transactions")}
          className="space-y-3 rounded-xl border border-border p-4"
        >
          <h3>{t("transactions")}</h3>
          {transactions.map((record) => (
            <FundTransactionRecord key={`${record.chainId}:${record.hash}`} record={record} />
          ))}
        </section>
      ) : null}
    </section>
  );
}
