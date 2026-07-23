/**
 * @id PP-MGR-CMP-001
 * @name LivePositionCard
 * @implements-rules-version v1
 *
 * The manager's live Uniswap v3 position panel (operate surface). Read-only summary — pair, network,
 * fee tier, in/out-of-range state, range, current price, deployed liquidity, fee APR and uncollected
 * fees — plus the V1 manager actions: Collect fees and Compound (manual). Capital is always 100%
 * deployed in V1, so there is no Increase/Decrease liquidity and no Auto-compound toggle. The manager
 * pays the network gas for actions (shown). Every action confirms first: Move Range opens its own
 * modal (new range + slippage); Collect opens the investor Collect dialog in manager mode
 * (POO-286 R1); Compound opens the shared confirm/success modal (PP-MGR-MOD-002).
 *
 * POO-236: the in/out-of-range state derives from the shared `getRangeStatus` util (the single source
 * of truth for the range rule — inclusive bounds, full-range always in — across the builder, the
 * manage-detail RangeCard and this live surface), rather than re-deriving the comparison inline.
 *
 * POO-518 R2: a FULL move (the result carries `full: true` + the fullRangeTicks-derived bounds)
 * renders its full-range representation — the success notice says full range and the Range reading
 * flips to "Full range" (always in range) — instead of echoing the previous band.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { Button } from "@/components/ui/Button";
import { CollectModal } from "@/features/strategies/components/CollectModal";
import type { ManagerPosition } from "@/lib/schemas";
import { managerService } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { getRangeStatus } from "@/lib/utils/rangeStatus";
import { ManagerActionModal } from "./ManagerActionModal";
import { MoveRangeModal } from "./MoveRangeModal";

/** Public props for {@link LivePositionCard}. */
export interface LivePositionCardProps {
  /** The manager's live position to operate. */
  position: ManagerPosition;
}

type Notice = { tone: "success" | "error"; text: string } | null;

/** Manager live position card — read-only summary + Collect / Compound / Move Range. */
export function LivePositionCard({ position }: LivePositionCardProps) {
  const t = useTranslations("manager");
  const [collectOpen, setCollectOpen] = useState(false);
  const [compoundOpen, setCompoundOpen] = useState(false);
  const [uncollected, setUncollected] = useState(position.uncollectedFeesUsd);
  const [notice, setNotice] = useState<Notice>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  // The live band. `full` flips after a full-range move (POO-518 R2): the reading shows the
  // full-range representation instead of the derived extreme bounds.
  const [range, setRange] = useState({
    min: position.rangeMin,
    max: position.rangeMax,
    full: false,
  });

  // Single source of truth for the range rule (POO-236): min/max band inclusive; full always in.
  const inRange =
    getRangeStatus(position.currentPrice, {
      full: range.full,
      minPrice: range.min,
      maxPrice: range.max,
    }) === "in";
  const nothingToCollect = uncollected <= 0;
  const price = (value: number) => formatTokenAmount(value, position.token1);

  // Runs inside the confirm modal (PP-MGR-MOD-002); the returned message feeds its success view.
  async function runCompound(): Promise<string> {
    const result = await managerService.compound(position.strategyId);
    setUncollected(0);
    return t("operate.compounded", { amount: formatUsd(result.compoundedUsd) });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      {/* Header: pair + network + fee tier, with the range-state badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold text-foreground">
            {position.token0}/{position.token1}
          </p>
          <p className="text-muted-foreground text-xs">
            {position.networkName} ·{" "}
            {t("operate.feeTier", { pct: formatPercent(position.feeBps / 100, 2) })}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs",
            inRange ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {inRange ? t("operate.inRange") : t("operate.outOfRange")}
        </span>
      </div>

      {/* Summary grid */}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">{t("operate.range")}</dt>
          <dd className="font-medium text-foreground">
            {/* POO-518 R2: a full-range position reads "Full range", not the derived extremes. */}
            {range.full ? t("manage.range.full") : `${price(range.min)} – ${price(range.max)}`}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">{t("operate.currentPrice")}</dt>
          <dd className="font-medium text-foreground">{price(position.currentPrice)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">{t("operate.liquidity")}</dt>
          <dd className="font-medium text-foreground">{formatUsd(position.liquidityUsd)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">
            <AprTooltip>{t("operate.feeApr")}</AprTooltip>
          </dt>
          <dd className="font-medium text-success">{formatPercent(position.feeAprPct)}</dd>
        </div>
      </dl>

      {/* Out-of-range alert — drives the (coming-soon) Move Range action */}
      {inRange ? null : (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-xs">
          {t("operate.outOfRangeNote")}
        </p>
      )}

      {/* Uncollected fees */}
      <div className="flex items-center justify-between rounded-lg bg-background px-3 py-2.5">
        <span className="text-muted-foreground text-sm">{t("operate.uncollected")}</span>
        <span className="font-semibold text-foreground">{formatUsd(uncollected)}</span>
      </div>

      {notice ? (
        <p
          className={cn("text-xs", notice.tone === "success" ? "text-success" : "text-destructive")}
        >
          {notice.text}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        {t("operate.gasNote", { amount: formatUsd(position.gasCostUsd) })}
      </p>

      {/* Actions — all manager-signed; the manager pays gas. Each opens a confirm modal. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setCollectOpen(true)} disabled={nothingToCollect}>
          {t("operate.collect")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setCompoundOpen(true)}
          disabled={nothingToCollect}
        >
          {t("operate.compound")}
        </Button>
        <Button
          variant="secondary"
          className="ml-auto border border-primary/40"
          onClick={() => setMoveOpen(true)}
        >
          {t("operate.moveRange")}
        </Button>
      </div>

      <CollectModal
        open={collectOpen}
        onOpenChange={setCollectOpen}
        managed={{
          strategyId: position.strategyId,
          name: `${position.token0}/${position.token1}`,
          initials: position.token0.charAt(0),
          poolLabel: `${position.networkName} · ${t("operate.feeTier", {
            pct: formatPercent(position.feeBps / 100, 2),
          })}`,
          availableUsd: uncollected,
          gasEstimateUsd: position.gasCostUsd,
          // POO-516 R2: the pool's own fee tier — the INTERIM DEX-fee source for the minimum math.
          feeBps: position.feeBps,
          // POO-478 R2: mock-only path (zero-arg onCollect), so the gear slippage is not consumed here.
          onCollect: async () => {
            await managerService.collectFees(position.strategyId);
            setUncollected(0);
            // POO-505 R4: the mock console has no tx, so there is no hash to return.
            return undefined;
          },
        }}
      />

      <ManagerActionModal
        open={compoundOpen}
        onOpenChange={(open) => {
          if (!open) setCompoundOpen(false);
        }}
        title={t("confirm.compoundTitle")}
        description={t("confirm.compoundBody")}
        details={[{ label: t("operate.uncollected"), value: formatUsd(uncollected) }]}
        gasCostUsd={position.gasCostUsd}
        confirmLabel={t("operate.compound")}
        onConfirm={runCompound}
      />

      <MoveRangeModal
        open={moveOpen}
        onOpenChange={setMoveOpen}
        position={position}
        currentMin={range.min}
        currentMax={range.max}
        onMoved={(result) => {
          // POO-518 R2: the result's bounds are the APPLIED range — for a full move, the
          // fullRangeTicks-derived prices — so the reading updates either way; the full notice
          // uses the full-range representation instead of the derived extreme numbers.
          setRange({ min: result.rangeMin, max: result.rangeMax, full: result.full });
          setNotice({
            tone: "success",
            text: result.full
              ? t("operate.movedFull")
              : t("operate.moved", {
                  min: price(result.rangeMin),
                  max: price(result.rangeMax),
                }),
          });
        }}
      />
    </div>
  );
}
