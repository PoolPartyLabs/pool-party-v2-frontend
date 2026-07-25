/**
 * @id PP-STR-CMP-018
 * @name FeeBreakdown
 * @implements-rules-version v2 (POO-800 rules v1)
 *
 * The shared "Fee" line breakdown used by the transactional-modal receipts. The app standardizes on
 * a single "Fee" row (never "Network fee" / "Est. fees" split across rows); this renders that row's
 * tooltip: each applicable fee component (DEX / protocol / slippage / instant / network gas) as a
 * justified line, with a bold Total only when more than one component applies (a gas-only flow shows
 * a single line, no redundant Total). Pair with a ReceiptRows row whose flat accessible
 * `tooltip.label` comes from {@link feeFlatLabel}, so the icon has an accessible name.
 *
 * POO-445 R4/R5: {@link buildFeeRow} assembles that whole ReceiptRows row in one place — summed
 * value + info tooltip — and is intentionally toneless (neutral), so fees are NEVER rendered in red
 * across the modals. The Move Range protocol fee (ETH-denominated) is the one fee that stays on its
 * own separate row and does not go through this helper.
 *
 * POO-1035 (UF-13 R5, hackathon POO-1022): the Bridge line accepts a REAL figure. It was a "coming
 * soon" placeholder only because nothing could price a bridge; the Universal Funding cost model
 * (`bridgeFeeTooltipInput`, PP-CORE-LIB-056) now can, from the live bridge quote. Passing no figure
 * still renders the placeholder, so every existing caller is unchanged.
 *
 * POO-800 R2/R3 (0710 modals overhaul): {@link buildCanonicalFeeLines} assembles the ONE canonical
 * tooltip — DEX · Network · Protocol · Performance (Collect only) · Bridge (cross-chain only) —
 * hiding any line without a real figure, never fabricating one. A {@link FeeLine}
 * may be display-only (`display`), rendering text instead of a USD figure and staying out of the
 * Total sum. {@link buildMaxSlippageRow} renders the gear slippage detail row with an "Auto" badge
 * when the default applies (epic decision #7).
 */
import type { ReactNode } from "react";
import type { ReceiptRowItem } from "@/components/ui/ReceiptRows";
import { formatPercent, formatUsd } from "@/lib/utils/format";

/**
 * Price impact at or above this percent turns the Review "Price impact" row amber (POO-613 R2). One
 * global threshold, warning-only (no blocking / mandatory confirmation) — Murilo, 2026-07-06.
 */
export const HIGH_PRICE_IMPACT_PCT = 2;

/** One component of a fee breakdown. */
export interface FeeLine {
  /** Stable React key. */
  key: string;
  /** Already-translated label, e.g. "Estimated gas (network fee)". */
  label: string;
  /** Amount in USD. Ignored for display when {@link display} is set. */
  usd: number;
  /**
   * Display-only override (POO-800 R3): already-translated text rendered instead of the USD figure
   * (e.g. the Bridge line's "Coming soon"), excluded from the Total sum. Never use this to dress a
   * fabricated number as real — it exists so a placeholder line can avoid showing one.
   */
  display?: string;
}

/** A line's right-hand text: its display override, else the formatted USD figure. */
function lineValue(line: FeeLine): string {
  return line.display ?? formatUsd(line.usd);
}

/** The tooltip body: each fee line, plus a Total row only when there is more than one line. */
export function FeeBreakdownBody({
  lines,
  totalLabel,
  totalUsd,
}: {
  lines: FeeLine[];
  totalLabel: string;
  totalUsd: number;
}) {
  const showTotal = lines.length > 1;
  return (
    <div className="flex flex-col gap-1">
      {lines.map((line) => (
        <div key={line.key} className="flex justify-between gap-6">
          <span>{line.label}</span>
          <span>{lineValue(line)}</span>
        </div>
      ))}
      {showTotal ? (
        <div className="flex justify-between gap-6 border-border border-t pt-1 font-medium">
          <span>{totalLabel}</span>
          <span>{formatUsd(totalUsd)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The flat accessible tooltip name: lines joined by " · ", with the Total appended when >1 line. */
export function feeFlatLabel(lines: FeeLine[], totalLabel: string, totalUsd: number): string {
  const parts = lines.map((line) => `${line.label} ${lineValue(line)}`);
  if (lines.length > 1) parts.push(`${totalLabel} ${formatUsd(totalUsd)}`);
  return parts.join(" · ");
}

/**
 * The shared consolidated "Fee" receipt row (POO-445 R4/R5). Sums `lines` into the row value and
 * wires the info (ⓘ) tooltip — rich {@link FeeBreakdownBody} body plus the flat {@link feeFlatLabel}
 * accessible name. Deliberately toneless: fees are neutral, never `negative` (red). Every modal
 * builds its "Fee" row through this so a change lands everywhere at once.
 */
export function buildFeeRow({
  label,
  lines,
  totalLabel,
}: {
  /** The row's left-hand label, e.g. the translated "Fee". */
  label: string;
  /** The fee components to sum and break down. */
  lines: FeeLine[];
  /** The translated "Total" label used in the tooltip body/name. */
  totalLabel: string;
}): ReceiptRowItem {
  // Display-only lines (e.g. Bridge "coming soon") carry no real figure, so they stay out of the sum.
  const totalUsd = lines.reduce((sum, line) => sum + (line.display == null ? line.usd : 0), 0);
  return {
    label,
    value: formatUsd(totalUsd),
    tooltip: {
      label: feeFlatLabel(lines, totalLabel, totalUsd),
      body: <FeeBreakdownBody lines={lines} totalLabel={totalLabel} totalUsd={totalUsd} />,
    },
  };
}

/** The already-translated labels of the canonical fee tooltip (POO-800 R2). */
export interface CanonicalFeeLabels {
  dex: string;
  network: string;
  protocol: string;
  performance: string;
  bridge: string;
  /** The Bridge placeholder's display text, e.g. "Coming soon". */
  comingSoon: string;
}

/**
 * The ONE canonical fee tooltip's lines, in order (POO-800 R2): DEX · Network · Protocol ·
 * Performance · Bridge. A line renders only when its figure exists — pass `undefined` when a value
 * is unavailable or not applicable; NEVER a fabricated number (POO-799 global directive #1). Feed
 * the result to {@link buildFeeRow}, which sums the real figures and appends the Total when more
 * than one line shows.
 */
export function buildCanonicalFeeLines({
  labels,
  dexUsd,
  networkUsd,
  protocolUsd,
  performanceUsd,
  crossChain = false,
  bridgeUsd,
}: {
  labels: CanonicalFeeLabels;
  /**
   * PP-INTEGRATION-POINT: the DEX fee is the swap ROUTE's fee from the build response (POO-521,
   * backend); until that field lands, real mode has no figure and the line stays hidden. The
   * removed 0.05% hardcoded fallback must not come back (POO-799 decision #1).
   */
  dexUsd?: number;
  /** Network gas in USD, from the build's `estimatedGasInUsd`. */
  networkUsd?: number;
  /**
   * Protocol fee in USD — the build's `swapInfo.protocolFee` once it exists, or the invest
   * Review's pre-build estimate from the API-served rate (POO-905 R3: `amount × protocolFeePct /
   * 100`). Never a client-side constant (POO-799 decision #1).
   */
  protocolUsd?: number;
  /**
   * PP-INTEGRATION-POINT: the performance fee charged on collect, in USD, from the backend
   * (POO-811). Collect receipts only (POO-799 decision #3).
   */
  performanceUsd?: number;
  /** The Bridge line renders on cross-chain flows only (POO-799 decision #2). */
  crossChain?: boolean;
  /**
   * The bridge's own fee in USD, from the provisioning cost model (`bridgeFeeTooltipInput`,
   * PP-CORE-LIB-056, UF-13 [R5]). Present: a real line that counts toward the Total, like every
   * other fee. Absent: the "Coming soon" placeholder stands, which is what a cross-chain flow with
   * no quoted spread must show. Never pass a fallback here (POO-799 global directive #1).
   */
  bridgeUsd?: number;
}): FeeLine[] {
  return [
    ...(dexUsd != null ? [{ key: "dex", label: labels.dex, usd: dexUsd }] : []),
    ...(networkUsd != null ? [{ key: "network", label: labels.network, usd: networkUsd }] : []),
    ...(protocolUsd != null ? [{ key: "protocol", label: labels.protocol, usd: protocolUsd }] : []),
    ...(performanceUsd != null
      ? [{ key: "performance", label: labels.performance, usd: performanceUsd }]
      : []),
    // R3 / UF-13 R5: a real quoted fee when the cost model has one, else the display-only
    // placeholder. Never a fabricated figure, and the placeholder never joins the Total sum.
    ...(crossChain
      ? [
          bridgeUsd != null
            ? { key: "bridge", label: labels.bridge, usd: bridgeUsd }
            : { key: "bridge", label: labels.bridge, usd: 0, display: labels.comingSoon },
        ]
      : []),
  ];
}

/**
 * The shared "Max. slippage" detail row of the collapsible Review/Receipt card (POO-800 R1). With
 * `autoLabel` set (the untouched default), the percent carries an "Auto" badge, Uniswap-style; a
 * custom slippage renders the plain percent (POO-799 decision #7). Toneless like every fee row.
 */
export function buildMaxSlippageRow({
  label,
  slippagePct,
  autoLabel,
}: {
  /** The row's translated label, e.g. "Max. slippage". */
  label: string;
  /** The gear slippage, rendered as entered (mirrors the review captions' `{rate}%`). */
  slippagePct: number;
  /** Translated "Auto" badge text; present only while the default slippage applies. */
  autoLabel?: string;
}): ReceiptRowItem {
  const percent = `${slippagePct}%`;
  const value: ReactNode = autoLabel ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground leading-none">
        {autoLabel}
      </span>
      {percent}
    </span>
  ) : (
    percent
  );
  return { label, value };
}

/**
 * The shared "Price impact" Review row (POO-612 R1 / POO-613 R2). Formats the swap's price impact and
 * turns the row amber (`warning` tone) at or above {@link HIGH_PRICE_IMPACT_PCT}, flagging a costly
 * swap on the clear-signing screen without blocking. Every handshake modal builds the row through this
 * so the threshold + formatting stay in one place.
 */
export function buildPriceImpactRow(label: string, priceImpactPercentage: number): ReceiptRowItem {
  return {
    label,
    value: formatPercent(priceImpactPercentage, 2),
    tone: priceImpactPercentage >= HIGH_PRICE_IMPACT_PCT ? "warning" : "default",
  };
}
