/**
 * @id PP-MGR-CMP-029
 * @name AllocationCard
 * @implements-rules-version v1
 *
 * The manage-detail "Allocation" card (Figma `5526:922`): how the strategy's deployed capital is
 * split across protocols and tokens. V1 is a lighter read-only breakdown — protocol rows with a thin
 * share bar plus a compact token line.
 *
 * POO-563 (rules v1): the figures are REAL in V1 — a strategy IS one Uniswap v3 position, so the
 * token split is derived CLIENT-SIDE from the position's raw reserves (see {@link mapManagerStrategyDetail}
 * → {@link buildManagerAllocation}) and `protocols` is a single 100% Uniswap v3 row; no indexer needed.
 * The card renders only when `allocation` exists (absent reserves → the mapper returns undefined and
 * the card hides). POO-380 tracks the FUTURE multi-protocol / indexer-balance version (many rows).
 */
"use client";

import { useTranslations } from "next-intl";
import { ProtocolBadge } from "@/components/data-display/ProtocolBadge";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import type { ManagerAllocation } from "@/lib/schemas";
import { formatPercent } from "@/lib/utils/format";

/** Public props for {@link AllocationCard}. */
export interface AllocationCardProps {
  /** The strategy's protocol + token allocation. */
  allocation: ManagerAllocation;
  /** Pool network slug (e.g. "arbitrum") for the per-token logos (POO-739); majors resolve network-free. */
  network?: string | null;
}

/** The deployed-capital allocation card. */
export function AllocationCard({ allocation, network }: AllocationCardProps) {
  const t = useTranslations("manager");
  return (
    <CollapsibleCard title={t("manage.allocation.title")}>
      <div className="flex flex-col gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("manage.allocation.protocols")}
        </p>
        <ul className="flex flex-col gap-2.5">
          {allocation.protocols.map((slice) => (
            <li key={slice.label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                {/* POO-739: the protocol logo (V1 is Uniswap v3; only its art exists). An unknown
                    label keeps the plain text. */}
                {slice.label.toLowerCase().includes("uniswap") ? (
                  <ProtocolBadge className="text-foreground" />
                ) : (
                  <span className="text-foreground">{slice.label}</span>
                )}
                <span className="font-medium text-muted-foreground">
                  {formatPercent(slice.pct, 0)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${slice.pct}%` }}
                  aria-hidden="true"
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {allocation.tokens.length > 0 ? (
        <div className="flex flex-col gap-2.5 border-border border-t pt-4">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("manage.allocation.tokens")}
          </p>
          {/* POO-739: per-token rows with a token logo, replacing the old single joined text line. */}
          <ul className="flex flex-col gap-2">
            {allocation.tokens.map((slice) => (
              <li key={slice.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-foreground">
                  <TokenLogo
                    symbol={slice.label}
                    network={network}
                    className="size-5 text-[10px]"
                  />
                  {slice.label}
                </span>
                <span className="font-medium text-muted-foreground">
                  {formatPercent(slice.pct, 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </CollapsibleCard>
  );
}
