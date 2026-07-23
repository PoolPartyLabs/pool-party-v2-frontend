/**
 * @id PP-STR-CMP-017
 * @name SinglePoolProspectus
 * @implements-rules-version v1 · v1 (POO-897: per-token composition split) · v1 (POO-903: cards collapsed by default)
 *
 * The Composition + Investment-mandate cards for a V1 single-pool (Uniswap v3) strategy, DERIVED from
 * real pool data only — the position is 100% a liquidity pool of its pair tokens. Shared by the
 * manager strategy-detail and the investor strategy-detail so both read the same, and both stay
 * truthful in real mode (no fabricated prospectus — see #244). When the pool pair is unknown the
 * cards show a "not available" note instead of inventing data (murilo 2026-06-29).
 *
 * POO-897 (rules v1): an optional `split` renders the per-token PROPORTION in the Composition card -
 * one row per pair token (logo + symbol + integer percent, [R1]/[R6]) over a proportional two-tone
 * bar, the same visual language as the mock multi-slice composition and {@link TokenSplitBar}. The
 * percentages are display-only estimates computed upstream ({@link strategyCompositionSplit} /
 * the manager allocation, [R7]); absent/null keeps today's single "Liquidity pool 100%" row ([R4]).
 *
 * POO-903 (rules v1): both cards start COLLAPSED (`defaultOpen={false}`, [R1]) — the header toggle
 * (CollapsibleCard's aria-expanded button, [R4]) expands them; the state is per-visit local
 * component state, never persisted ([R3]).
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { ProtocolBadge } from "@/components/data-display/ProtocolBadge";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { cn } from "@/lib/utils/cn";
import { formatPercent } from "@/lib/utils/format";

/** Public props for {@link SinglePoolProspectus}. */
export interface SinglePoolProspectusProps {
  /** The pool's pair tokens; `null`/absent → the cards show the "not available" note. */
  tokens?: { token0: string; token1: string } | null;
  /** Network display name (e.g. "Arbitrum"); omitted hides the Networks row. */
  networkName?: string | null;
  /**
   * Network slug (e.g. "arbitrum") for the network + token logos (POO-739). Majors resolve
   * network-free; the slug is needed for NetworkLogo and the non-major token-list fallback.
   */
  network?: string | null;
  /**
   * The pool position's per-token value split (POO-897 [R1]): raw percentages summing to 100,
   * token0 first (they size the bar; the rows round to integers via `formatPercent(x, 0)`, [R6]).
   * Absent/null → the single "Liquidity pool 100%" row ([R4], never fabricated).
   */
  split?: { pct0: number; pct1: number } | null;
}

/** An uppercase mandate sub-heading. */
function MandateLabel({ children }: { children: string }) {
  return (
    <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
      {children}
    </p>
  );
}

/** A `label — value` mandate row, with an optional leading icon (e.g. a token logo). */
function MandateRow({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

/** One per-token Composition row: legend dot (bar tone) + token logo + symbol + integer percent. */
function SplitRow({
  symbol,
  network,
  pct,
  tone,
}: {
  symbol: string;
  network?: string | null;
  pct: number;
  tone: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-foreground">
        <span className={cn("size-2.5 rounded-full", tone)} aria-hidden="true" />
        <TokenLogo symbol={symbol} network={network} className="size-5 text-[10px]" />
        {symbol}
      </span>
      <span className="font-medium text-muted-foreground">{formatPercent(pct, 0)}</span>
    </li>
  );
}

/** Composition + Investment-mandate cards derived from the pool. See {@link SinglePoolProspectusProps}. */
export function SinglePoolProspectus({
  tokens,
  networkName,
  network,
  split,
}: SinglePoolProspectusProps) {
  const t = useTranslations("strategies");
  const full = formatPercent(100, 0);
  const noData = <p className="text-muted-foreground text-sm">{t("detail.noData")}</p>;
  return (
    <>
      {/* Composition: a single-pool strategy is 100% a liquidity-pool position. With a resolved
          split (POO-897 [R1]) the card shows the per-token proportion; without one it degrades to
          the single "Liquidity pool 100%" row ([R4], never fabricated). Starts collapsed
          (POO-903 [R1]). */}
      <CollapsibleCard title={t("detail.composition")} defaultOpen={false}>
        {tokens && split ? (
          <>
            {/* Two-tone proportional bar, raw (unrounded) percents so it stays proportional. */}
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              <span className="bg-primary" style={{ width: `${split.pct0}%` }} aria-hidden="true" />
              <span className="bg-info" style={{ width: `${split.pct1}%` }} aria-hidden="true" />
            </div>
            <ul className="flex flex-col gap-2">
              <SplitRow
                symbol={tokens.token0}
                network={network}
                pct={split.pct0}
                tone="bg-primary"
              />
              <SplitRow symbol={tokens.token1} network={network} pct={split.pct1} tone="bg-info" />
            </ul>
          </>
        ) : tokens ? (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              <span className="w-full bg-primary" aria-hidden="true" />
            </div>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-foreground">
                  <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
                  {t("detail.liquidityPool")}
                </span>
                <span className="font-medium text-muted-foreground">{full}</span>
              </li>
            </ul>
          </>
        ) : (
          noData
        )}
      </CollapsibleCard>

      {/* Investment mandate — the pair tokens, Uniswap v3, the network. Max exposure is 100% per
          token (a v3 LP can sit fully in either side). Starts collapsed (POO-903 [R1]). */}
      <CollapsibleCard title={t("detail.mandate.title")} defaultOpen={false}>
        {tokens ? (
          <>
            <div>
              <MandateLabel>{t("detail.mandate.assets")}</MandateLabel>
              <div className="flex flex-col divide-y divide-border">
                <MandateRow
                  icon={
                    <TokenLogo
                      symbol={tokens.token0}
                      network={network}
                      className="size-5 text-[10px]"
                    />
                  }
                  label={tokens.token0}
                  value={full}
                />
                <MandateRow
                  icon={
                    <TokenLogo
                      symbol={tokens.token1}
                      network={network}
                      className="size-5 text-[10px]"
                    />
                  }
                  label={tokens.token1}
                  value={full}
                />
              </div>
            </div>
            <div>
              <MandateLabel>{t("detail.mandate.protocols")}</MandateLabel>
              {/* POO-739: the protocol logo + name. "Uniswap v3" is a proper noun (never translated);
                  V1 is single-protocol. */}
              <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
                <ProtocolBadge className="text-muted-foreground" />
                <span className="font-medium text-foreground">{full}</span>
              </div>
            </div>
            {networkName ? (
              <div>
                <MandateLabel>{t("detail.mandate.networks")}</MandateLabel>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-foreground text-xs">
                    {/* POO-739: the network logo beside its name (needs the slug; text-only otherwise). */}
                    {network ? (
                      <NetworkLogo network={network} name={networkName} size={14} />
                    ) : null}
                    {networkName}
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          noData
        )}
      </CollapsibleCard>
    </>
  );
}
