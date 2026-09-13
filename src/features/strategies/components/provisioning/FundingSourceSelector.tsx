/**
 * @id PP-STR-CMP-023 (POO-1155, POO-1502, POO-1503, POO-1525, POO-1526, POO-1528, POO-1535)
 * @name FundingSourceSelector
 * @implements-rules-version v9 (POO-1535 rules v1) · v8 (POO-1528 rules v1) · v7 (POO-1526 rules v1) · v6 (POO-1525 rules v1) · v5 (POO-1503 rules v1) · v4 (POO-1502 rules v1) · v3 (POO-1155 / POO-1129 rules v3) · v2 (POO-1086 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1039: the product idea of the Universal Funding epic, in one control. **The user picks what to
 * SPEND; the app works out the route.** Nobody is asked which network to bridge from, which token to
 * swap, or in what order: they pick money, and `buildPlan` (POO-1034) turns the picks into legs.
 *
 * Step 2 of the provisioning flow, "Choose tokens to convert" (Figma `6548:569`, `7354:766`).
 *
 * ## v4 (POO-1502): every row on screen is a row you can take
 *
 * The screen used to render the wallet and then explain, row by row, which parts of it were
 * unusable. It now renders only {@link spendableSources} ([R11]), and that single change removes
 * three things at once: the greyed `BLOCKED` row, the verdict badge on every row ([R12]) and the
 * network text line under the symbol ([R13], the network is the badge on the logo and nothing else).
 *
 * **This reverses POO-1032 [R2]/[R3] deliberately, and the cost is real.** That rule said a blocked
 * row is shown, greyed and explained, never hidden, so the user's own money would not look like it
 * does not exist. The flow no longer tells anyone why money they own cannot move. It was taken
 * knowingly on POO-1502 with the whole rule quoted, and it buys a screen where the answer to "can I
 * use this?" is the same for every row, which is what makes a badge on 100% of rows pointless rather
 * than reassuring. `TOP_UP` rows stay: the planner prepends the swap that fixes them, so that money
 * IS spendable, and hiding it would hide usable funds.
 *
 * **`Convert everything` became `Convert what's needed`** ([R15]), and the rename is the behaviour.
 * See {@link fillToTarget}: biggest first, stop at the target. The old shortcut converted holdings
 * the operation had no use for, and every conversion is a real swap with a real fee.
 *
 * **The buffer is now disclosed at rest**, above the shortcut, rather than only inside a tooltip on
 * the previous screen. `CR-CORE-014` asks whether a disclosure the user has to open counts as one;
 * this screen does not make them open anything.
 *
 * ## v5 (POO-1503): this screen is the last one before the money moves
 *
 * The Confirm step is gone ([R3]), so the CTA here SIGNS ([R19], `Confirm and start` per D2) and two
 * things follow. The `details` slot is finally filled by the host (the step plan plus the itemised
 * `You pay` block, [R18]), because that is where the Confirm's contents went. And `quoteSeconds` puts
 * the quote's live `Refreshes in {seconds}s` beside the gear: it is the one thing off the deleted
 * screen that had to stay visible rather than go behind the disclosure. The countdown itself is the
 * HOST's (`useReviewCountdown` in `ProvisioningPanel`, ticking whether or not the disclosure is open);
 * this component only prints it, so it can never run a second timer against the same quote.
 *
 * ## Two decisions that look like details and are not
 *
 * **Selection order is route order** [R4]. `buildPlan` consumes sources in the order it receives
 * them, so picks append rather than re-sort, and the fill hands them over biggest-first.
 *
 * **Row order is the inventory's job, not this component's** ([R14]). The inventory arrives
 * most-valuable-first and is rendered verbatim. Re-sorting here for safety is the same mistake as
 * re-filtering for safety: it is how two surfaces start disagreeing about what the user owns.
 *
 * ## Boundaries
 *
 * Presentational and controlled: the selection, the inventory and the verdicts are props, and the
 * host (POO-1042) owns the state and the wiring into the provisioning gate. The settings dialog and
 * the plan detail are the host's too: this component renders the gear ([R17]) and the disclosure
 * ([R18]) and calls back, exactly as the six transactional modals already do with
 * `TransactionSettingsDialog`.
 *
 * Money: `usd` figures are display-grade and the requirement already includes fees and buffer, so the
 * running total is the only arithmetic here. It runs in integer micro-dollars inside
 * {@link fundingProgress}; token amounts stay base-unit strings until the moment they are formatted.
 *
 * POO-1525 (epic POO-1498, rules v1): the Confirm + Cancel pair moved into `StickyActionFooter`
 * (`PP-STR-CMP-027`), pinning state `2`/`2c`'s terminal CTA while the details disclosure above it
 * scrolls.
 *
 * ## Provisioning v3 mobile [M5], POO-1526
 *
 * The `See details` disclosure and the bottom `Cancel` are their own rows, so each gets an EXPLICIT
 * `min-h-11` (M5.2), not an invisible hit area. The gear ([R17]) was deferred to POO-1528 on the
 * assumption the shared `TransactionModalHeader` would always replace it; it only does so below `sm`
 * on a host that mounts that header, so the gear takes the M5.1 invisible hit area for every case
 * that is left (above `sm`, and below it on `MoveRangeModal` / `RemoveLiquidityModal`).
 */
"use client";

import { Check, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
// Type-only, therefore erased at compile time: `fundingInventory.ts` is `server-only` and this is a
// client component. Never let this become a value import (ADR 0003) — the inventory reaches the
// browser through `getFundingInventoryAction`, never through this module.
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility } from "@/lib/provisioning";
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { toTokenAmount } from "@/lib/uniswap/amount";
import { cn } from "@/lib/utils/cn";
import { formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { networkColor, networkName, networkSlug } from "../../../wallet/networks";
import {
  fillToTarget,
  fundingProgress,
  fundingSourceKey,
  spendableSources,
  toggleFundingSource,
} from "./fundingSelection";
import { StickyActionFooter } from "./StickyActionFooter";

/** Public props for {@link FundingSourceSelector}. */
export interface FundingSourceSelectorProps {
  /**
   * Everything the wallet can pay with, in display order (the inventory returns it most-valuable
   * first, which is [R14]). Sub-$1 dust is already filtered upstream and re-filtering here with a
   * second threshold is exactly how two surfaces start disagreeing about what the user owns [R6].
   *
   * [R11] filters this to {@link spendableSources} for RENDERING. That is not a second dust
   * threshold: it is the same predicate the CTA and `resolveFundingRoutes` already gate on, so a
   * rendered row is always a takeable row.
   *
   * PP-INTEGRATION-POINT: produced by `getFundingInventoryAction` (PP-CORE-LIB-053), the live
   * intersection of the wallet's multi-chain holdings with Uniswap's routable tokens.
   */
  sources: readonly FundingSource[];
  /**
   * The gas verdict of each candidate chain, keyed by chain id (POO-1032). A chain absent from the
   * map stays spendable: a failed classification must not read as a blocked one.
   */
  gasByChainId: Readonly<Record<number, GasFeasibility>>;
  /**
   * What the operation needs, in USD: the denominator the selection is measured against, stable as the
   * selection changes. POO-1166: with the on-ramp available this is the operation's FULL requirement
   * (the liquidity the user asked for) and the buy covers whatever the selection leaves; the host must
   * NOT pass a shortfall (already net of the wallet's holdings, which the rows then re-count) nor a
   * figure that shrinks toward the selection. Without an on-ramp the host passes the buffered
   * requirement, because the sources alone must then also cover the fees the CTA gates on [R5].
   */
  requiredUsd: number;
  /**
   * The conversion buffer as a percentage, for the disclosure above the shortcut ([R50]).
   *
   * Interpolated rather than written into the copy: POO-1499 D9 makes the rate the server's to set,
   * so a percentage baked into 12 locales would be wrong the first time it is tuned.
   */
  bufferPct: number;
  /**
   * The chain the operation runs on (POO-1042 [R8]). A holding that cannot reach it is not spendable
   * and, since [R11], not rendered either.
   */
  targetChainId?: number;
  /** The selected source keys, in pick order, which is route order [R4]. Controlled. */
  selected: readonly string[];
  /** Called with the next selection on every toggle. */
  onSelectedChange: (next: string[]) => void;
  /** The user confirmed a covering selection. Only reachable while the CTA is enabled [R5]. */
  onConfirm: () => void;
  /**
   * [R17] Open the shared `TransactionSettingsDialog`. Slippage and deadline live on THIS screen and
   * nowhere else in the provisioning flow, and the dialog itself stays with the host, the same way
   * `InvestModal`, `CompoundModal`, `CollectModal` and `BuyGasModal` already own theirs. Absent, no
   * gear renders: a gear that opens nothing is worse than none.
   */
  onOpenSettings?: () => void;
  /**
   * POO-1528 [M6.1]/[M6.2]: `true` once the host has mounted its OWN mobile header — the gear's
   * canonical rule ([R17], "here and nowhere else") does not change, only WHERE "here" renders
   * below `sm`. While `true`, this component's own gear and its `Refreshes in {seconds}s` countdown
   * go quiet below `sm` (the header owns the gear; the countdown moves down to sit with the
   * coverage meter here instead, where {@link quoteSeconds}'s own doc explains why it needs to stay
   * visible at all). Above `sm`, and for a host that has not adopted the header (this prop absent or
   * `false`), nothing changes — both render exactly where they always have.
   */
  mobileHeaderMounted?: boolean;
  /**
   * [R18] The step plan and the `You pay` block, revealed by `See details`.
   *
   * A slot rather than props because both already exist as components the host composes
   * (`ProvisioningPlanCard`, `ProvisioningCostBreakdown`) and neither is this control's business.
   * Absent, the disclosure is not rendered at all: there is no plan to show before one is quoted.
   *
   * Note what stays OUT of the disclosure: the coverage total. [R18] hides the *how*, never the
   * *how much*.
   */
  details?: ReactNode;
  /**
   * POO-1503: the quote's REMAINING seconds, ticking, which render `Refreshes in {seconds}s` beside
   * the gear.
   *
   * It moved here off the deleted Confirm screen, and it is the one thing on that screen which had to
   * stay VISIBLE rather than go behind `See details`: a price with a deadline the user cannot see is a
   * price they will be surprised by. The figure is the HOST's own countdown
   * (`useReviewCountdown` hosted in `ProvisioningPanel`, which also fires the TTL re-quote), passed
   * down live, so this label, the disclosure's status line and the re-quote that actually happens all
   * describe the ONE countdown that exists; this component never runs a timer of its own. Absent,
   * nothing renders: there is no quote yet to expire.
   */
  quoteSeconds?: number;
  /** A re-quote is in flight, so the countdown says so instead of counting. Pairs with `quoteSeconds`. */
  requoting?: boolean;
  /** Leave the flow. Rendered as the ghost button under the CTA when supplied. */
  onCancel?: () => void;
  /**
   * POO-1155: the fiat on-ramp can buy whatever the selection does not cover, so a SHORT (or empty)
   * selection may still proceed — Continue routes the remainder to the on-ramp rather than blocking.
   * Off (the crypto-only cut) keeps the original gate: a covering selection with at least one source.
   * When set, the CTA never sits disabled behind a wallet that simply cannot cover the requirement.
   */
  allowShortfall?: boolean;
  className?: string;
}

/** Coverage as a whole percentage, capped at 100. A zero requirement is trivially covered. */
function coveragePercent(selectedUsd: number, requiredUsd: number): number {
  if (!Number.isFinite(requiredUsd) || requiredUsd <= 0) return 100;
  if (!Number.isFinite(selectedUsd) || selectedUsd <= 0) return 0;
  return Math.min(100, Math.round((selectedUsd / requiredUsd) * 100));
}

/** Pick what to spend; the app works out the route. See {@link FundingSourceSelectorProps}. */
export function FundingSourceSelector({
  sources,
  gasByChainId,
  requiredUsd,
  bufferPct,
  targetChainId,
  selected,
  onSelectedChange,
  onConfirm,
  onOpenSettings,
  mobileHeaderMounted = false,
  details,
  quoteSeconds,
  requoting = false,
  onCancel,
  allowShortfall = false,
  className,
}: FundingSourceSelectorProps) {
  const t = useTranslations("strategies");
  const listId = useId();
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const progress = fundingProgress(sources, selected, requiredUsd);
  // [R5] Coverage alone is not enough: a zero requirement is trivially covered, and confirming with
  // nothing picked would hand the planner an empty route.
  // POO-1155: with the on-ramp available (`allowShortfall`), a short or empty selection still proceeds
  // — Continue buys the remainder rather than blocking, which is what made the greyed row fatal rather
  // than merely confusing. `buildPlan` emits the `buy` leg for whatever the picks leave uncovered.
  const canConfirm = allowShortfall || (progress.covered && selected.length > 0);
  const statusId = `${listId}-status`;

  // [R11] One predicate decides what is rendered, what the shortcut fills from, and what the CTA
  // will accept. They were three call sites of the same question and this is the one list.
  const spendable = spendableSources(sources, gasByChainId, targetChainId);
  // [R15][R16] What the shortcut will pick, and the figure it prints. Both come from one call so the
  // label can never advertise an amount the click does not select.
  const fill = fillToTarget(sources, gasByChainId, requiredUsd, targetChainId);
  const allPicked = fill.keys.length > 0 && fill.keys.every((key) => selected.includes(key));

  return (
    // POO-1535 [M6.5]: 20px below `sm`, not 16. The `Convert what's needed` row's border-top notch
    // needs the same clearance from the buffer note above it that the recommended route row needs
    // from whatever precedes it. Above `sm` the chip is inline again, so there is nothing to clear
    // and main's `gap-4` stands ([M6.6] "Above `sm` nothing changes").
    <div className={cn("flex flex-col gap-5 sm:gap-4", className)}>
      {/* [R17] The gear sits with the title, which is where the six transactional modals already put
          it. It is the ONLY place slippage and deadline are reachable in this flow. */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-semibold text-foreground text-lg">
          {t("provisioning.fundingSources.title")}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {/* POO-1503: the quote's deadline, beside the gear, at the smallest size the token contract
              allows (12px is the floor `tokens:check` enforces; the spec's 11px would fail it). It
              says `Updating prices` while a re-quote is in flight rather than counting down against a
              price that is already being replaced. The seconds tick: they are the host's live
              countdown, never a static TTL.
              POO-1528 [M6.2]: quiet below `sm` once a host's own header is mounted — the countdown
              moves down to the coverage meter there instead (see below), where it still has to stay
              visible, just with different neighbours. */}
          {quoteSeconds === undefined ? null : (
            <span
              className={cn(
                "text-muted-foreground text-xs tabular-nums",
                mobileHeaderMounted && "hidden sm:inline",
              )}
            >
              {requoting
                ? t("provisioning.costs.updating")
                : t("flow.review.refreshIn", { seconds: quoteSeconds })}
            </span>
          )}
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label={t("provisioning.fundingSources.settings")}
              // POO-1528 [M6.1]: quiet below `sm` once a host's own header is mounted — [R17]'s rule
              // ("here and nowhere else") is unchanged, only WHERE "here" renders on that viewport.
              // POO-1526 [M5.1]: wherever it DOES still render, it carries the house invisible hit
              // area (24px + 2×10px = the 44pt floor), visual size and row alignment unchanged. Its
              // only interactive neighbour is the countdown's row above, whose text is not a control.
              className={cn(
                "relative shrink-0 rounded-md p-1 text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mobileHeaderMounted && "hidden sm:block",
              )}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {/* [R1][F3-R3] The running total. `aria-live="polite"` because it changes under the user's own
          actions and a money figure they cannot see is a money figure they cannot check. The bar is
          a second reading of the same number, never the only one. */}
      <div
        aria-live="polite"
        className="flex flex-col gap-2 rounded-xl bg-surface-raised px-4 py-3"
      >
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coveragePercent(progress.selectedUsd, progress.requiredUsd)}
          aria-labelledby={statusId}
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              progress.covered ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${coveragePercent(progress.selectedUsd, progress.requiredUsd)}%` }}
          />
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words font-semibold text-foreground text-sm">
            {t("provisioning.fundingSources.meter", {
              selected: formatUsd(progress.selectedUsd),
              required: formatUsd(progress.requiredUsd),
            })}
          </span>
          <span
            id={statusId}
            className={cn(
              "shrink-0 text-sm",
              progress.covered ? "text-success" : "text-muted-foreground",
            )}
          >
            {/* Three states, not the design's two. The Figma mock shows an exact cover, which is
                what a per-token amount would produce; whole-source selection (POO-1082 D1) routinely
                overshoots, and dropping the surplus figure would leave a user who picked $114.50 too
                much with no way to see it. The route still spends only what it needs. */}
            {progress.covered
              ? progress.surplusUsd > 0
                ? t("provisioning.fundingSources.surplus", {
                    amount: formatUsd(progress.surplusUsd),
                  })
                : t("provisioning.fundingSources.enough")
              : t("provisioning.fundingSources.remaining", {
                  amount: formatUsd(progress.remainingUsd),
                })}
          </span>
        </div>
        {/* POO-1528 [M6.2]: the countdown's mobile home, once a host's own header owns the gear and
            has no room left for this too. Same figure, same doc as the one above — never a second
            countdown, only a second RENDER of the one the host already ticks. */}
        {mobileHeaderMounted && quoteSeconds !== undefined ? (
          <p className="text-muted-foreground text-xs tabular-nums sm:hidden">
            {requoting
              ? t("provisioning.costs.updating")
              : t("flow.review.refreshIn", { seconds: quoteSeconds })}
          </p>
        ) : null}
      </div>

      {/* [R50] / CR-CORE-014. The buffer is money sourced ABOVE what the operation costs, so it is
          stated where the user is committing it, at rest and without an interaction. The rate is
          interpolated because POO-1499 D9 makes it the server's to set. */}
      <p className="text-muted-foreground text-sm">
        {t("provisioning.fundingSources.bufferNote", { pct: bufferPct })}
      </p>

      {spendable.length === 0 ? (
        <p className="rounded-xl border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          {t("provisioning.fundingSources.empty")}
        </p>
      ) : (
        <>
          {/* [R15] Derived, not remembered: with the fill already picked this reads as on, and
              pressing it clears. [R16] the figure is what the click selects, not the target. */}
          {spendable.length > 1 ? (
            <button
              type="button"
              aria-pressed={allPicked}
              onClick={() => onSelectedChange(allPicked ? [] : fill.keys)}
              className={cn(
                "relative flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                allPicked ? "border-primary bg-primary/5" : "border-primary/60",
              )}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-semibold text-primary text-sm">
                  {t("provisioning.fundingSources.convertNeeded")}
                </span>
                {/* POO-1535 [M6.5]: ONE element, two shapes, gated on `sm`. BELOW `sm` it lifts out
                    of the flow onto this row's own top border: two inline attempts put the chip
                    straight through the amount (`$220.50`), and the amount is money (P2: never
                    truncated). `bg-surface` so the border reads as interrupted by the page behind
                    it; `-translate-y-1/2` centres it on the 1px stroke; `right-4` is the spec's
                    16px inset. AT AND ABOVE `sm` nothing changes: `sm:static` returns it to this
                    wrap span, `sm:translate-y-0` cancels the lift and `sm:bg-primary/10` restores
                    the tint, which is byte-for-byte the inline chip that shipped before this issue
                    (`top`/`right` do not apply to a static box). It never leaves the label row in
                    SOURCE order, so the button's accessible name is unchanged on either viewport:
                    `position` governs where the chip is SEEN, not where a screen reader hears it. */}
                <span className="absolute top-0 right-4 -translate-y-1/2 shrink-0 rounded-full border border-primary/40 bg-surface px-2 py-0.5 font-medium text-primary text-xs sm:static sm:translate-y-0 sm:bg-primary/10">
                  {t("provisioning.fundingSources.recommended")}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
                {formatUsd(fill.usd)}
              </span>
            </button>
          ) : null}

          <div
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={t("provisioning.fundingSources.listLabel")}
            className="flex flex-col gap-2"
          >
            {spendable.map((source) => {
              const key = fundingSourceKey(source);
              const position = selected.indexOf(key);
              return (
                <SourceRow
                  key={key}
                  source={source}
                  position={position}
                  onToggle={() => onSelectedChange(toggleFundingSource(selected, key))}
                />
              );
            })}
          </div>
        </>
      )}

      {/* [R18] The *how* goes behind the disclosure; the *how much* above it never does. */}
      {details ? (
        <div className="flex flex-col gap-3 border-border border-t pt-3">
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
            // [M5.2] A tap-to-expand disclosure, same class of control as the "Step N of M" one the
            // rule names by example; the explicit min-height is the fix, not a bigger icon.
            className="mx-auto flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {detailsOpen
              ? t("provisioning.fundingSources.hideDetails")
              : t("provisioning.fundingSources.seeDetails")}
            {detailsOpen ? (
              <ChevronUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </button>
          {detailsOpen ? (
            <div id={detailsId} className="flex flex-col gap-3">
              {details}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* POO-1525 [M3.3]: this is state `2`/`2c`'s terminal CTA, so it and the cancel link below it
          are the one thing on this screen that must stay reachable while the details disclosure above
          scrolls. */}
      <StickyActionFooter>
        {/* The CTA describes itself with the shortfall line, so a screen-reader user who lands on a
            disabled button is told what is missing rather than just that it is unavailable. */}
        <Button
          data-testid="funding-sources-confirm"
          className="w-full"
          size="lg"
          disabled={!canConfirm}
          aria-describedby={statusId}
          onClick={onConfirm}
        >
          {t("provisioning.fundingSources.cta")}
        </Button>

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            // [M5.2] Its own full-width row; the explicit 44pt is a min-height, not a bigger font.
            className="flex min-h-11 w-full items-center justify-center rounded-md text-center text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("provisioning.fundingSources.cancel")}
          </button>
        ) : null}
      </StickyActionFooter>
    </div>
  );
}

/**
 * One holding: token, network badge, balance, and whether it is picked.
 *
 * `role="option"` inside the parent listbox (the repo's established multi-select pattern, see
 * `CategoryFilter`). The accessible NAME is an explicit sentence rather than the row's raw text, so
 * it reads as a person would say it ("USDC on Base, 1,200 USDC, worth $1,200.00"); the step number
 * rides along as the accessible DESCRIPTION [R7].
 *
 * [R11] made this row unconditionally takeable. There is no `aria-disabled` path any more, no
 * verdict badge ([R12]) and no network text line ([R13]): the network is the badge on the logo, and
 * a row that renders is a row that can be picked.
 */
function SourceRow({
  source,
  position,
  onToggle,
}: {
  source: FundingSource;
  /** Index in the selection, or `-1` when unselected. Its 1-based form is the route step [R4]. */
  position: number;
  onToggle: () => void;
}) {
  const t = useTranslations("strategies");
  const rowId = useId();
  const [logoFailed, setLogoFailed] = useState(false);
  const isSelected = position >= 0;

  const slug = networkSlug(source.chainId);
  const network = networkName(source.chainId);
  // Committed token art first (PP-CORE-LIB-021), then the feed's URL, then a symbol chip — the same
  // ladder the wallet modal walks, so one token never has two looks. [F3-R8]: the chip also catches
  // a URL that resolves but fails to LOAD, which used to paint the broken-image glyph.
  const tokenLogo = resolveTokenLogo(source.symbol, slug) ?? source.logoUrl;
  const amount = formatTokenAmount(
    toTokenAmount(source.amount, source.decimals),
    source.symbol,
    source.decimals <= 6 ? 2 : 4,
  );

  const stepId = `${rowId}-step`;

  return (
    <button
      // POO-1109: keyed by chain and address so a spec can target a SPECIFIC holding. Row order is
      // USD-descending and therefore moves with price; "the second row" is not a stable handle.
      data-testid={`funding-source-${source.chainId}-${source.address.toLowerCase()}`}
      data-selected={isSelected}
      type="button"
      role="option"
      aria-selected={isSelected}
      aria-describedby={isSelected ? stepId : undefined}
      aria-label={t("provisioning.fundingSources.rowLabel", {
        symbol: source.symbol,
        network,
        amount,
        usd: formatUsd(source.usd),
      })}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40",
      )}
    >
      <span className="relative shrink-0">
        {tokenLogo && !logoFailed ? (
          // Decorative: the row's accessible name already carries the token and the network.
          <img
            src={tokenLogo}
            alt=""
            aria-hidden="true"
            onError={() => setLogoFailed(true)}
            className="size-9 rounded-full bg-surface-raised object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-full bg-surface-raised font-semibold text-xs text-muted-foreground"
          >
            {source.symbol.slice(0, 3).toUpperCase()}
          </span>
        )}
        {/* [R13] The network lives here and nowhere else on the row. */}
        <NetworkLogo
          network={slug}
          name={network}
          size={14}
          fallbackColor={networkColor(source.chainId)}
          className="absolute right-0 bottom-0 ring-2 ring-surface"
        />
      </span>

      <p className="min-w-0 flex-1 break-words font-semibold text-foreground text-sm">
        {source.symbol}
      </p>

      <div className="shrink-0 text-right">
        <p className="font-medium text-foreground text-sm tabular-nums">{amount}</p>
        <p className="text-muted-foreground text-xs tabular-nums">{formatUsd(source.usd)}</p>
      </div>

      {/* [F3-R5] A check, not a number. The position still rides the description, so the route a
          screen-reader user hears is the one that executes [R4]. */}
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border",
          isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        <Check
          className={cn("size-3.5", isSelected ? "opacity-100" : "opacity-0")}
          aria-hidden="true"
        />
        {isSelected ? (
          <span id={stepId} className="sr-only">
            {t("provisioning.fundingSources.step", { index: position + 1 })}
          </span>
        ) : null}
      </span>
    </button>
  );
}
