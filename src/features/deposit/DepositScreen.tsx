/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow
 * @implements-rules-version v4 (POO-727/728/729 rules v1)
 *
 * The on-ramp as a single responsive wizard (one /deposit page, client state machine) rather than
 * separate routes, so the entered amount/method never get lost between steps.
 *
 * Fiat path (Paybis): amount → payment-method dialog → review (the ONLY step that shows fees) →
 * success. Crypto path (Carlos): receive (address + QR, USDC-only, chosen network). POO-604: there is
 * NO on-chain watcher / deposit webhook in production (and none planned for now), so the standalone
 * crypto path is TERMINAL at receive — it shows the address and never claims a "detected" state we
 * cannot observe. The manual "I've sent the funds" confirm (→ waiting → success) is shown ONLY under
 * the "Deposit & invest" context, where it is the trigger to RESUME the invest flow without a webhook
 * (real resume wiring: POO-605). Every deposit is RECEIVED-fixed (POO-729): the entered amount is the
 * USDC you receive and the Paybis fee is added ON TOP of "You pay". The amount is bounded to
 * $10 to $200,000 (POO-727), and the crypto network picker opens with Arbitrum pre-selected (POO-728) so
 * Continue is enabled on open. The output is USDC (~1:1 minus fees); the custom keypad
 * drives entry on mobile while desktop types. Supports the "Deposit & invest" top-up context (pre-fill
 * + banner + route back to the strategy on success), hardened per POO-494: the banner degrades to a
 * name-less variant when the strategy lookup misses, the review blocks confirm below the shortfall,
 * and the crypto path honors the top-up context too. POO-520: a manager-console origin returns the
 * resume to /manager?manage=<id>&invest=<amount> (the manage view re-arms the invest modal there);
 * investor-originated flows keep the strategy-detail return.
 *
 * PP-INTEGRATION-POINT: the fiat confirm hands off to Paybis hosted checkout. The crypto path has no
 * chain-watching seam (removed with POO-604); the invest-context "I've sent the funds" confirm is a
 * user-driven resume trigger, mocked here as a timed success (real balance-check wiring: POO-605).
 */
"use client";

import { ArrowRight, Check, ChevronLeft, Copy, Loader2, Lock, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { useAuth } from "@/lib/auth/useAuth";
import { formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { applyKeypadKey, sanitizeNumericInput } from "@/lib/utils/numericInput";
import { getDepositAddress } from "@/lib/wallet/getDepositAddress";
import { AmountKeypad } from "./components/AmountKeypad";
import { NetworkPickerDialog } from "./components/NetworkPickerDialog";
import { type PaymentMethod, PaymentMethodDialog } from "./components/PaymentMethodDialog";
import { QrBlock } from "./components/QrBlock";
import { DEFAULT_DEPOSIT_NETWORK, type DepositNetwork } from "./lib/depositNetworks";
import { computeDepositQuote } from "./lib/depositQuote";

/**
 * Paybis' published fee model (paybis.com/blog/crypto-fees-explanation, checked 2026-07-02): a 1.49%
 * service fee with a $2.00 minimum (FX included) plus the payment provider's processing fee. The
 * card / Apple Pay processing rate is derived from Paybis' own $5,000 example (~139 USDC card-vs-bank
 * difference ≈ 2.78%); bank (SEPA/ACH) and Pix settle without a provider fee. The first-card-purchase
 * service-fee waiver is not modeled (stateful). POO-494 R3.
 * PP-INTEGRATION-POINT: replaced by the Paybis hosted-checkout quote when the ramp is wired. The
 * received-fixed deposit maps to the `amountTo` quote direction (POO-281 R6, POO-729).
 */
const SERVICE_RATE = 0.0149;
const SERVICE_MIN_USD = 2;
const PROCESSING_RATES: Record<PaymentMethod, number> = {
  pix: 0,
  card: 0.0278,
  applePay: 0.0278,
  bank: 0,
};
/** Mock USDC amount confirmed on the invest-context crypto resume (POO-604: no real detection). */
const CRYPTO_RECEIVED = 100;
/** App minimum fiat deposit (USD), on the received/entered amount (POO-727). */
const MIN_DEPOSIT = 10;
/** App maximum fiat deposit (USD), on the received/entered amount (POO-727). Above this the ramp /
 * KYC path differs; the real min/max come from the Paybis quote once wired (this is the app-side cap). */
const MAX_DEPOSIT = 200_000;

/** Flow steps. */
type Step =
  | "amount"
  | "review"
  | "success"
  | "crypto-receive"
  | "crypto-waiting"
  | "crypto-success";

/** Round to cents, drop trailing zeros, as a raw string. */
function toText(value: number): string {
  return String(Number(value.toFixed(2)));
}
/** Format a plain number with up to 2 decimals (no currency symbol). */
function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

/** A label/value breakdown row. */
function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        {label}
        {sub ? <span className="ml-1 text-muted-foreground/70 text-xs">({sub})</span> : null}
      </span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

/** The invest-top-up context passed from "Deposit & invest". */
export interface DepositInvestContext {
  /** Strategy id to return to after a successful top-up. */
  strategyId: string;
  /** Strategy display name for the banner; null when the lookup missed (POO-494 R1) — the banner
   * then falls back to name-less copy, never fabricated data. */
  strategyName: string | null;
  /** Shortfall pre-filled into the amount. */
  shortfall: number;
  /** The full amount the investor is committing — deep-links "Invest now" back to Invest's Confirm
   * step (?invest=) so they don't retype it on return (POO-281 R3). */
  investAmount?: number;
  /** Launch surface (POO-520): "manager" returns the resume to the console manage view
   * (/manager?manage=<id>&invest=<amount>); absent/"investor" keeps the strategy-detail return. */
  origin?: "investor" | "manager";
}

/** Public props for {@link DepositScreen}. */
export interface DepositScreenProps {
  /** Optional invest-top-up context (pre-fills the amount + shows a banner + reroutes on success). */
  investContext?: DepositInvestContext | null;
  /** Whether the crypto-deposit (receive USDC to address) path is offered. Hidden for external wallets. */
  cryptoDepositAvailable?: boolean;
  /** Start directly on the crypto-receive step (deep link from the wallet modal's Receive action). */
  initialCrypto?: boolean;
}

/** The deposit on-ramp wizard. */
export function DepositScreen({
  investContext,
  cryptoDepositAvailable = true,
  initialCrypto = false,
}: DepositScreenProps) {
  const t = useTranslations("deposit");
  const { track } = useAnalytics();
  useTrackView("deposit_started");
  // The crypto-receive address is the user's CONNECTED wallet (same source as the top-right chip),
  // checksummed for display. Null when no wallet is connected (guarded in the receive step);
  // `walletLoading` covers the real-mode Privy/wagmi handshake so we don't flash the empty state.
  const { address, isLoading: walletLoading } = useAuth();
  const connectedAddress = address ? getDepositAddress(address) : null;
  // Deep link (wallet modal "Receive") opens straight on the crypto-receive step when available.
  const [step, setStep] = useState<Step>(
    initialCrypto && cryptoDepositAvailable ? "crypto-receive" : "amount",
  );
  const [amountText, setAmountText] = useState(
    investContext && investContext.shortfall > 0 ? toText(investContext.shortfall) : "100",
  );
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [methodOpen, setMethodOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [completedAt, setCompletedAt] = useState("");
  // Crypto deposit: the picker opens with Arbitrum pre-selected (POO-728, DEFAULT_DEPOSIT_NETWORK) so
  // Continue is enabled on open; the user can still switch. The address is identical across networks;
  // the choice only drives which network the loss-of-funds warning names. The picker still opens on
  // entry (and on the wallet-modal "Receive" deep link) so the send-network stays explicit.
  const [network, setNetwork] = useState<DepositNetwork>(DEFAULT_DEPOSIT_NETWORK);
  const [networkOpen, setNetworkOpen] = useState(initialCrypto && cryptoDepositAvailable);

  const amount = Number.parseFloat(amountText) || 0;
  // Every deposit is RECEIVED-fixed (POO-729): the amount field is the USDC you RECEIVE, so the Paybis
  // fee is added ON TOP and the charged amount rounds up to the cent (POO-494 R4). This makes the direct
  // deposit uniform with the invest top-up (already received-fixed) and with the amount-step "≈ USDC"
  // preview, so "You'll receive" always equals the entered amount.
  // Fee math runs in Decimal (number-formatting skill §1); convert to number only at the display /
  // analytics edge below (formatUsd / track), never as an intermediate amount.
  const quote = computeDepositQuote(
    amount,
    {
      serviceRate: SERVICE_RATE,
      serviceMin: SERVICE_MIN_USD,
      processingRate: PROCESSING_RATES[method],
    },
    true,
  );
  const charged = quote.charged.toNumber();
  const net = quote.net.toNumber();
  const fee = quote.fee.toNumber();
  // The effective rate the user actually pays (service + processing over the charged amount), shown
  // next to the fee row — honest per-quote information instead of a static per-method label.
  const feePct = charged > 0 ? `${((fee / charged) * 100).toFixed(2)}%` : "0.00%";
  const shortfall = investContext?.shortfall ?? 0;
  // POO-494 R4 guard: the review blocks confirm while the entered amount is below the shortfall the
  // investment needs (otherwise the user returns to Invest still short). Only meaningful under the
  // invest top-up context, where shortfall > 0.
  const belowNeed = shortfall > 0 && amount < shortfall;
  // POO-494 R5: the crypto path honors the top-up context — the mock detection credits the
  // shortfall (rounded to cents) instead of the generic fixture amount.
  const cryptoReceived = shortfall > 0 ? Number(shortfall.toFixed(2)) : CRYPTO_RECEIVED;
  const methodNames: Record<PaymentMethod, string> = {
    pix: t("method.pix.name"),
    card: t("method.card.name"),
    applePay: t("method.applePay.name"),
    bank: t("method.bank.name"),
  };
  // On success, "Invest now" returns to where the flow ORIGINATED, with ?invest=<amount> when we
  // know the full committed amount, so Invest reopens at Confirm & sign instead of the amount step
  // (POO-281 R3). A manager-console origin returns to that strategy's manage view, where the
  // add-liquidity modal re-arms from the same param (POO-520 R1); the investor origin keeps the
  // strategy-detail return (POO-520 R2).
  const hasInvestAmount = Boolean(investContext?.investAmount && investContext.investAmount > 0);
  const investHref = investContext
    ? investContext.origin === "manager"
      ? hasInvestAmount
        ? `/manager?manage=${investContext.strategyId}&invest=${investContext.investAmount}`
        : `/manager?manage=${investContext.strategyId}`
      : hasInvestAmount
        ? `/strategies/${investContext.strategyId}?invest=${investContext.investAmount}`
        : `/strategies/${investContext.strategyId}`
    : "/strategies";
  // The top-up banner, shared by the fiat amount step and the crypto path (POO-494 R5). Name-less
  // fallback copy when the strategy lookup missed (POO-494 R1): never fabricate data in real mode.
  const investBanner =
    investContext && investContext.shortfall > 0 ? (
      <p className="rounded-lg bg-risk-2/10 px-3 py-2 text-center text-risk-2 text-sm">
        {investContext.strategyName
          ? t("investContext", {
              name: investContext.strategyName,
              amount: formatUsd(investContext.shortfall),
            })
          : t("investContextGeneric", { amount: formatUsd(investContext.shortfall) })}
      </p>
    ) : null;

  // Crypto path: auto-detect the deposit after a short delay (mock for on-chain watching).
  useEffect(() => {
    if (step !== "crypto-waiting") return;
    const timer = setTimeout(() => {
      setCompletedAt(new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date()));
      setStep("crypto-success");
      track("deposit_crypto_completed", {
        token_symbol: "USDC",
        token_amount: cryptoReceived,
        usd_value_at_time: cryptoReceived,
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [step, track, cryptoReceived]);

  /** Open the crypto-transfer path from the amount step (fires deposit_crypto_started once). The
   * network picker opens with Arbitrum pre-selected (POO-728); the user can still switch. */
  function openCrypto() {
    track("deposit_crypto_started");
    setNetwork(DEFAULT_DEPOSIT_NETWORK);
    setNetworkOpen(true);
    setStep("crypto-receive");
  }

  function applyKey(key: string) {
    setAmountText((prev) => applyKeypadKey(prev, key, { maxDecimals: 2 }));
  }

  function confirmFiat() {
    track("deposit_submitted", { deposit_method: method, value: charged });
    // PP-INTEGRATION-POINT: Paybis hosted-checkout handoff — the card / Pix form and the
    // first-deposit KYC happen on Paybis, not in-app. Mocked here as a direct success. The real
    // flow moves deposit_completed to the confirmed return from Paybis (and adds deposit_failed).
    setCompletedAt(new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date()));
    setStep("success");
    track("deposit_completed", {
      deposit_method: method,
      value: charged,
      currency: "USD",
      usd_value_at_time: charged,
    });
  }

  function copyAddress() {
    if (!connectedAddress) return;
    navigator.clipboard?.writeText(connectedAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function shareAddress() {
    if (!connectedAddress) return;
    if (typeof navigator.share === "function") {
      navigator.share({ text: connectedAddress }).catch(() => {});
      return;
    }
    copyAddress();
  }

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 ${step === "amount" ? "max-w-md lg:max-w-4xl" : "max-w-md"}`}
    >
      {/* ── Amount ───────────────────────────────────────────────────────── */}
      {step === "amount" ? (
        <div className="lg:grid lg:grid-cols-[1fr_19rem] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-bold text-2xl text-foreground">{t("title")}</h1>
              {cryptoDepositAvailable ? (
                <button
                  type="button"
                  onClick={openCrypto}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 font-medium text-primary text-sm transition-colors hover:bg-primary/15 lg:hidden"
                >
                  {t("cryptoPill")}
                </button>
              ) : null}
            </div>

            {investBanner}

            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-muted-foreground text-sm">{t("addLabel")}</p>
              {/* Mobile: static display driven by the keypad */}
              <p className="flex items-center font-bold text-5xl text-foreground lg:hidden">
                <span>$</span>
                <span>{amountText || "0"}</span>
              </p>
              {/* Desktop: typed input */}
              <div className="hidden items-center justify-center font-bold text-5xl text-foreground lg:flex">
                <span>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t("addLabel")}
                  value={amountText}
                  onChange={(event) =>
                    setAmountText(sanitizeNumericInput(event.target.value, { maxDecimals: 2 }))
                  }
                  className="w-48 bg-transparent text-center outline-none placeholder:text-muted-foreground"
                  placeholder="0"
                />
              </div>
              <p className="text-success text-sm">
                {t("receiveEstimate", { amount: formatNumber(amount) })}
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              {[50, 100, 250, 500].map((inc) => (
                <button
                  key={inc}
                  type="button"
                  onClick={() => setAmountText(toText(amount + inc))}
                  className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  +{formatUsd(inc)}
                </button>
              ))}
            </div>

            <AmountKeypad className="lg:hidden" onKey={applyKey} />

            <div className="flex flex-col gap-3">
              {amount < MIN_DEPOSIT ? (
                <p className="text-center text-sm text-warning">
                  {t("minHint", { min: formatUsd(MIN_DEPOSIT) })}
                </p>
              ) : amount > MAX_DEPOSIT ? (
                <p className="text-center text-sm text-warning">
                  {t("maxHint", { max: formatUsd(MAX_DEPOSIT) })}
                </p>
              ) : null}
              <Button
                className="w-full"
                size="lg"
                disabled={amount < MIN_DEPOSIT || amount > MAX_DEPOSIT}
                onClick={() => setMethodOpen(true)}
              >
                {t("continue")}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
                <Lock className="size-3.5" aria-hidden="true" />
                {t("securedByPaybis")}
              </p>
            </div>
          </div>
          <aside className="mt-2 hidden flex-col gap-4 lg:flex">
            {cryptoDepositAvailable ? (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
                <p className="font-semibold text-foreground">{t("cryptoAside.title")}</p>
                <p className="mt-1 text-muted-foreground text-sm">{t("cryptoAside.body")}</p>
                <button
                  type="button"
                  onClick={openCrypto}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-primary/50 font-semibold text-primary text-sm transition-colors hover:bg-primary/10"
                >
                  {t("cryptoPill")}
                </button>
              </div>
            ) : null}
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="font-semibold text-foreground">{t("howItWorks.title")}</p>
              <ol className="mt-3 flex flex-col gap-3">
                {[t("howItWorks.step1"), t("howItWorks.step2"), t("howItWorks.step3")].map(
                  (text, i) => (
                    <li key={text} className="flex gap-3 text-sm">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-foreground text-xs">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{text}</span>
                    </li>
                  ),
                )}
              </ol>
            </div>
          </aside>
        </div>
      ) : null}

      {/* ── Review ───────────────────────────────────────────────────────── */}
      {step === "review" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("amount")}
            className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t("review.title")}
          </button>

          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-muted-foreground text-sm">{t("review.youReceive")}</p>
            <p className="mt-1 font-bold text-3xl text-foreground">
              {formatTokenAmount(net, "USDC", 2)}
            </p>
            <div className="mt-4 flex flex-col gap-3 border-border border-t pt-4">
              <Row label={t("review.youPay")} value={formatUsd(charged)} />
              <Row
                label={t("review.fee")}
                sub={t("review.feeNote", { method: methodNames[method], pct: feePct })}
                value={formatUsd(fee)}
              />
              <Row label={t("review.exchangeRate")} value={t("review.rateValue")} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
            <span className="text-foreground text-sm">
              {t("review.payingWith", { method: methodNames[method] })}
            </span>
            <button
              type="button"
              onClick={() => setMethodOpen(true)}
              className="font-medium text-primary text-sm hover:underline"
            >
              {t("review.change")}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {belowNeed ? (
              <p className="text-center text-sm text-warning">
                {t("review.belowNeed", { amount: formatUsd(shortfall) })}
              </p>
            ) : null}
            <Button className="w-full" size="lg" onClick={confirmFiat} disabled={belowNeed}>
              {t("review.confirm", { method: methodNames[method] })}
            </Button>
            <p className="text-center text-muted-foreground text-xs">{t("review.poweredBy")}</p>
          </div>
        </>
      ) : null}

      {/* ── Fiat success ─────────────────────────────────────────────────── */}
      {step === "success" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("success.title")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("success.subtitle")}</p>
          </div>
          <div className="w-full rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-3">
              <Row label={t("success.amount")} value={formatUsd(charged)} />
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("success.received")}</span>
                <span className="font-medium text-success">
                  {formatTokenAmount(net, "USDC", 2)}
                </span>
              </div>
              <Row label={t("success.method")} value={methodNames[method]} />
              <Row label={t("success.date")} value={completedAt} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Link
              href={investHref}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            >
              {t("success.investNow")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
            >
              {t("success.backHome")}
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── Crypto receive ───────────────────────────────────────────────── */}
      {step === "crypto-receive" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("amount")}
            className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t("crypto.title")}
          </button>

          {investBanner}

          {connectedAddress ? (
            <>
              {/* Chosen network + a way to change it (POO-479 R3). */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                <span className="flex min-w-0 items-center gap-2">
                  <NetworkLogo
                    network={network.slug}
                    name={network.name}
                    size={20}
                    className="size-5"
                  />
                  <span className="truncate font-medium text-foreground text-sm">
                    {network.name}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setNetworkOpen(true)}
                  className="shrink-0 font-medium text-primary text-sm hover:underline"
                >
                  {t("crypto.changeNetwork")}
                </button>
              </div>

              <div className="flex flex-col items-center gap-4">
                <p className="font-semibold text-foreground">{t("crypto.scanToDeposit")}</p>
                <div className="rounded-2xl bg-white p-3">
                  <QrBlock value={connectedAddress} className="size-44" />
                </div>
                <span className="rounded-full border border-border px-3 py-1 text-foreground text-xs">
                  {t("crypto.asset")}
                </span>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-muted-foreground text-xs">{t("crypto.addressLabel")}</p>
                <p className="mt-1 break-all font-mono text-foreground text-sm">
                  {connectedAddress}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={copyAddress}>
                    {copied ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {copied ? t("crypto.copied") : t("crypto.copy")}
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={shareAddress}>
                    <Share2 className="size-4" aria-hidden="true" />
                    {t("crypto.share")}
                  </Button>
                </div>
              </div>

              {/* Network-specific loss-of-funds warning (POO-479 R2). */}
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-warning text-sm">
                {t("crypto.networkWarning", { network: network.name })}
              </p>

              {/* POO-604: there is no on-chain watcher / deposit webhook in production and won't be for
                  now, so the "I've sent the funds" confirm is the ONLY trigger that advances the crypto
                  flow — and it is needed only to RESUME the Deposit & Invest flow (POO-605). On the
                  standalone path there is nothing to resume, so the receive step is terminal: just the
                  address. The deposit lands in the wallet and the balance reflects it on the next
                  refetch — we never claim a "detected" state we cannot actually observe. */}
              {investContext ? (
                <Button className="w-full" size="lg" onClick={() => setStep("crypto-waiting")}>
                  {t("crypto.sent")}
                </Button>
              ) : null}
            </>
          ) : walletLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <p className="rounded-lg bg-surface-raised px-3 py-6 text-center text-muted-foreground text-sm">
              {t("crypto.noWallet")}
            </p>
          )}
        </>
      ) : null}

      {/* ── Crypto waiting ───────────────────────────────────────────────── */}
      {step === "crypto-waiting" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Loader2 className="size-8 animate-spin" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("crypto.waitingTitle")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("crypto.waitingBody")}</p>
          </div>
          <span className="max-w-full truncate rounded-full border border-border px-3 py-1 font-mono text-muted-foreground text-xs">
            {connectedAddress}
          </span>
          <Button variant="ghost" size="md" onClick={() => setStep("crypto-receive")}>
            {t("crypto.viewAddress")}
          </Button>
        </div>
      ) : null}

      {/* ── Crypto success ───────────────────────────────────────────────── */}
      {step === "crypto-success" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("crypto.receivedTitle")}</h1>
            <p className="mt-1 font-medium text-success">
              {t("crypto.added", { amount: formatNumber(cryptoReceived) })}
            </p>
          </div>
          <div className="w-full rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("crypto.received")}</span>
                <span className="font-medium text-success">
                  {formatTokenAmount(cryptoReceived, "USDC", 2)}
                </span>
              </div>
              <Row label={t("crypto.source")} value={t("crypto.sourceValue")} />
              <Row label={t("crypto.date")} value={completedAt} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Link
              href={investHref}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            >
              {t("success.investNow")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
            >
              {t("success.backHome")}
            </Link>
          </div>
        </div>
      ) : null}

      <PaymentMethodDialog
        open={methodOpen}
        onOpenChange={setMethodOpen}
        value={method}
        onSelect={(m) => {
          setMethod(m);
          track("deposit_method_selected", { deposit_method: m });
        }}
        onContinue={() => {
          setMethodOpen(false);
          setStep("review");
        }}
      />

      <NetworkPickerDialog
        open={networkOpen}
        onOpenChange={setNetworkOpen}
        value={network}
        onSelect={setNetwork}
        onContinue={() => setNetworkOpen(false)}
      />
    </div>
  );
}
