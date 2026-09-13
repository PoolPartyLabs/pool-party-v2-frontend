/**
 * @id PP-STR-CMP-024
 * @name ProvisioningCostBreakdown
 * @implements-rules-version v2 (POO-1575 rules v2) · v1 (POO-1040 rules v1) · v1 (POO-1380 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * What a funding plan costs, rendered: the hero "You pay" figure, the fee detail behind Show more on
 * the shared {@link CollapsibleReceiptRows} card, and the honest alternative next to it ([R3]) for a
 * user who would rather buy crypto than move what they already hold.
 *
 * ## The buy-crypto peer names the amount when it can (POO-1380)
 *
 * The peer CTA reads "Buy $101.02" when the host supplies a resolved buy amount (`buyAmountUsd`, the
 * received-fixed on-ramp charge from `useBuyRouteQuote`, POO-1153 [R10]), and degrades to the bare
 * "Buy crypto instead" wording whenever that figure has not resolved. That degraded path is the live
 * default: with the on-ramp disabled (crypto-only cut) and in mock mode the quote is never priced, so
 * the host passes nothing and the naming simply does not apply. It is a display-only nicety layered on
 * the same `/deposit` handoff, never a gate on it.
 *
 * ## The buy-crypto hint names the buyer's own methods (POO-1575)
 *
 * The hint under that CTA read "Pay with a card or Pix" in all 12 locales, to every buyer in every
 * country, which promises a Brazilian rail to people who will never be offered it. It now names the
 * methods resolved for the buyer's currency (`buyMethodNames`, at most two, joined in the active
 * locale) and, with none resolved, keeps only the half of the claim that is always true: skipping
 * the move between networks.
 *
 * ## It renders numbers, it does not compute them
 *
 * Every figure comes from `planCostBreakdown` (PP-CORE-LIB-056), which the planner already ran to
 * fill the plan's quote. "You pay" is `plan.quote.totalPayUsd` verbatim ([R2]): a second derivation
 * is a second thing that can drift, and a user who approves one total and reads another has been
 * shown two prices for one transaction. No fee model, no constant, no fallback percentage lives here
 * ([R5]) - a figure the quote did not price renders as NO ROW rather than as a plausible-looking
 * stand-in (POO-799 global directive #1).
 *
 * ## Why the contract's split is re-cut for display
 *
 * The contract splits the total as `shortfall + buffer + fees`, where the buffer is gas PLUS the
 * slippage allowance and the fees are the bridge's take. The app, however, standardizes on ONE "Fee"
 * row consolidating gas and bridge (see FeeBreakdown, POO-800 R2), so the rows read:
 *
 *   Amount needed (shortfall) + Fee (gas + bridge) + Price buffer (slippage allowance) = You pay
 *
 * Identical arithmetic, regrouped: `gas + slippage + bridge` is exactly `buffer + fees`. The total
 * itself is never recomputed from those rows, it is read off the quote.
 *
 * ## The rounding contract, and why the per-leg gas list is not a sum
 *
 * PP-CORE-LIB-056's header pins it: aggregates are accumulated as integer micro-dollars and exposed
 * ROUNDED TO CENTS so the table adds up, while each leg's own gas is exposed at micro-dollar
 * precision because L2 gas is routinely sub-cent and $0.0031 must not render as "$0.00", i.e. free.
 * The two therefore do not visually tie out ($0.01 + $0.03 + $0.0031 against an aggregate of $0.04),
 * so the per-leg list is presented as an ITEMIZATION with that stated in its tooltip, never as an
 * addition ([R8]).
 *
 * ## Presentational
 *
 * Props in, rows out: no fetching, no server action, no session. The TTL loop reuses the shipped
 * `useReviewCountdown` ([R4]) and delegates the actual re-quote to the host via `onRequote`, because
 * only the host knows how the plan was built. POO-1042 wires it into the modals.
 */
"use client";

import { ChevronRight, CreditCard, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CollapsibleReceiptRows } from "@/components/ui/CollapsibleReceiptRows";
import type { ReceiptRowItem } from "@/components/ui/ReceiptRows";
import { Link } from "@/i18n/navigation";
import { getChainById } from "@/lib/chains/config";
import {
  bridgeFeeTooltipInput,
  type ProvisioningCostModel,
  type ProvisioningCostSource,
  type ProvisioningLegKind,
  type ProvisioningPlan,
  planCostBreakdown,
} from "@/lib/provisioning";
import { cn } from "@/lib/utils/cn";
import { formatFiat, formatPercent, formatUsd, formatUsdPrecise } from "@/lib/utils/format";
import { useReviewCountdown } from "../../hooks/useReviewCountdown";
import { DEFAULT_SLIPPAGE_PCT } from "../../lib/slippage";
import {
  buildCanonicalFeeLines,
  buildFeeRow,
  buildMaxSlippageRow,
  buildPriceImpactRow,
  FeeBreakdownBody,
  type FeeLine,
  feeFlatLabel,
} from "../FeeBreakdown";
import { formatPaymentMethods } from "./provisioningView";

/**
 * The translator, structurally (the WalletSignModal precedent): these row builders only need to
 * resolve keys, so they take the function rather than depending on next-intl's generic instance.
 */
type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

/** Where the "Buy crypto instead" peer option hands off ([R3]). The launched deposit surface. */
const DEPOSIT_HREF = "/deposit";

/** Per-leg gas is exposed in micro-dollars; six decimals is the precision that keeps it non-zero. */
const GAS_LEG_DECIMALS = 6;

/**
 * i18n key for a leg's own label, by route kind.
 *
 * Keyed by `ProvisioningLegKind`, NOT `ProvisioningStepType`, so the POO-1131 `buy-usdc` → `buy`
 * step-type rename does not touch it. That holds only while `buy` stays a step type and never joins
 * `ProvisioningLegKind`: a fiat purchase is not an on-chain route leg and must not be priced as one
 * here. If a `buy` ever needs a cost line, it gets its own map, not an entry in this one.
 */
const LEG_LABEL_KEY: Record<ProvisioningLegKind, string> = {
  "swap-token": "provisioning.costs.leg.swapToken",
  "swap-gas": "provisioning.costs.leg.swapGas",
  bridge: "provisioning.costs.leg.bridge",
  // Its own line, never folded into `bridge` ([R6], POO-1075): the user is spending real money to
  // become ABLE to spend money, and a cost they cannot see is one they cannot judge.
  "bridge-gas": "provisioning.costs.leg.bridgeGas",
};

/** Public props for {@link ProvisioningCostBreakdown}. */
export interface ProvisioningCostBreakdownProps {
  /** The plan being priced. Its `quote` is authoritative for "You pay" ([R2]). */
  plan: ProvisioningPlan;
  /**
   * Fired when the quote's TTL elapses: the host re-quotes and passes the fresh plan back ([R4]).
   * The component cannot do this itself - the planner is server-only (ADR 0003).
   */
  onRequote: () => void;
  /**
   * True while the host's re-quote is in flight, so the card can say the price is being refreshed.
   * It also PAUSES the countdown: a window that kept running could elapse a second time against a
   * request already out, re-quoting on top of a re-quote.
   */
  requoting?: boolean;
  /**
   * False pauses the countdown. The host sets it while the plan is not on screen, or the instant a
   * user commits: a re-quote must never land against a transaction already dispatched (POO-888 R3).
   */
  active?: boolean;
  /** Where the buy-crypto CTA points; defaults to `/deposit`. Pass a deep link to carry context. */
  buyCryptoHref?: string;
  /**
   * POO-1380 [R1][R2]: the amount the buy route would actually buy, in USD, so the peer CTA can name
   * it ("Buy $101.02") instead of the bare "Buy crypto instead". It is the received-fixed on-ramp
   * charge (`useBuyRouteQuote().chargeUsd`, POO-1153 [R10], the backend's `amountFrom`), the same
   * figure the FundingRoutePicker buy row names, never the FE-computed shortfall. Rendered through
   * `formatFiat` in {@link buyAmountCurrency}. [R3] Absent, non-finite, zero, or negative means the
   * quote has not resolved (the live default in the crypto-only cut and in mock mode), and the CTA
   * degrades to its current wording rather than showing "Buy undefined", "Buy $NaN", or a bare
   * currency symbol.
   */
  buyAmountUsd?: number;
  /**
   * POO-1512 [R7]: the fiat currency {@link buyAmountUsd} is billed in (`chargeCurrencyCode`). The
   * charge is now denominated in the buyer's own currency, so without this the CTA would say
   * "Buy $208.00" for the same charge the picker row states as "208.00 EUR". Defaults to USD.
   */
  buyAmountCurrency?: string;
  /**
   * POO-1575 [R1]: the payment methods Paybis offers for the buyer's own resolved currency, as
   * display names, so the hint under this CTA names what THIS buyer can pay with.
   *
   * The hint used to read "Pay with a card or Pix" to every buyer in every country, which is a
   * promise about a Brazilian rail most of them are never offered. The list is the one the host
   * already holds (`useBuyRouteQuote().methods`, POO-1578) and is never resolved a second time here
   * ([R6]). At most two are named, joined in the active locale.
   *
   * Absent or empty ([R3]) is the live default in mock mode and the crypto-only cut, and takes a
   * hint that names no method rather than inventing one.
   *
   * **Why this prop carries no currency pair, unlike `PlanViewOptions.buyPaymentMethods` ([R8]).**
   * That option describes a `buy` LEG whose charged currency is already decided, so the two can be
   * compared. This CTA describes a purchase that does not exist yet: it deep-links to `/deposit`,
   * where the buyer picks an amount and `StandaloneOnRampRail` sizes an order afterwards, so there
   * is no charged currency at render time to check against. What can be said honestly, and is the
   * whole claim this hint makes, is that these are the methods the buyer's OWN currency offers. That
   * holds for the ordinary `USDC-BASE` standalone deposit, which is received-fixed and therefore
   * resolves the buyer's currency; it does NOT hold if that deposit turns into a gas-first `ETH-BASE`
   * leg whose ETH target fails to price, which stays pinned to USD (POO-1573 [R5]). Recorded on
   * `CR-TOK-009` rather than guarded here, because the fact the guard would need does not exist yet.
   *
   * PP-TODO(POO-1576): `ProvisioningPanel` does not pass this yet (that file is owned by concurrent
   * work), so production takes the neutral branch today. The wiring is one line beside the
   * `buyAmountUsd` it already passes, and it typechecks as written (`displayName` is a `string`,
   * unlike the `methodLabel` the plan option's handoff has to filter):
   * `buyMethodNames={(buyRouteQuote.methods ?? []).map((method) => method.displayName)}`.
   */
  buyMethodNames?: readonly string[];
  /**
   * POO-1503 fix (#835): the host's OWN ticking countdown seconds. When set, the status line
   * displays this figure and the card runs NO timer of its own: on step 2 the freshness loop lives
   * in `ProvisioningPanel` (it must fire while the `See details` disclosure is closed, i.e. while
   * this card is unmounted), and a second `useReviewCountdown` here would both disagree with it and
   * fire a second re-quote per window against the same quote. Absent (the mock-mode plan screen),
   * the card keeps its shipped self-driven `QuoteStatus` loop unchanged.
   */
  countdownSeconds?: number;
  className?: string;
}

/** A chain's display name, or its id when it is not one we know. Never a silent blank. */
function networkName(chainId: number): string {
  return getChainById(chainId)?.name ?? `#${chainId}`;
}

/** A source's own cost lines, for the info (ⓘ) trigger on its row ([R1]). */
function sourceLines(
  source: ProvisioningCostSource,
  labels: {
    network: string;
    bridge: string;
    buffer: string;
    conversion: string;
    impact: string;
  },
): FeeLine[] {
  const { lines } = source;
  return [
    ...(lines.gasUsd > 0 ? [{ key: "gas", label: labels.network, usd: lines.gasUsd }] : []),
    ...(lines.bridgeFeeUsd > 0
      ? [{ key: "bridge", label: labels.bridge, usd: lines.bridgeFeeUsd }]
      : []),
    ...(lines.slippageUsd > 0
      ? [{ key: "buffer", label: labels.buffer, usd: lines.slippageUsd }]
      : []),
    // `display` keeps these OUT of the total, which is the point: the conversion cost is already
    // inside the quoted output (adding it would charge it twice) and an impact is a percent, not a
    // term. Both are real quoted figures, so this is not the placeholder use the field warns about.
    ...(lines.swapCostUsd > 0
      ? [{ key: "swap", label: labels.conversion, usd: 0, display: formatUsd(lines.swapCostUsd) }]
      : []),
    ...(lines.priceImpactPct !== undefined
      ? [
          {
            key: "impact",
            label: labels.impact,
            usd: 0,
            display: formatPercent(lines.priceImpactPct, 2),
          },
        ]
      : []),
  ];
}

/**
 * The status line itself, shared by the self-driven {@link QuoteStatus} loop and a host-driven
 * figure (`countdownSeconds`, POO-1503 fix #835). Display only: no timer, no hook, so a host that
 * owns the countdown can render this without a second window ever existing. Deliberately NOT an
 * aria-live region - it changes once a second, and a screen reader announcing the countdown every
 * second is unusable.
 */
function QuoteStatusLabel({ seconds, requoting }: { seconds: number; requoting: boolean }) {
  const t = useTranslations("strategies");
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <RefreshCw className={cn("size-3.5", requoting && "animate-spin")} aria-hidden="true" />
      {requoting ? t("provisioning.costs.updating") : t("flow.review.refreshIn", { seconds })}
    </span>
  );
}

/**
 * The always-visible quote status: the TTL countdown, or the refresh in flight ([R4]).
 *
 * A child, and KEYED ON `quotedAt` by its parent, so a fresh quote remounts it and the window starts
 * over. `useReviewCountdown` resets only when `active`/`seconds` change, and a re-quote changes
 * neither - without the remount the new price would inherit the old price's remaining seconds.
 *
 * The seconds come from `ttlMs` rather than from `quotedAt + ttlMs - now`: wall-clock math during
 * render differs between the server pass and hydration, and this is the same full-window behaviour
 * every shipped Review has.
 */
function QuoteStatus({
  ttlMs,
  active,
  requoting,
  onRequote,
}: {
  ttlMs: number;
  active: boolean;
  requoting: boolean;
  onRequote: () => void;
}) {
  const { seconds } = useReviewCountdown({
    active,
    seconds: Math.max(1, Math.round(ttlMs / 1000)),
    onRefresh: onRequote,
  });
  return <QuoteStatusLabel seconds={seconds} requoting={requoting} />;
}

/**
 * The aggregate cost rows.
 *
 * With legs to itemize the figures come from the model; with none (a mock plan) they come from the
 * quote's own components, which is the only honest answer left - and either way the three rows sum
 * to the total the user is asked to approve.
 */
function aggregateRows({
  plan,
  model,
  t,
}: {
  plan: ProvisioningPlan;
  model: ProvisioningCostModel;
  t: TranslateFn;
}): ReceiptRowItem[] {
  const itemized = model.sources.length > 0;
  const feeLines = buildCanonicalFeeLines({
    labels: {
      dex: t("flow.feesTooltip.dex"),
      network: t("flow.feesTooltip.network"),
      protocol: t("flow.feesTooltip.protocol"),
      performance: t("flow.feesTooltip.performance"),
      bridge: t("flow.feesTooltip.bridge"),
      comingSoon: t("flow.feesTooltip.comingSoon"),
    },
    // A zero gas figure means the quote returned none, not that the transaction is free, so it
    // hides the line rather than claiming $0.00 ([R5]).
    ...(model.totals.gasUsd > 0 ? { networkUsd: model.totals.gasUsd } : {}),
    ...bridgeFeeTooltipInput(model),
  });
  const label = t("provisioning.costs.fee");
  let feeRow: ReceiptRowItem[];
  if (itemized) {
    feeRow =
      feeLines.length > 0
        ? [buildFeeRow({ label, lines: feeLines, totalLabel: t("flow.feesTooltip.total") })]
        : [];
  } else {
    // No legs, so there is no breakdown to open: the quote's own fee figure, stated plainly.
    feeRow = plan.quote.feesUsd > 0 ? [{ label, value: formatUsd(plan.quote.feesUsd) }] : [];
  }
  const bufferUsd = itemized ? model.totals.slippageUsd : plan.quote.bufferUsd;

  return [
    { label: t("provisioning.costs.amountNeeded"), value: formatUsd(plan.quote.shortfallUsd) },
    ...feeRow,
    ...(bufferUsd > 0
      ? [
          {
            label: t("provisioning.costs.priceBuffer"),
            value: formatUsd(bufferUsd),
            tooltip: t("provisioning.costs.priceBufferHint"),
          },
        ]
      : []),
  ];
}

/** The context rows: the allowance as a percent, the impact, and the cost already inside the quote. */
function contextRows({
  plan,
  model,
  t,
}: {
  plan: ProvisioningPlan;
  model: ProvisioningCostModel;
  t: TranslateFn;
}): ReceiptRowItem[] {
  return [
    ...(plan.slippagePct !== undefined
      ? [
          buildMaxSlippageRow({
            label: t("flow.review.maxSlippage"),
            slippagePct: plan.slippagePct,
            ...(plan.slippagePct === DEFAULT_SLIPPAGE_PCT
              ? { autoLabel: t("flow.review.slippageAuto") }
              : {}),
          }),
        ]
      : []),
    ...(model.totals.priceImpactPct !== undefined
      ? [buildPriceImpactRow(t("flow.review.priceImpact"), model.totals.priceImpactPct)]
      : []),
    ...(model.totals.swapCostUsd > 0
      ? [
          {
            label: t("provisioning.costs.conversionCost"),
            value: formatUsd(model.totals.swapCostUsd),
            tooltip: t("provisioning.costs.conversionCostHint"),
          },
        ]
      : []),
  ];
}

/** The cost table plus its buy-crypto peer. See {@link ProvisioningCostBreakdownProps}. */
export function ProvisioningCostBreakdown({
  plan,
  onRequote,
  requoting = false,
  active = true,
  buyCryptoHref = DEPOSIT_HREF,
  buyAmountUsd,
  buyAmountCurrency,
  buyMethodNames,
  countdownSeconds,
  className,
}: ProvisioningCostBreakdownProps) {
  const t = useTranslations("strategies");
  // POO-1575: the `{methods}` list is joined with this locale's own disjunction, never an English
  // " or ". `undefined` (nothing resolved) is the neutral-hint branch.
  const locale = useLocale();
  const namedMethods = formatPaymentMethods(buyMethodNames, locale);

  // POO-1380 [R1][R3]: name the amount only when the quote has actually resolved to a spendable
  // figure. A guard on finiteness AND positivity is the whole degraded path: undefined (nothing
  // supplied), NaN/Infinity (a malformed figure), and <= 0 (nothing to buy) all fall back to the
  // current wording, so the CTA can never read "Buy undefined", "Buy $NaN", or a bare "$".
  const hasBuyAmount =
    typeof buyAmountUsd === "number" && Number.isFinite(buyAmountUsd) && buyAmountUsd > 0;
  // POO-1512 [R7]: the CTA names the charge in the currency it is billed in, the same currency the
  // FundingRoutePicker buy row prints for this same figure. Absent a currency, USD keeps the
  // pre-buyer-currency rendering.
  const buyCryptoLabel = hasBuyAmount
    ? t("provisioning.costs.buyCrypto.ctaWithAmount", {
        amount: formatFiat(buyAmountUsd, buyAmountCurrency ?? "USD"),
      })
    : t("provisioning.costs.buyCrypto.cta");
  // PP-INTEGRATION-POINT: every figure below was quoted by the live Uniswap Trading API inside the
  // server-only planner (PP-CORE-LIB-055) and travels here on the plan. This component is offline by
  // construction and must stay that way: it never imports the API client (ADR 0003).
  const model = planCostBreakdown(plan);

  const sourceRows: ReceiptRowItem[] = model.sources.map((source) => {
    const lines = sourceLines(source, {
      network: t("flow.feesTooltip.network"),
      bridge: t("flow.feesTooltip.bridge"),
      buffer: t("provisioning.costs.priceBuffer"),
      conversion: t("provisioning.costs.conversionCost"),
      impact: t("flow.review.priceImpact"),
    });
    const totalLabel = t("flow.feesTooltip.total");
    return {
      label: t("provisioning.costs.fromSource", {
        symbol: source.symbol,
        network: networkName(source.chainId),
      }),
      value: formatUsd(source.spendUsd),
      ...(lines.length > 0
        ? {
            tooltip: {
              label: feeFlatLabel(lines, totalLabel, source.lines.totalUsd),
              body: (
                <FeeBreakdownBody
                  lines={lines}
                  totalLabel={totalLabel}
                  totalUsd={source.lines.totalUsd}
                />
              ),
            },
          }
        : {}),
    };
  });

  // [R8] Each on-chain leg's own gas, at full precision, headed by a row that says what the list is.
  // A leg the quote priced at zero is omitted: zero means "no figure", and a signature genuinely
  // costs none - either way, printing "$0" would read as a promise that it is free.
  const gasLines = model.gas.filter((line) => line.usd > 0);
  const gasRows: ReceiptRowItem[] =
    gasLines.length > 0
      ? [
          {
            label: t("provisioning.costs.gasByStep"),
            value: (
              <span className="text-muted-foreground text-xs">
                {t("provisioning.costs.itemized")}
              </span>
            ),
            tooltip: t("provisioning.costs.gasByStepHint"),
          },
          ...gasLines.map((line, index) => ({
            label: t("provisioning.costs.gasStep", {
              index: index + 1,
              label: t(LEG_LABEL_KEY[line.kind], { network: networkName(line.chainId) }),
            }),
            value: formatUsdPrecise(line.usd, GAS_LEG_DECIMALS),
          })),
        ]
      : [];

  return (
    <div
      data-testid="provisioning-cost-breakdown"
      // The figures are known-stale while a re-quote runs; assistive tech should hear that before
      // the user acts on them.
      aria-busy={requoting === true}
      className={cn("flex flex-col gap-3", className)}
    >
      <CollapsibleReceiptRows
        className={cn(requoting && "opacity-60 transition-opacity")}
        summary={[
          [
            {
              label: t("provisioning.costs.youPay"),
              // [R2] The contract's own figure. Never recomputed from the rows below it.
              value: formatUsd(plan.quote.totalPayUsd),
              tone: "emphasis",
            },
          ],
        ]}
        details={[
          aggregateRows({ plan, model, t }),
          contextRows({ plan, model, t }),
          sourceRows,
          gasRows,
        ]}
        showMoreLabel={t("flow.review.showMore")}
        showLessLabel={t("flow.review.showLess")}
        footer={
          countdownSeconds !== undefined ? (
            // POO-1503 fix (#835): the host owns the ONE countdown; this is a second reading of it,
            // not a second timer.
            <QuoteStatusLabel seconds={countdownSeconds} requoting={requoting} />
          ) : (
            <QuoteStatus
              key={plan.quote.quotedAt}
              ttlMs={plan.quote.ttlMs}
              // An in-flight re-quote pauses the window. Left running, a host slower than one TTL
              // would be asked for a second quote while the first is still out, and each expiry would
              // ask again - the timer hammering a request that is already on its way. Nothing is lost
              // by pausing: whichever way the re-quote ends, a full window follows. A fresh
              // `quotedAt` remounts this via its key; an unchanged one re-arms the hook when `active`
              // goes true.
              active={active && !requoting}
              requoting={requoting}
              onRequote={onRequote}
            />
          )
        }
      />

      {/* [R3] A peer option, not a fallback: some people would simply rather pay with a card than
          move what they already hold. This epic writes no on-ramp code - the CTA hands off to the
          launched /deposit surface and stops there. */}
      <Link
        href={buyCryptoHref}
        className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-3">
          <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground text-sm">{buyCryptoLabel}</span>
            <span className="text-muted-foreground text-xs">
              {/* POO-1575 [R1]/[R3]: the methods this buyer can actually use, or a hint that names
                  none. The shipped copy claimed "a card or Pix" to every buyer in every country. */}
              {namedMethods === undefined
                ? t("provisioning.costs.buyCrypto.hint")
                : t("provisioning.costs.buyCrypto.hintWithMethods", { methods: namedMethods })}
            </span>
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </div>
  );
}
