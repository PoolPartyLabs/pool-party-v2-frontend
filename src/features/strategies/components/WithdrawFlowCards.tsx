/**
 * @id PP-STR-CMP-020
 * @name WithdrawFlowCards (WithdrawReviewCard + WithdrawReceiptCard)
 * @implements-rules-version v1 (POO-803 rules v1; POO-923 rules v1)
 *
 * The ONE Review + Receipt of the withdraw family (0710 overhaul): `WithdrawModal`
 * (closed/invested, PP-STR-MOD-004) and `RemoveLiquidityModal` (managed, PP-MGR-MOD-003) render
 * these instead of their ~90% duplicated hand-rolled blocks (POO-799 decision #10).
 *
 * Review (R7): summary [Amount requested · Fees available to collect] — each with the per-token
 * breakdown + logos ONLY on the pair payout (R6; POO-923 R1 supersedes POO-846 R1: a USDC payout
 * collapses both figures to the single USD amount) — then the fee detail (Est. fee canonical
 * tooltip · Max. slippage with the Auto badge · Price impact) behind Show more, Receive as below
 * the toggle, and the footer: the "after fees" caption ONLY on the USDC payout (POO-923 R3: the
 * pair payout swaps nothing, so no fee/slippage caption) plus the consumer-built arrival line. The old
 * "You receive at least" / "Remaining invested" / "Amount" / "Total received (min)" rows are gone
 * (R5) — the arrival line ("≈ X USDC · Arrives instantly") is the min-received indicator.
 *
 * Receipt (R11): summary [Strategy · Amount Received · Fees collected · Total received], the final
 * Fee + Slippage + Price impact behind Show more, Date + Transaction never collapsing.
 *
 * Fee figures are REAL-only inputs: an absent USD hides its line, never a fabricated $0 (POO-799
 * directive #1); the canonical tooltip order comes from buildCanonicalFeeLines (POO-800 R2).
 * Reads the shared `strategies` namespace directly (both consumers already do — the managed modal
 * consumes `flow.*` via its tSign).
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  type TokenAmountRowEntry,
  TokenAmountRows,
} from "@/components/data-display/TokenAmountRows";
import { CollapsibleReceiptRows } from "@/components/ui/CollapsibleReceiptRows";
import type { ReceiptRowItem } from "@/components/ui/ReceiptRows";
import { formatIdentityLabel, formatUsd } from "@/lib/utils/format";
import {
  buildCanonicalFeeLines,
  buildFeeRow,
  buildMaxSlippageRow,
  buildPriceImpactRow,
} from "./FeeBreakdown";

/** One leg of a pair payout breakdown (amount at crypto precision; symbol keys the row). */
export interface WithdrawTokenRow {
  symbol: string;
  amount: number;
  /** Estimated USD for the leg (POO-548 R4); omitted → amounts-only row. */
  usd?: number;
}

/** The fee figures both cards break down. REAL-only: undefined hides the line (POO-799 #1). */
interface FeeFigures {
  /** Network gas in USD, from the built `estimatedGasInUsd`. */
  networkFeeUsd?: number;
  /** Swap protocol fee in USD, from the built `swapInfo.protocolFee` (USDC payout only). */
  protocolFeeUsd?: number;
  /** Swap price impact in percent, from the built `swapInfo.priceImpactPercentage`. */
  priceImpactPct?: number;
}

/** Shared canonical fee lines for the withdraw cards (no DEX line until POO-521; same-chain). */
function useWithdrawFeeLines({ networkFeeUsd, protocolFeeUsd }: FeeFigures) {
  const t = useTranslations("strategies");
  return buildCanonicalFeeLines({
    labels: {
      dex: t("flow.feesTooltip.dex"),
      network: t("flow.feesTooltip.network"),
      protocol: t("flow.feesTooltip.protocol"),
      performance: t("flow.feesTooltip.performance"),
      bridge: t("flow.feesTooltip.bridge"),
      comingSoon: t("flow.feesTooltip.comingSoon"),
    },
    networkUsd: networkFeeUsd,
    protocolUsd: protocolFeeUsd,
  });
}

/** A summary row whose value is the USD figure, or the per-token breakdown on the pair payout. */
function payoutRow(
  label: string,
  usd: number,
  tokens: WithdrawTokenRow[] | null | undefined,
  network: string | undefined,
  testId: string,
  tone: ReceiptRowItem["tone"],
): ReceiptRowItem {
  return {
    label,
    value:
      tokens != null && tokens.length > 0 ? (
        <TokenAmountRows rows={tokens} network={network} testId={testId} />
      ) : (
        formatUsd(usd)
      ),
    tone,
  };
}

/** Public props for {@link WithdrawReviewCard}. */
export interface WithdrawReviewCardProps extends FeeFigures {
  /** GROSS amount requested, USD. */
  amountUsd: number;
  /** Accrued pool fees the withdraw also collects, USD. Row hidden when undefined. */
  feesAvailableUsd?: number;
  /** Per-token breakdowns for the pair payout (R6, with logos); null/absent → the USD figure. */
  amountTokens?: WithdrawTokenRow[] | null;
  feesTokens?: WithdrawTokenRow[] | null;
  /** Network slug for token-logo resolution on the per-token rows. */
  network?: string | undefined;
  /** Already-resolved receive-as display value; row hidden when undefined. */
  receiveAs?: string;
  /** Whether the payout keeps the pool token pair (drives the caption variant). */
  receivingPair: boolean;
  /** The gear slippage, with the Auto badge while the role default is untouched (decision #7). */
  slippagePct: number;
  slippageIsDefault: boolean;
  /** Already-translated arrival line (e.g. "≈ 47.5 USDC · Arrives instantly"); hidden when null. */
  arrival?: ReactNode;
}

/** The shared withdraw-family Review card (R5-R8). */
export function WithdrawReviewCard({
  amountUsd,
  feesAvailableUsd,
  amountTokens,
  feesTokens,
  network,
  receiveAs,
  receivingPair,
  slippagePct,
  slippageIsDefault,
  arrival,
  networkFeeUsd,
  protocolFeeUsd,
  priceImpactPct,
}: WithdrawReviewCardProps) {
  const t = useTranslations("strategies");
  const feeLines = useWithdrawFeeLines({ networkFeeUsd, protocolFeeUsd });
  // POO-923 R1 (supersedes POO-846 R1's "regardless of receive-as"): the per-token split describes
  // the pool unwind, so it belongs ONLY on the pair payout. A USDC payout is delivered as one USDC
  // figure, so both summary rows collapse to the single USD amount (the resolved split is dropped).
  const summaryTokens = receivingPair ? amountTokens : null;
  const summaryFeesTokens = receivingPair ? feesTokens : null;
  // POO-923 R3: the pair payout performs NO swap, so there is no "after fees"/slippage to caption;
  // only the USDC payout keeps it. With the arrival line already null on the standard pair path,
  // the footer is left undefined (not an empty fragment) so no stray bordered caption block renders.
  const caption = receivingPair ? null : <p>{t("flow.review.caption", { rate: slippagePct })}</p>;
  const footer =
    caption != null || arrival != null ? (
      <>
        {caption}
        {arrival != null ? <p>{arrival}</p> : null}
      </>
    ) : undefined;
  return (
    <CollapsibleReceiptRows
      summary={[
        [
          payoutRow(
            t("withdraw.review.amountRequested"),
            amountUsd,
            summaryTokens,
            network,
            "withdraw-amount-tokens",
            "default",
          ),
          ...(feesAvailableUsd != null
            ? [
                payoutRow(
                  t("withdraw.review.feesAvailable"),
                  feesAvailableUsd,
                  summaryFeesTokens,
                  network,
                  "withdraw-fees-tokens",
                  "positive",
                ),
              ]
            : []),
        ],
      ]}
      details={[
        [
          ...(feeLines.length > 0
            ? [
                buildFeeRow({
                  label: t("withdraw.review.estFees"),
                  lines: feeLines,
                  totalLabel: t("flow.feesTooltip.total"),
                }),
              ]
            : []),
          buildMaxSlippageRow({
            label: t("flow.review.maxSlippage"),
            slippagePct,
            autoLabel: slippageIsDefault ? t("flow.review.slippageAuto") : undefined,
          }),
          ...(priceImpactPct != null
            ? [buildPriceImpactRow(t("flow.review.priceImpact"), priceImpactPct)]
            : []),
        ],
      ]}
      after={[
        [
          ...(receiveAs != null
            ? [
                {
                  // POO-403 R3: display-only — the gear (input step) is the single settings entry.
                  label: t("invest.settings.receiveAsLabel"),
                  value: receiveAs,
                } satisfies ReceiptRowItem,
              ]
            : []),
        ],
      ]}
      footer={footer}
      showMoreLabel={t("flow.review.showMore")}
      showLessLabel={t("flow.review.showLess")}
    />
  );
}

/** Public props for {@link WithdrawReceiptCard}. */
export interface WithdrawReceiptCardProps extends FeeFigures {
  strategyName: string;
  /**
   * Amount received, USD — the confirm-time snapshot, shown when `receivedTokenRows` is absent/empty
   * (mock walk / undecodable logs; POO-810 R9 fallback).
   */
  amountReceivedUsd: number;
  /**
   * POO-810 R6: the REAL per-token amounts received, decoded from the confirmed receipt (USDC leg as
   * USD, 1:1). When present AND non-empty they render as per-token rows in place of the USD scalar;
   * null/empty falls back to `amountReceivedUsd` (R9). The managed remove never decodes → USD-only.
   */
  receivedTokenRows?: TokenAmountRowEntry[] | null;
  /** Network slug for token-logo resolution on the decoded per-token rows (POO-810 R6). */
  network?: string | undefined;
  /** Accrued fees this withdraw also collected, USD. Row hidden when undefined. */
  feesCollectedUsd?: number;
  /**
   * POO-844: whether the fees are ALREADY baked into Total received (the all-USDC decode is the
   * all-in payout, so Amount == Total with the fee line between them). When true the fee line reads
   * "Fees collected (included)" so it can't be misread as adding on top; false (default, e.g. the
   * managed remove / estimate branch where the fee genuinely adds) keeps the plain "Fees collected".
   */
  feesIncludedInTotal?: boolean;
  /** Total received (emphasis). Row hidden when undefined. */
  totalReceivedUsd?: number;
  /** The gear slippage the send used. */
  slippagePct: number;
  /** Already-formatted date value (the consumer owns the locale-aware formatter). */
  date: string;
  /** Already-shortened tx hash; row hidden when null (a real flow without a hash fabricates none). */
  txHashShort?: string | null;
}

/** The shared withdraw-family Receipt card (R9-R11). */
export function WithdrawReceiptCard({
  strategyName,
  amountReceivedUsd,
  receivedTokenRows,
  feesCollectedUsd,
  feesIncludedInTotal,
  totalReceivedUsd,
  slippagePct,
  date,
  txHashShort,
  network,
  networkFeeUsd,
  protocolFeeUsd,
  priceImpactPct,
}: WithdrawReceiptCardProps) {
  const t = useTranslations("strategies");
  const feeLines = useWithdrawFeeLines({ networkFeeUsd, protocolFeeUsd });
  return (
    <CollapsibleReceiptRows
      summary={[
        [
          // POO-841 R2: a missing name must never render a raw 66-char position id (belt).
          { label: t("flow.receipt.strategy"), value: formatIdentityLabel(strategyName) },
          {
            label: t("withdraw.receipt.amountReceived"),
            // POO-810 R6: the REAL decoded per-token amounts (USDC leg as USD) when the receipt
            // decoded; otherwise the confirm-time USD snapshot (R9 fallback).
            value:
              receivedTokenRows != null && receivedTokenRows.length > 0 ? (
                <TokenAmountRows
                  rows={receivedTokenRows}
                  network={network}
                  testId="withdraw-received-amounts"
                />
              ) : (
                formatUsd(amountReceivedUsd)
              ),
          },
          ...(feesCollectedUsd != null
            ? [
                {
                  // POO-844: signal "already in the total" when the decode is the all-in payout, so
                  // an Amount == Total receipt can't read as if the fee adds on top.
                  label: feesIncludedInTotal
                    ? t("withdraw.receipt.feesCollectedIncluded")
                    : t("withdraw.receipt.feesCollected"),
                  value: formatUsd(feesCollectedUsd),
                  tone: "positive" as const,
                },
              ]
            : []),
          ...(totalReceivedUsd != null
            ? [
                {
                  label: t("withdraw.receipt.totalReceived"),
                  value: formatUsd(totalReceivedUsd),
                  tone: "emphasis" as const,
                },
              ]
            : []),
        ],
      ]}
      details={[
        [
          ...(feeLines.length > 0
            ? [
                buildFeeRow({
                  label: t("flow.receipt.fee"),
                  lines: feeLines,
                  totalLabel: t("flow.feesTooltip.total"),
                }),
              ]
            : []),
          buildMaxSlippageRow({ label: t("flow.receipt.slippage"), slippagePct }),
          ...(priceImpactPct != null
            ? [buildPriceImpactRow(t("flow.review.priceImpact"), priceImpactPct)]
            : []),
        ],
      ]}
      after={[
        [
          { label: t("flow.receipt.date"), value: date },
          ...(txHashShort ? [{ label: t("flow.receipt.transaction"), value: txHashShort }] : []),
        ],
      ]}
      showMoreLabel={t("flow.review.showMore")}
      showLessLabel={t("flow.review.showLess")}
    />
  );
}
