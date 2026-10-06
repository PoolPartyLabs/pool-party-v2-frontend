/**
 * @id PP-STR-MOD-001
 * @name FundInvestModal, typed V2 branch of the shared Invest host
 * @implements-rules-version v1 (POO-2248)
 * @analytics-events strategy_invest_started, strategy_invest_submitted, strategy_invest_completed,
 * strategy_invest_failed, tx_flow_abandoned, tx_amount_blocked, tx_signature_requested, tx_review_reached
 * PP-INTEGRATION-POINT: shared funding rail followed by the authenticated V2 deposit controller.
 */
"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import { FundTransactionRecord } from "@/features/funds/FundTransactionRecord";
import { fundErrorKey, rawAmount } from "@/features/funds/fundModel";
import { useFundInvest } from "@/features/funds/useFundInvest";
import { useRouter } from "@/i18n/navigation";
import { useTxAmountBlocked } from "@/lib/analytics/txFlowKit";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { formatUsd, formatUsdPrecise } from "@/lib/utils/format";
import { useProvisioningGate } from "../hooks/useProvisioningGate";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { AmountField, amountToText } from "./AmountField";
import type { FundInvestModalProps } from "./InvestModal";
import { ProvisioningPanel } from "./ProvisioningPanel";
import { StrategyMiniHeader } from "./StrategyMiniHeader";

export function FundInvestModal({
  open,
  onOpenChange,
  fund,
  balance,
  resumeAmount,
  walletAddress,
}: FundInvestModalProps) {
  const t = useTranslations("strategies");
  const fundText = useTranslations("strategies.funds");
  const router = useRouter();
  const { track } = useAnalytics();
  const onSettled = useCallback(() => router.refresh(), [router]);
  const controller = useFundInvest({ core: fund.core, enabled: open, onSettled });
  const [amountText, setAmountText] = useState("");
  const [funding, setFunding] = useState<{ owner: string; budget: string } | null>(null);
  const [fundingError, setFundingError] = useState(false);
  const snapshot = controller.snapshot;
  const verified =
    !!snapshot && !!walletAddress && snapshot.wallet.toLowerCase() === walletAddress.toLowerCase();
  const identity =
    open && verified ? `${fund.core.toLowerCase()}:${snapshot.wallet.toLowerCase()}` : null;
  const provisioning = funding !== null && funding.owner === identity;
  // Invalidate synchronously, including callbacks retained by a superseded funding panel.
  const liveFunding = useRef(funding);
  liveFunding.current = provisioning ? funding : null;
  useEffect(
    () => () => {
      liveFunding.current = null;
    },
    [],
  );
  const gate = useProvisioningGate({
    op: "invest",
    network: "arbitrum",
    enabled: open && verified,
    slippagePct: DEFAULT_SLIPPAGE_PCT,
    targetUsdcBalanceUsd: balance ?? undefined,
  });
  useEffect(() => {
    if (funding && funding.owner !== identity) {
      setFunding(null);
      gate.reset();
    }
  }, [funding, identity, gate.reset]);
  let budget: string | null = null;
  let balanceRaw: bigint | null = null;
  try {
    budget = rawAmount(amountText);
  } catch {
    /* Input remains editable until valid. */
  }
  try {
    if (balance !== null && Number.isFinite(balance) && balance >= 0)
      balanceRaw = balance === 0 ? BigInt("0") : BigInt(rawAmount(amountToText(balance, 6)));
  } catch {
    /* No trustworthy target balance. */
  }
  const minimumRaw = snapshot
    ? BigInt(snapshot.holder.shares) > BigInt("0")
      ? "0"
      : snapshot.fund.mandate.minFirstDeposit
    : fund.holderSharesRaw !== null
      ? BigInt(fund.holderSharesRaw) > BigInt("0")
        ? "0"
        : fund.minFirstDepositRaw
      : null;
  const belowMin = budget !== null && minimumRaw !== null && BigInt(budget) < BigInt(minimumRaw);
  const short = budget !== null && balanceRaw !== null && BigInt(budget) > balanceRaw;
  const amount = Number(amountText);
  const exactPlannerAmount =
    budget !== null && Number.isFinite(amount) && Number.isSafeInteger(Number(budget));
  const phase = controller.phase;
  const busy = gate.locked || phase === "building" || phase === "pending";
  const amountPhase =
    !provisioning && (phase === "idle" || phase === "loading" || (phase === "error" && !snapshot));
  const valid =
    verified &&
    snapshot.fund.state === "Open" &&
    budget !== null &&
    !belowMin &&
    minimumRaw !== null &&
    balanceRaw !== null &&
    exactPlannerAmount;
  const checking = phase === "loading" || gate.status === "loading";
  const concluded = useRef(false);
  const exit = useRef<"amount" | "building" | "review" | "pending" | "provision">("amount");
  exit.current = provisioning
    ? "provision"
    : phase === "unknown"
      ? "pending"
      : phase === "building" || phase === "review" || phase === "pending"
        ? phase
        : "amount";
  const previousPhase = useRef(phase);
  const completedHash = useRef<string | null>(null);

  useTxAmountBlocked(
    { flow: "invest", strategyId: fund.core },
    open && amountPhase && amountText
      ? belowMin
        ? "below_minimum"
        : !budget || !exactPlannerAmount
          ? "amount_invalid"
          : !verified
            ? "v2_execution_unavailable"
            : null
      : null,
  );

  useEffect(() => {
    if (!open) return;
    concluded.current = false;
    track("strategy_invest_started", { strategy_id: fund.core });
    if (resumeAmount && Number.isFinite(resumeAmount) && resumeAmount > 0)
      setAmountText(amountToText(resumeAmount, 6));
    return () => {
      if (!concluded.current)
        track("tx_flow_abandoned", {
          flow: "invest",
          strategy_id: fund.core,
          tx_exit: exit.current,
        });
    };
  }, [open, fund.core, resumeAmount, track]);

  useEffect(() => {
    if (!open || previousPhase.current === phase) return;
    previousPhase.current = phase;
    if (phase === "review") track("tx_review_reached", { flow: "invest", strategy_id: fund.core });
    if (phase === "pending")
      track("tx_signature_requested", {
        flow: "invest",
        strategy_id: fund.core,
        tx_step: controller.approvalRequired ? "approve" : "confirm",
      });
    if (phase === "error") {
      concluded.current = true;
      track("strategy_invest_failed", {
        strategy_id: fund.core,
        error_code: fundErrorKey(controller.errorCode ?? "V2_UNAVAILABLE"),
      });
    }
    const settled = controller.records.find(
      (r) => r.action === "deposit" && r.status === "confirmed",
    );
    if (phase === "success" && settled && completedHash.current !== settled.hash) {
      completedHash.current = settled.hash;
      concluded.current = true;
      // No value parameter: the receipt proves settlement, not the simulated charged amount.
      track("strategy_invest_completed", { strategy_id: fund.core });
    }
  }, [
    open,
    phase,
    controller.approvalRequired,
    controller.errorCode,
    controller.records,
    fund.core,
    track,
  ]);

  function close(next: boolean) {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      gate.reset();
      setFunding(null);
      setFundingError(false);
      controller.reset();
      setAmountText("");
    }
  }
  function prepare() {
    if (!valid || checking || !budget) return;
    setFundingError(false);
    concluded.current = false;
    if (gate.evaluate(amount) && identity) {
      setFunding({ owner: identity, budget });
      return;
    }
    if (short || gate.status === "unavailable") {
      setFundingError(true);
      return;
    }
    void controller.prepare(budget);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <TransactionModalHeader
          title={t(phase === "review" ? "invest.review.title" : "invest.title")}
        />
        <StrategyMiniHeader fund={fund} />
        {amountPhase ? (
          <div className="mt-2 flex flex-col gap-5">
            <p className="text-center text-muted-foreground text-sm">{t("invest.amountLabel")}</p>
            <AmountField
              value={amountText}
              onValueChange={setAmountText}
              increments={[50, 100, 250]}
              maxValue={balance}
              maxLabel={t("invest.max")}
              ariaLabel={t("invest.amountLabel")}
              maxFractionDigits={6}
            />
            {balance === null ? (
              <p className="text-center text-sm">{t("investV2.balanceUnavailable")}</p>
            ) : (
              <button
                type="button"
                className="mx-auto text-muted-foreground text-sm tabular-nums"
                onClick={() => setAmountText(amountToText(balance, 6))}
              >
                {t("invest.balance", { amount: formatUsdPrecise(balance) })}
              </button>
            )}
            {belowMin && minimumRaw !== null ? (
              <p className="rounded-md bg-warning/10 p-3 text-center text-warning text-sm">
                {t("invest.belowMin", {
                  min: formatUsd(Number(formatUnits(BigInt(minimumRaw), 6))),
                })}
              </p>
            ) : short && budget && balanceRaw !== null ? (
              <p className="rounded-md bg-warning/10 p-3 text-center text-warning text-sm">
                {t("invest.needMore", {
                  amount: formatUsdPrecise(Number(formatUnits(BigInt(budget) - balanceRaw, 6))),
                })}
              </p>
            ) : null}
            <p className="text-center text-muted-foreground text-sm">{t("investV2.target")}</p>
            {!verified && !checking ? (
              <p role="status" className="text-sm">
                {controller.errorCode && controller.errorCode !== "V2_SESSION"
                  ? fundText(fundErrorKey(controller.errorCode))
                  : t("investV2.sessionRequired")}
              </p>
            ) : null}
            {fundingError ? (
              <p role="alert" className="text-sm">
                {t("investV2.fundingUnavailable")}
              </p>
            ) : null}
            <Button className="w-full" size="lg" disabled={!valid || checking} onClick={prepare}>
              {checking
                ? t("invest.cta.checking")
                : short
                  ? t("invest.cta.deposit")
                  : t("invest.cta.invest")}
            </Button>
            {controller.errorCode ? (
              <Button variant="secondary" onClick={() => void controller.refresh()}>
                {t("funds.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {provisioning && funding && gate.input ? (
          <ProvisioningPanel
            input={gate.input}
            context={gate.context}
            operation={{ kind: "invest", strategyId: fund.core }}
            opLabel={t("provisioning.opLabel.invest", { strategy: fund.name })}
            onLockChange={(locked) => {
              if (liveFunding.current === funding) gate.setLocked(locked);
            }}
            onCancel={() => {
              if (liveFunding.current !== funding) return;
              liveFunding.current = null;
              gate.setLocked(false);
              setFunding(null);
            }}
            onDone={() => {
              if (liveFunding.current !== funding) return;
              liveFunding.current = null;
              gate.setLocked(false);
              setFunding(null);
              void controller.prepare(funding.budget);
            }}
          />
        ) : null}
        {!provisioning && phase === "review" ? (
          <div className="space-y-4">
            {controller.approvalRequired ? (
              <div className="space-y-3">
                <p>{t("investV2.approvalReview")}</p>
                <p className="tabular-nums">
                  {t("invest.amountLabel")}: {formatUnits(BigInt(controller.amountRaw || "0"), 6)}{" "}
                  USDC
                </p>
              </div>
            ) : controller.preview ? (
              <>
                <p className="text-muted-foreground text-sm">{t("investV2.protectedShares")}</p>
                <dl className="space-y-3 rounded-lg border border-border p-4 text-sm">
                  {(
                    [
                      ["funds.shares", controller.preview.sharesMinted, 18, ""],
                      ["funds.charged", controller.preview.usdcCharged, 6, " USDC"],
                      ["funds.flowFee", controller.preview.flowFee, 6, " USDC"],
                      ["funds.refund", controller.preview.refundToCaller, 6, " USDC"],
                      ["funds.sharePrice", controller.preview.sharePrice, 24, " USDC"],
                    ] as const
                  ).map(([label, value, decimals, symbol]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <dt>{t(label)}</dt>
                      <dd className="break-all text-right tabular-nums">
                        {formatUnits(BigInt(value), decimals)}
                        {symbol}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-muted-foreground text-xs">{t("investV2.networkCost")}</p>
              </>
            ) : (
              <p>{t("investV2.notAvailable")}</p>
            )}
            {controller.errorCode ? (
              <p role="alert">{fundText(fundErrorKey(controller.errorCode))}</p>
            ) : null}
            <Button
              className="w-full"
              disabled={!controller.approvalRequired && !controller.preview}
              onClick={() => {
                concluded.current = false;
                if (!controller.approvalRequired)
                  track("strategy_invest_submitted", { strategy_id: fund.core });
                void controller.confirm();
              }}
            >
              {controller.approvalRequired ? t("funds.approve") : t("invest.review.cta")}
            </Button>
            <Button className="w-full" variant="secondary" onClick={() => controller.reset()}>
              {t("invest.confirm.back")}
            </Button>
          </div>
        ) : null}
        {!provisioning && (phase === "building" || phase === "pending") ? (
          <p role="status">
            {t(phase === "pending" ? "funds.confirmPrompt" : "investV2.preparing")}
          </p>
        ) : null}
        {!provisioning && phase === "unknown" ? (
          <div className="space-y-4">
            <p role="status">{t("investV2.recoveryPending")}</p>
            <Button className="w-full" onClick={() => void controller.reconcile()}>
              {t("investV2.checkTransaction")}
            </Button>
          </div>
        ) : null}
        {!provisioning && phase === "error" && snapshot ? (
          <div className="space-y-4">
            <p role="alert">{fundText(fundErrorKey(controller.errorCode ?? "V2_UNAVAILABLE"))}</p>
            <Button
              className="w-full"
              onClick={() => {
                controller.reset();
                setFundingError(false);
              }}
            >
              {t("invest.confirm.back")}
            </Button>
          </div>
        ) : null}
        {!provisioning && phase === "success" ? (
          <div className="space-y-4">
            <p role="status">{t("funds.success")}</p>
            <Button
              className="w-full"
              onClick={() => {
                close(false);
                router.refresh();
              }}
            >
              {t("flow.viewPosition")}
            </Button>
          </div>
        ) : null}
        {controller.records.length > 0 ? (
          <div aria-live="polite" className="space-y-3 rounded-lg border border-border p-3">
            {controller.records.map((record) => (
              <FundTransactionRecord key={record.hash} record={record} />
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
