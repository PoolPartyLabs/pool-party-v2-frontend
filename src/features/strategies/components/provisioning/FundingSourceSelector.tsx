/**
 * @id PP-STR-CMP-023
 * @name FundingSourceSelector
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1039: the product idea of the Universal Funding epic, in one control. **The user picks what to
 * SPEND; the app works out the route.** Nobody is asked which network to bridge from, which token to
 * swap, or in what order: they pick money, and `buildPlan` (POO-1034) turns the picks into legs.
 *
 * Multi-select over every holding the wallet has across Arbitrum, Base and Polygon, each row carrying
 * the gas verdict of its chain [R2] and a running total against what the operation needs, with the
 * remaining shortfall (or the surplus) always on screen [R1].
 *
 * ## Two decisions that look like details and are not
 *
 * **A BLOCKED row is shown, greyed and EXPLAINED, never hidden** [R2/R3]. A chain with no native coin
 * cannot originate a transaction, so it cannot fund anything; dropping the row would be tidier and
 * would make the user's own money look like it does not exist. It stays, it says why, and it says
 * what would unblock it (send a little native in from another network, or buy crypto) straight from
 * the classifier's escapes (POO-1032 [R3]). It is also `aria-disabled` rather than `disabled`, so it
 * keeps its place in the tab order and a screen reader reaches the explanation [R7].
 *
 * **Selection order is route order** [R4]. `buildPlan` consumes sources in the order it receives
 * them, so picks append rather than re-sort, and each selected row shows its step number. What the
 * user sees is what executes.
 *
 * ## Boundaries
 *
 * Presentational and controlled: the selection, the inventory and the verdicts are props, and the
 * host (POO-1042) owns the state and the wiring into the provisioning gate. It renders a token+chain
 * row the way {@link WalletModal} already does, down to {@link NetworkLogo} and `resolveTokenLogo`,
 * because a user should not have to learn a second visual grammar for their own balances.
 *
 * Money: `usd` figures are display-grade and the requirement already includes fees and buffer, so the
 * running total is the only arithmetic here. It runs in integer micro-dollars inside
 * {@link fundingProgress}; token amounts stay base-unit strings until the moment they are formatted.
 */
"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
// Type-only, therefore erased at compile time: `fundingInventory.ts` is `server-only` and this is a
// client component. Never let this become a value import (ADR 0003) — the inventory reaches the
// browser through `getFundingInventoryAction`, never through this module.
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { apiNetworkForChain, nativeSymbol } from "@/lib/chains/config";
import type { GasFeasibility } from "@/lib/provisioning";
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { toTokenAmount } from "@/lib/uniswap/amount";
import { cn } from "@/lib/utils/cn";
import { formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { networkColor, networkName, networkSlug } from "../../../wallet/networks";
import {
  fundingProgress,
  fundingSourceKey,
  isSelectableVerdict,
  reachesChain,
  toggleFundingSource,
} from "./fundingSelection";

/** Public props for {@link FundingSourceSelector}. */
export interface FundingSourceSelectorProps {
  /**
   * Everything the wallet can pay with, in display order (the inventory returns it most-valuable
   * first). Rendered verbatim: sub-$1 dust is already filtered upstream and re-filtering here with a
   * second threshold is exactly how two surfaces start disagreeing about what the user owns [R6].
   *
   * PP-INTEGRATION-POINT: produced by `getFundingInventoryAction` (PP-CORE-LIB-053), the live
   * intersection of the wallet's multi-chain holdings with Uniswap's routable tokens.
   */
  sources: readonly FundingSource[];
  /**
   * The gas verdict of each candidate chain, keyed by chain id (POO-1032). A chain absent from the
   * map renders without a badge and stays selectable: see {@link isSelectableVerdict} for why a
   * failed classification must not read as a blocked one.
   */
  gasByChainId: Readonly<Record<number, GasFeasibility>>;
  /**
   * What the operation needs, in USD, **fees and buffer included** — the plan's `totalPayUsd`, not
   * the bare shortfall. The CTA gate is only honest if the figure it compares against is the one the
   * user will actually be charged [R5].
   */
  requiredUsd: number;
  /**
   * The chain the operation runs on (POO-1042 [R8]). When set, a holding whose
   * {@link FundingSource.reachableChainIds} does not include it is rendered greyed and explained
   * rather than dropped, for the same reason a BLOCKED row is: the user's own money must not look
   * like it does not exist. Omitted, every row is routable as far as this component knows, which is
   * the POO-1039 behavior.
   */
  targetChainId?: number;
  /** The selected source keys, in pick order, which is route order [R4]. Controlled. */
  selected: readonly string[];
  /** Called with the next selection on every toggle. */
  onSelectedChange: (next: string[]) => void;
  /** The user confirmed a covering selection. Only reachable while the CTA is enabled [R5]. */
  onConfirm: () => void;
  className?: string;
}

/** Badge tone per verdict. Never color alone: each badge carries its own words. */
const BADGE_CLASS = {
  OK: "border-success/40 bg-success/10 text-success",
  TOP_UP: "border-warning/40 bg-warning/10 text-warning",
  BLOCKED: "border-border bg-surface-raised text-muted-foreground",
} as const;

/** i18n key of the short badge label for a verdict. */
const BADGE_KEY = {
  OK: "provisioning.fundingSources.badge.ok",
  TOP_UP: "provisioning.fundingSources.badge.topUp",
  BLOCKED: "provisioning.fundingSources.badge.blocked",
} as const;

/** Pick what to spend; the app works out the route. See {@link FundingSourceSelectorProps}. */
export function FundingSourceSelector({
  sources,
  gasByChainId,
  requiredUsd,
  targetChainId,
  selected,
  onSelectedChange,
  onConfirm,
  className,
}: FundingSourceSelectorProps) {
  const t = useTranslations("strategies");
  const listId = useId();
  const progress = fundingProgress(sources, selected, requiredUsd);
  // [R5] Coverage alone is not enough: a zero requirement is trivially covered, and confirming with
  // nothing picked would hand the planner an empty route.
  const canConfirm = progress.covered && selected.length > 0;
  const statusId = `${listId}-status`;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div>
        <h3 className="font-semibold text-foreground text-lg">
          {t("provisioning.fundingSources.title")}
        </h3>
        <p className="mt-1 text-muted-foreground text-sm">
          {t("provisioning.fundingSources.subtitle")}
        </p>
      </div>

      {/* [R1] The running total. `aria-live="polite"` because it changes under the user's own
          actions and a money figure they cannot see is a money figure they cannot check. */}
      <div
        aria-live="polite"
        className="flex flex-col gap-1 rounded-xl bg-surface-raised px-4 py-3"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-foreground text-sm">
            {t("provisioning.fundingSources.selected", { amount: formatUsd(progress.selectedUsd) })}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("provisioning.fundingSources.required", {
              amount: formatUsd(progress.requiredUsd),
            })}
          </span>
        </div>
        <p
          id={statusId}
          className={cn("text-sm", progress.covered ? "text-success" : "text-muted-foreground")}
        >
          {progress.covered
            ? progress.surplusUsd > 0
              ? t("provisioning.fundingSources.surplus", {
                  amount: formatUsd(progress.surplusUsd),
                })
              : t("provisioning.fundingSources.exact")
            : t("provisioning.fundingSources.remaining", {
                amount: formatUsd(progress.remainingUsd),
              })}
        </p>
      </div>

      {sources.length === 0 ? (
        <p className="rounded-xl border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          {t("provisioning.fundingSources.empty")}
        </p>
      ) : (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t("provisioning.fundingSources.listLabel")}
          className="flex flex-col gap-2"
        >
          {sources.map((source) => {
            const key = fundingSourceKey(source);
            const position = selected.indexOf(key);
            return (
              <SourceRow
                key={key}
                source={source}
                feasibility={gasByChainId[source.chainId]}
                // [R8] Routability is a property of the token AND the destination, so it can only be
                // judged with the operation's chain in hand.
                unreachable={targetChainId !== undefined && !reachesChain(source, targetChainId)}
                position={position}
                onToggle={() => onSelectedChange(toggleFundingSource(selected, key))}
              />
            );
          })}
        </div>
      )}

      {/* The CTA describes itself with the shortfall line, so a screen-reader user who lands on a
          disabled button is told what is missing rather than just that it is unavailable. */}
      <Button
        className="w-full"
        size="lg"
        disabled={!canConfirm}
        aria-describedby={statusId}
        onClick={onConfirm}
      >
        {t("provisioning.fundingSources.cta")}
      </Button>
    </div>
  );
}

/**
 * One holding: token + network identity, balance, gas verdict, and its route position when picked.
 *
 * `role="option"` inside the parent listbox (the repo's established multi-select pattern, see
 * `CategoryFilter`). The accessible NAME is an explicit sentence rather than the row's raw text, so
 * it reads as a person would say it ("USDC on Base, 1,200 USDC, worth $1,200.00"); the badge, the
 * verdict explanation and the step number ride along as the accessible DESCRIPTION [R7].
 */
function SourceRow({
  source,
  feasibility,
  unreachable,
  position,
  onToggle,
}: {
  source: FundingSource;
  feasibility: GasFeasibility | undefined;
  /** POO-1042 [R8]: this holding cannot be routed to the operation's chain. */
  unreachable?: boolean;
  /** Index in the selection, or `-1` when unselected. Its 1-based form is the route step [R4]. */
  position: number;
  onToggle: () => void;
}) {
  const t = useTranslations("strategies");
  const rowId = useId();
  const verdict = feasibility?.verdict;
  // Two independent reasons a row cannot be spent from: the chain cannot pay its own gas, or the
  // token cannot reach the destination. Both grey the row; each states its own cause.
  const selectable = isSelectableVerdict(verdict) && !unreachable;
  const isSelected = position >= 0;

  const slug = networkSlug(source.chainId);
  const network = networkName(source.chainId);
  // Committed token art first (PP-CORE-LIB-021), then the feed's URL, then a symbol chip — the same
  // ladder the wallet modal walks, so one token never has two looks.
  const tokenLogo = resolveTokenLogo(source.symbol, slug) ?? source.logoUrl;
  const amount = formatTokenAmount(
    toTokenAmount(source.amount, source.decimals),
    source.symbol,
    source.decimals <= 6 ? 2 : 4,
  );

  // The verdict copy is interpolated with the chain's native symbol and, for a top-up, the holding
  // the gas slice comes from. Both come from the shared chain config, never a local literal.
  const native = nativeSymbol(apiNetworkForChain(source.chainId));
  // [R8] Unreachability wins the explanation: a chain's gas verdict is irrelevant to a holding that
  // cannot get to the destination at all.
  const reason = unreachable
    ? t("provisioning.fundingSources.unreachable", { symbol: source.symbol })
    : verdict === "TOP_UP" || verdict === "BLOCKED"
      ? t(feasibility?.reasonKey ?? "", {
          symbol: native,
          network,
          token: feasibility?.topUp?.token.symbol ?? "",
        })
      : null;
  const escapes = !unreachable && verdict === "BLOCKED" ? (feasibility?.escapes ?? []) : [];

  const badgeId = `${rowId}-badge`;
  const reasonId = `${rowId}-reason`;
  const stepId = `${rowId}-step`;
  const describedBy = [
    isSelected ? stepId : null,
    verdict ? badgeId : null,
    reason ? reasonId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      // `aria-disabled`, not `disabled`: a blocked row must stay focusable so its reason and its two
      // escapes are reachable. Greying it out and removing it from the tab order would leave a
      // screen-reader user with no way to find out why their money is unavailable [R3][R7].
      aria-disabled={selectable ? undefined : true}
      aria-describedby={describedBy || undefined}
      aria-label={t("provisioning.fundingSources.rowLabel", {
        symbol: source.symbol,
        network,
        amount,
        usd: formatUsd(source.usd),
      })}
      onClick={selectable ? onToggle : undefined}
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border px-3 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected ? "border-primary bg-primary/5" : "border-border",
        selectable ? "hover:border-muted-foreground/40" : "cursor-not-allowed opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          {tokenLogo ? (
            // Decorative: the row's accessible name already carries the token and the network.
            <img
              src={tokenLogo}
              alt=""
              aria-hidden="true"
              className="size-9 rounded-full bg-surface-raised object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-surface-raised font-semibold text-[10px] text-muted-foreground"
            >
              {source.symbol.slice(0, 3).toUpperCase()}
            </span>
          )}
          <NetworkLogo
            network={slug}
            name={network}
            size={14}
            fallbackColor={networkColor(source.chainId)}
            className="absolute right-0 bottom-0 ring-2 ring-surface"
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground text-sm">{source.symbol}</p>
            {verdict ? (
              <span
                id={badgeId}
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 font-medium text-[10px]",
                  BADGE_CLASS[verdict],
                )}
              >
                {t(BADGE_KEY[verdict])}
              </span>
            ) : null}
          </div>
          <p className="truncate text-muted-foreground text-xs">{network}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-medium text-foreground text-sm">{amount}</p>
          <p className="text-muted-foreground text-xs">{formatUsd(source.usd)}</p>
        </div>

        {/* [R4] The route position, so the order the user built is the order they can read back. */}
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px]",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-transparent",
          )}
        >
          {isSelected ? (
            <span id={stepId} className="font-semibold">
              {position + 1}
              <span className="sr-only">
                {t("provisioning.fundingSources.step", { index: position + 1 })}
              </span>
            </span>
          ) : (
            <Check className="size-3 opacity-0" aria-hidden="true" />
          )}
        </span>
      </div>

      {/* [R2][R3] The verdict, in words, under the row it belongs to. A blocked row also lists what
          would unblock it, straight from the classifier rather than re-decided here. */}
      {reason ? (
        <div id={reasonId} className="flex flex-col gap-1 text-muted-foreground text-xs">
          <p>{reason}</p>
          {escapes.length > 0 ? (
            <>
              <p className="font-medium text-foreground">
                {t("provisioning.fundingSources.unblock")}
              </p>
              {escapes.map((unblock) => (
                <p key={unblock.kind}>{t(unblock.labelKey, { symbol: native })}</p>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
