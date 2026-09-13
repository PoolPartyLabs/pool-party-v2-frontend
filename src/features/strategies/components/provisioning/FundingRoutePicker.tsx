/**
 * @id PP-CORE-CMP-064 (POO-1086, POO-1135, POO-1153, POO-1155, POO-1446, POO-1501, POO-1526, POO-1535, POO-1541, POO-1543, POO-1571)
 * @name FundingRoutePicker
 * @implements-rules-version v10 (POO-1446 rules v3) · v9 (POO-1446 rules v2) · v8 (POO-1446, POO-1543, POO-1571 rules v1) · v7 (POO-1535 rules v1) · v6 (POO-1526 rules v1) · v5 (POO-1541 rules v1) · v4 (POO-1501 rules v1) · v3 (POO-1135, POO-1153, POO-1155 / POO-1129 rules v3) · v1 (POO-1086 rules v1)
 * @analytics-events none, deliberately (POO-1541): the host (`ProvisioningPanel`, PP-CORE-CMP-046)
 *   owns `funding_route_viewed` / `funding_route_chosen` / `funding_route_abandoned` now, through
 *   `PP-CORE-LIB-058`, the single funnel definition every other event in this section already goes
 *   through. This component used to emit them itself via `useAnalytics()` / `useTrackView`, which
 *   left the three carrying no `flow` / `chain_id` / `strategy_id` (see POO-1541). The `onSelect` /
 *   `onCancel` callbacks are still exactly where the host hooks in; only the emission moved.
 *
 * Screen 1 of the provisioning flow, "Where from" (Figma `6547:569`, `6547:627`, `7326:766`,
 * `7331:766`, `7331:811`).
 *
 * States what is missing, then offers the genuinely different ways to cover it, one tap each. There
 * is **no CTA**: every row is already an answer, and a confirm button under a list of answers only
 * adds a step to a screen whose whole job is to remove them.
 *
 * ## v4 (POO-1501): one line per route, and the composition moves behind a hover
 *
 * Each row was a title plus a subtitle, which gave the three rows three different heights and buried
 * the figure a step below the verb. Now the amount is IN the title ([R5]): `Use your $215.25`,
 * `Buy $212.00`, `Use $148.40 + buy $67.90`. The old subtitle keys are untouched in the message
 * files because mobile still renders them until its own pass lands.
 *
 * **One route keeps its subtitle, deliberately, against [R5].** The `buy` row's subtitle is not
 * decoration: it carries the received-fixed quote charge NAMED by the method it was priced for, or a
 * pending caption when no quote resolved, plus that method's own minimum. That exists because showing
 * an FE-computed figure as what the provider charges is a defect this product already shipped once
 * (POO-1153 / POO-1413, the "Buy with card" overpromise, wrong because there are 21 methods and not
 * one). Folding it away to equalise row heights would delete a disclosure and turn the title into an
 * unlabelled price. Decided with murilo 2026-08-10.
 *
 * The title amount is `FundingRoute.sourceTargetUsd`, which is **what must LAND**, never what a card
 * is charged (`fundingTarget.ts`). The two differ, and the subtitle is where the charge lives.
 *
 * ## v8 (POO-1446): the pending caption is REWORDED, not deleted
 *
 * `subtitlePending` now reads `Final charge shown at checkout` rather than `Amount shown at
 * checkout`. "Amount" was the word the TITLE already owns, so the caption restated the title instead
 * of correcting it; "final charge" names the thing the title is NOT. Deleting the caption was
 * considered and rejected (Rafael, 2026-08-13): it would reverse the 2026-08-10 decision above and
 * widen `CR-CORE-016`, which is `BLOCKING` precisely because the charge disclosure is already absent
 * on any quote failure, and a quote failure is mock mode always plus a real production case. (Read
 * "every dev environment" here when this was written; POO-1605 made the dev half of that false, see
 * the `R4` note further down.)
 *
 * ## v9 (POO-1446 rules v2): the buy row finally says WHY its amount exceeds the need
 *
 * The v8 rewording narrowed `CR-CORE-016` without closing it. `You need $105.06` above `Buy $110.25`
 * still left the difference unaccounted for anywhere on the screen: the title says what must LAND,
 * the caption says the CHARGE is settled at checkout, and neither says why the first number is
 * bigger than the heading's. This adds the third statement, as a disclosure rather than a fourth
 * line of permanent copy, and it is strictly ADDITIVE ([R1] v2): the caption stays exactly as it is,
 * because reversing the 2026-08-10 decision a second time would reopen that register entry in the
 * direction it was escalated for.
 *
 * Three statements now coexist on the buy row and are deliberately distinct ([R7] v2). Title: the
 * amount that must LAND. Caption: what the provider will CHARGE. Disclosure: the gap between them,
 * and what becomes of the remainder. The disclosure restates neither of the other two.
 *
 * **The reason it gives is the reason that binds** ([R5]). `sourceTargetUsd()` ends
 * `Math.max(PAYBIS_MIN_USD, target)`, so the printed figure IS the floor exactly when the computed
 * target fell at or below it, and is strictly greater exactly when the buffer formula set it. One
 * comparison decides which sentence is true, and a fixed string could not: on a ~$200 operation the
 * gap is the buffer, and naming a minimum there would be a false statement on a money path, which is
 * the failure class `CR-CORE-016` exists to close.
 *
 * The gas reserve is deliberately NOT asserted as a component. This component cannot decide whether
 * one is in the figure (POO-1542 [B]: the buy route's gas question is `onRampRouteBuysGas`, over
 * Base AND the target, while `gasUsd` here answers the TARGET-chain question only, so `gasUsd === 0`
 * does not exclude a reserve), and on a buy where both chains are gas-OK there is no reserve at all.
 * Hence "plus any network fees" rather than a figure. Naming it needs a `buyBuysGas` flag or a
 * `gasComponentUsd` on `FundingRoute`, never an inference from `gasUsd`.
 *
 * ## v10 (POO-1446 rules v3): the sentence names OUR floor, and the mixed row is floored too
 *
 * ### [R5a] v3, the minimum sentence names our own order floor and drops the superlative
 *
 * `disclosureMinimum` read `Purchases start at {minimum}, so this is the smallest amount you can buy,
 * even when the transaction needs less.` Two defects, both on a money path. It described a PROVIDER
 * purchase floor, and the same row can print `Minimum EUR 30.00 with Trustly` one line ABOVE it: since
 * POO-1512 that method minimum is denominated in the BUYER's currency (see
 * {@link FundingRoutePickerProps.buyMethodMinUsd}) and is no longer USD-comparable to
 * `PAYBIS_MIN_USD`, while the host gates it on `buyOrderUsd <= PAYBIS_MIN_USD`, so both sentences fire
 * on the SAME small order and the row contradicts itself about what the floor is. And "the smallest
 * amount you can buy" is a superlative this app cannot vouch for, since a method can require more than
 * we do, which is the very reason that other line exists.
 *
 * It now names the floor this app itself enforces, which is the only thing `PAYBIS_MIN_USD` actually
 * is: `We never place an order below {minimum}, so this is what you will buy even when the transaction
 * needs less.` `formatUsd` stays correct on it, deliberately, and must NOT become `formatFiat`: this is
 * the crypto-side USD constant for the smallest order WE place, never a fiat charge in the buyer's
 * currency ([R8]).
 *
 * ### [R12] the mixed row prints the buy leg it will actually place
 *
 * `Use {available} + buy {shortfall}` interpolated `route.shortfallUsd`, the RAW remaining gap, while
 * `sourceTargetUsd()` applies `Math.max(PAYBIS_MIN_USD, target)` for `routeKind === "buy"` ONLY. So the
 * row could read `Use $205.00 + buy $3.20` against a rail that will not sell below $10: verbatim
 * question (a) of `CR-CORE-016`, a screen naming an amount the rail cannot sell. The DISPLAYED buy leg
 * is now `Math.max(PAYBIS_MIN_USD, route.shortfallUsd)`, because with a $3.20 gap the user really will
 * buy $10.00.
 *
 * **A display floor, not a data one.** `fundingTarget.ts` and `fundingRoutes.ts` are untouched: what
 * this route actually SOURCES is the three-sizer reconciliation still owed on POO-1543, and settling it
 * here would be a second implementation of it. The leg is also NOT computed as
 * `sourceTargetUsd - availableUsd`, which looks equivalent and is not: `sourceTargetUsd` is derived
 * from `target.transactionUsd`, while `availableUsd` is `progress.selectedUsd` measured against
 * `requiredUsd`. Different bases, so subtracting them fabricates a figure neither side agrees with,
 * which is the exact failure class this work closes.
 *
 * ### [R13] the mixed row discloses only when the floor BINDS
 *
 * When it binds (`route.shortfallUsd <= PAYBIS_MIN_USD`) the printed leg exceeds the gap, so the row
 * owes the same explanation the buy row's floored branch gives: `disclosureMinimum` then
 * `disclosureRemainder`, the same two sentences behind the same trigger. When it does not bind the
 * printed figure IS the gap, there is no excess to account for, and NO trigger renders on that row.
 *
 * `disclosureBuffer` is deliberately unreachable from this row. The mixed row's figure is the raw gap
 * with no buffer applied, so "5% in case prices move" would be a false sentence there, which is the
 * failure class rather than a near miss.
 *
 * Both rows share the `provisioning.routes.buy.*` keys rather than growing a `tokensPlusBuy` copy: one
 * sentence with one meaning, and a duplicate is twelve more locale values free to drift from the ones
 * they were copied out of.
 *
 * PP-I18N (POO-1446): four judgement calls in this row's copy are flagged for native review. Locale
 * JSON cannot carry a comment and these are not key gaps (`i18n:check` is green across all twelve), so
 * the marker lives here.
 *   1. `ko` takes 합쇼체 throughout this file (`...구매하게 됩니다`), the register every neighbouring
 *      value here already uses, rather than the 해요체 the `i18n-translation-rules` skill suggests for
 *      the investor app. Kept consistent with the file, not with the skill.
 *   2. `ja` `disclosureLabel` (`この金額になる理由`) is a literal rendering of "Why this amount" and may
 *      read stiff as a control label. A native ear should confirm it.
 *   3. `vi` says `giao dịch` for both a purchase and a transaction, so `disclosureBuffer` reads
 *      `...giao dịch mua của bạn hoàn tất` beside `mức giao dịch cần`. Understandable, possibly
 *      redundant. The v3 reword happens to remove that same collision from `disclosureMinimum`.
 *   4. `de` / `nl` / `vi` render the order WE place with a finance loanword (`Auftrag`, `order`,
 *      `lệnh`), which may read as a trading order rather than as a consumer purchase.
 * Corrected while re-checking those, because the PR body carried it as a fifth: only `de` ever split
 * `disclosureMinimum` into two sentences against the source's one, `nl` never did, and at v3 both are
 * a single sentence.
 *
 * ## Where the composition went ([R9], [R10])
 *
 * `{amount} for the transaction + {gas} gas` used to sit permanently under the heading, where
 * `+ $5.00` on a $200 operation reads as a fee. It now opens from a 16px info affordance beside the
 * amount, and it carries two further lines: why the top-up is bigger than this one transaction
 * needs, and that a little extra is converted against price movement and the remainder comes back.
 * When no gas is needed the affordance and the breakdown are **not rendered at all** ([R9], `1c`) —
 * an empty disclosure is worse than none.
 *
 * Built on the shared Radix `Tooltip`, which opens on hover **and on keyboard focus**. [R10]
 * specifies a hover; a hover-only disclosure is unreachable by keyboard and by touch, so the
 * primitive that already solves it is used rather than a bespoke `onMouseEnter`.
 *
 * ## Loading (D1)
 *
 * `sourceTargetUsd` is absent until the quote resolves, and a row cannot print an amount it does not
 * have. Absent target IS the loading state, so the picker renders a skeleton of itself in the shape
 * the ready screen will take. The modal opens on tap either way: "open only when ready" means a dead
 * tap of unknown length, which reads as a broken button.
 *
 * ## Provisioning v3 mobile [M5], POO-1526
 *
 * The bottom `Cancel` is its own row with no icon to keep small (M5.2), so it gets an EXPLICIT
 * `min-h-11`, not the invisible hit area the info dot already uses. The info dot itself needed no
 * change: it shipped with the POO-840 R2 hit area from POO-1501.
 *
 * `Deposit from external wallet` was the second such row and no longer is. POO-1571 supersedes
 * M5.2's MECHANISM there, not its intent: the row now carries the cards' own `py-3` padding around a
 * `size-9` icon circle, so it stands `36 + 24 = 60px` before its border box and exactly as tall as a
 * card with it. The 44pt target M5.2 asks for is therefore met by the same structure every other row
 * on this screen already relies on, rather than by a min-height bolted onto a bare text link.
 */
"use client";

import { ArrowDownToLine, ChevronRight, CreditCard, Info, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
// POO-1446 [R5]: the same floor `sourceTargetUsd()` applies as its LAST operation, read here to tell
// "the floor set this figure" from "the buffer did". A value import, and safe: the barrel is the
// client surface (`serverBoundary.test.ts` guards it) and `fundingTarget.ts` already imports this
// constant from it inside this very subtree, so it crosses no server boundary and adds no bundle.
import { PAYBIS_MIN_USD } from "@/lib/provisioning";
import { cn } from "@/lib/utils/cn";
import { formatFiat, formatUsd } from "@/lib/utils/format";
import type { FundingRoute, FundingRouteKind } from "./fundingRoutes";
import { CARD_ROUTE_KINDS, recommendedRouteKind, shouldPickRoute } from "./fundingRoutes";

/** Public props for {@link FundingRoutePicker}. */
export interface FundingRoutePickerProps {
  /** The viable routes, most-preferred first, from `resolveFundingRoutes`. */
  routes: readonly FundingRoute[];
  /** The total to cover, USD: the operation's own requirement plus gas. */
  requiredUsd: number;
  /** The operation's share of it. Zero for withdraw / collect / compound / move-range / close. */
  opRequiredUsd: number;
  /**
   * The gas share of it. **Zero means no gas is needed**, which suppresses the whole breakdown
   * affordance ([R9], `1c`) rather than rendering a disclosure with nothing in it.
   */
  gasUsd: number;
  /**
   * The conversion buffer, as a percentage, for the tooltip's third line ([R10] / [R50]).
   *
   * Interpolated rather than written into the copy, for the same reason the gas floor is: the rate
   * is the server's to set (POO-1499 D9), so a percentage baked into 12 locales would be wrong the
   * first time it is tuned.
   */
  bufferPct: number;
  /**
   * [R10] The received-fixed on-ramp quote's total fiat charge in USD (`OnRampQuote.chargeUsd`, i.e.
   * the backend's `amountFrom`), for the buy route's subtitle. Per [R10] the FE's own
   * `FundingRoute.shortfallUsd` is NEVER displayed as what Paybis will charge, so absent this quote the
   * buy row shows a neutral "shown at checkout" caption rather than the FE figure. The mount site
   * supplies it once the received-fixed quote resolves (POO-1153, via `useBuyRouteQuote`).
   */
  buyChargeUsd?: number;
  /**
   * POO-1512 [R7]: the currency {@link buyChargeUsd} is billed in. The buyer is charged in their own
   * currency now, so formatting this figure as dollars would print `$208.00` against a EUR 208 charge.
   * Absent, it formats as USD, which is both the historical behaviour and the [R4] fallback currency.
   */
  buyChargeCurrency?: string;
  /**
   * POO-1153: the human label of the method the {@link buyChargeUsd} charge was priced for (e.g. "Credit
   * Card"). The charge varies materially by method and the user can change it inside the widget, so the
   * figure is NAMED beside the method rather than shown bare, an unlabelled number overpromises (the
   * old "Buy with card" failure, wrong because there are 21 methods, not one). Absent, the buy row shows
   * the neutral caption even if a charge was somehow supplied: a figure with no method is not displayed.
   */
  buyMethodName?: string;
  /**
   * POO-1153: the buy method's OWN minimum purchase, surfaced under the subtitle so the row states the
   * real floor rather than letting Paybis reject the order. Denominated in {@link buyMethodMinCurrency}
   * since POO-1512 (the methods list is fetched in the buyer's resolved currency), so it is NO LONGER
   * USD-comparable to the app's `PAYBIS_MIN_USD` floor; the host gates it on the crypto side instead
   * (see `ProvisioningPanel`) and passes it when the order sits at the app floor, where a method's own
   * minimum is what can still reject it. Absent means the host judged it not worth stating.
   */
  buyMethodMinUsd?: number;
  /**
   * POO-1512 [R7]: the fiat currency {@link buyMethodMinUsd} is denominated in. Defaults to USD so a
   * host that predates the buyer-currency work keeps its old (dollar) rendering.
   */
  buyMethodMinCurrency?: string;
  /** The user chose a route. One tap, no confirmation. */
  onSelect: (kind: FundingRouteKind) => void;
  /** Back out of the gate entirely. */
  onCancel: () => void;
  className?: string;
}

/** Icon per route. Decorative: every row carries its own words. */
const ROUTE_ICON = {
  tokens: Wallet,
  "tokens-plus-buy": Wallet,
  buy: CreditCard,
  deposit: ArrowDownToLine,
} as const satisfies Record<FundingRouteKind, typeof Wallet>;

/**
 * Title key per route, written out in full rather than assembled from a stem.
 *
 * `i18n:check` scans for literal key strings, so a template like `provisioning.routes.${stem}.title`
 * is invisible to it: a missing translation would ship instead of failing the build.
 */
const ROUTE_TITLE_KEY = {
  tokens: "provisioning.routes.tokens.title",
  "tokens-plus-buy": "provisioning.routes.tokensPlusBuy.title",
  buy: "provisioning.routes.buy.title",
  deposit: "provisioning.routes.deposit.title",
} as const satisfies Record<FundingRouteKind, string>;

/**
 * Where would you like this to come from? See {@link FundingRoutePickerProps}.
 *
 * [R2] A question with one answer is not a choice, so a single route renders nothing. The guard sits
 * HERE, in a component that holds no hooks, rather than inside the body: React's own rule is that a
 * component's hook set cannot become conditional (`FundingRoutePickerView` below has `useState`), so
 * a guard past that point would still run every hook for a screen the user never saw. POO-1541: the
 * host now owns `funding_route_viewed` itself, gated on the SAME `pickingRoutes`/`shouldPickRoute`
 * predicate, so this guard staying here is what keeps a single-route screen from being counted at
 * all if this component is ever mounted directly instead of through the host.
 */
export function FundingRoutePicker(props: FundingRoutePickerProps) {
  if (!shouldPickRoute(props.routes)) return null;
  return <FundingRoutePickerView {...props} />;
}

/** The picker proper. Reached only once there is genuinely a choice to present. */
function FundingRoutePickerView({
  routes,
  requiredUsd,
  opRequiredUsd,
  gasUsd,
  bufferPct,
  buyChargeUsd,
  buyChargeCurrency,
  buyMethodName,
  buyMethodMinUsd,
  buyMethodMinCurrency,
  onSelect,
  onCancel,
  className,
}: FundingRoutePickerProps) {
  const t = useTranslations("strategies");
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  // POO-1446 [R13]: the row disclosure's open state moved INTO `RouteAmountDisclosure`, one instance
  // per row. It used to be one boolean here, correctly, while `buy` was the only row that could carry
  // one; `tokens-plus-buy` can carry one now and the two routes ship together out of
  // `resolveFundingRoutes`, so a single shared boolean would open both tooltips on one tap. A map
  // keyed by route kind would work and says nothing the component's own state does not.

  const cards = routes.filter((route) => CARD_ROUTE_KINDS.includes(route.kind));
  const deposit = routes.find((route) => route.kind === "deposit");
  const recommended = recommendedRouteKind(routes);

  // D1: a row cannot print an amount it does not have, and an absent target IS "the quote has not
  // resolved".
  const quoted = cards.every((route) => route.sourceTargetUsd !== undefined);

  if (!quoted) return <RoutePickerSkeleton cardCount={cards.length} className={className} />;

  // [R9] No gas to cover, no breakdown, and no affordance for one. `1c`.
  const showBreakdown = gasUsd > 0;

  return (
    // POO-1535 [M6.5]: 20px below `sm`, not 16. When the recommended route is the FIRST card (the
    // common case) the notch's clearance is measured from the HEADING above, not from another row:
    // the info dot's `after:-inset-3.5` hit area reaches ~8px below the `h3` and the notch reaches
    // 11px above the list, so at `gap-4` the two hit regions overlapped by ~3px and the
    // later-painted route button swallowed the tap. `en` happened to miss horizontally (dot
    // ~x149-179, chip ~x227-327); a locale with a longer heading pushes the dot right and does not.
    // At `gap-5` the dot stops 12px above the list and the notch reaches 11px: no overlap, in any
    // locale. Above `sm` there is no notch, so main's `gap-4` stands ([M6.6] "Above `sm` nothing
    // changes").
    <div className={cn("flex flex-col gap-5 sm:gap-4", className)}>
      <div className="flex flex-col gap-1">
        <h3 className="flex min-w-0 items-center gap-1.5 break-words font-semibold text-foreground text-lg">
          <span className="min-w-0 break-words">
            {t("provisioning.routes.need", { amount: formatUsd(requiredUsd) })}
          </span>
          {/* [R10] The composition lives behind this. Radix opens it on hover AND on focus, so it is
              reachable by keyboard and by touch; a bespoke hover would be neither. The glyph is
              decorative, so the accessible name lives on the trigger. */}
          {showBreakdown ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip open={breakdownOpen} onOpenChange={setBreakdownOpen}>
                <TooltipTrigger asChild>
                  {/* POO-840 [R5]: Radix never opens a tooltip on a plain TAP, so the open state is
                      controlled and `onClick` opens it, while Radix keeps hover, focus, outside-tap
                      and Esc. [R10] specifies a hover, which is desktop thinking: D7 puts this same
                      code on mobile, where a hover-only disclosure does not exist. POO-840 [R2]'s
                      ::after hit area takes the 16px glyph to a ~44px touch target without changing
                      its visual size or moving the heading. */}
                  <button
                    type="button"
                    aria-label={t("provisioning.routes.breakdownLabel")}
                    onClick={() => setBreakdownOpen(true)}
                    className="relative inline-flex shrink-0 rounded-full text-muted-foreground transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="flex max-w-[320px] flex-col gap-2 text-left">
                  <span>
                    {opRequiredUsd > 0
                      ? t("provisioning.routes.breakdown", {
                          amount: formatUsd(opRequiredUsd),
                          gas: formatUsd(gasUsd),
                        })
                      : t("provisioning.routes.breakdownGasOnly", { gas: formatUsd(gasUsd) })}
                  </span>
                  {/* Without this line, a $5.00 top-up on a $200 operation reads as a fee rather than
                    as a fill that lasts. No figure on purpose: this operation's gas COST is not a
                    floor anything enforces (the real minimums differ by funding source), so quoting
                    it as "the smallest top-up" claimed a minimum the product does not set. */}
                  <span className="text-muted-foreground">
                    {t("provisioning.routes.gasMinimum")}
                  </span>
                  {/* [R50]. `bufferPct` is interpolated for the same reason: POO-1499 D9 makes the rate
                    the server's to set, and a percentage baked into 12 locales would be wrong the
                    first time it is tuned. */}
                  <span className="text-muted-foreground">
                    {t("provisioning.routes.bufferTooltip", { pct: bufferPct })}
                  </span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </h3>
      </div>

      {/* A real list, not a bare div: `aria-label` is ignored on the generic role, so the name this
          group was given never reached a screen reader at all, and the count ("list, 2 items") that
          tells someone how many ways out of this they have was never announced either. */}
      {/* POO-1535 [M6.5]: 20px below `sm`, not 8. The recommended row's border-top notch overlapped
          the row above it by 1px at the original gap-2 whenever recommended was NOT the first route
          (`1b`). Above `sm` the chip is inline again (no notch, nothing to clear), so main's `gap-2`
          stands — the issue's own "Above `sm` nothing changes" acceptance. */}
      <ul aria-label={t("provisioning.routes.listLabel")} className="flex flex-col gap-5 sm:gap-2">
        {cards.map((route) => {
          const Icon = ROUTE_ICON[route.kind];
          const isRecommended = route.kind === recommended;
          // POO-1446 [R5]/[R13]: which sentence this row's figure owes, or none. Computed once, so
          // the gutter the trigger sits in and the trigger itself cannot disagree about whether the
          // row has a disclosure at all.
          const reason = disclosureReason(route);
          return (
            // POO-1446 [R3]: the `<li>` becomes the positioning context for the disclosure trigger,
            // which is a SIBLING of the row button rather than a child of it (a button inside a
            // button is invalid HTML, and it would make the disclosure's tap ambiguous with choosing
            // the route). The `<li>` carries no padding or margin, so its box IS the card's border
            // box and every offset below is measured from the card's own edges. The button keeps its
            // own `relative`: the `Recommended` notch positions against the BUTTON and must not move.
            <li key={route.kind} className="relative">
              <button
                type="button"
                onClick={() => onSelect(route.kind)}
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  // [R6] The recommended row is tinted and its border warms, so the chip is not the
                  // only thing carrying the recommendation (colour alone is not a signal).
                  isRecommended
                    ? "border-primary/35 bg-primary/[0.06] hover:border-primary/50"
                    : "border-border hover:border-muted-foreground/40",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground"
                >
                  <Icon className="size-4" />
                </span>
                {/* POO-1446 [R3]: 36px of gutter on the rows that CARRY the disclosure trigger,
                    because it is absolutely positioned over this column and without the gutter a long
                    locale's caption wraps under the glyph. Padding the text column rather than the
                    button keeps those rows' chevrons aligned with every other row's chevron. Gated on
                    the disclosure itself rather than on `kind === "buy"` since [R13], so the mixed row
                    reserves the gutter exactly when it renders a trigger into it and not otherwise. */}
                <span className={cn("flex min-w-0 flex-1 flex-col", reason && "pr-9")}>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    {/* [R5] Verb plus amount, one line. The amount is what must LAND on this route,
                        never what a card is charged: those differ, and the charge is the subtitle's
                        job on the buy row. */}
                    <span className="min-w-0 break-words font-semibold text-foreground text-sm">
                      {t(ROUTE_TITLE_KEY[route.kind], routeTitleValues(route))}
                    </span>
                    {/* POO-1535 [M6.5]: ONE element, two shapes, gated on `sm`. BELOW `sm` it lifts
                        out of the flow onto the button's own top border — a notch centred on the
                        1px stroke (`-translate-y-1/2`), `right-4` for the spec's 16px inset, filled
                        `bg-surface` (not the row's `bg-primary/[0.06]` tint) so the border reads as
                        interrupted by the PAGE behind it rather than merely recoloured. Forced by
                        measurement: at 375 the label (122px) + this chip (95px) + the gap (8px) came
                        to 225px in a 219px row, so inline could only truncate the label or the
                        amount, and the amount is money (forbidden, P2). AT AND ABOVE `sm` the row is
                        wide enough and nothing changes: `sm:static` puts it back in this wrap span,
                        `sm:translate-y-0` cancels the lift and `sm:bg-primary/10` restores the tint,
                        which is byte-for-byte the inline chip that shipped before this issue (`top`
                        and `right` do not apply to a static box). Kept in the label row in SOURCE
                        order at both sizes, so the button's accessible name is identical on either
                        viewport and identical to what it was: `position` governs where the chip is
                        SEEN, never where a screen reader hears it. */}
                    {isRecommended ? (
                      <span className="absolute top-0 right-4 -translate-y-1/2 shrink-0 rounded-full border border-primary/40 bg-surface px-2 py-0.5 font-medium text-primary text-xs sm:static sm:translate-y-0 sm:bg-primary/10">
                        {t("provisioning.routes.recommended")}
                      </span>
                    ) : null}
                  </span>
                  {/* [R5] EXCEPTION, and the only one. Every other route folded its subtitle into the
                      title; this one carries the provider's real charge, named by the method it was
                      priced for, and that is a disclosure rather than a caption. See the file header.
                      POO-1446: the PENDING placeholder is REWORDED, not removed. It now names the
                      CHARGE ("Final charge shown at checkout") where it used to name a vague
                      "amount", because the title above is what must LAND and is NOT the price. A row
                      that dropped the caption would leave that title standing alone as if it were,
                      which is exactly the disclosure gap `CR-CORE-016` is BLOCKING on, and it would
                      reverse the 2026-08-10 decision recorded in the file header. The real charge,
                      once the quote resolves, still renders exactly as before (Rafael, 2026-08-13). */}
                  {route.kind === "buy" ? (
                    <span className="min-w-0 break-words text-muted-foreground text-xs">
                      {buyChargeUsd !== undefined && buyMethodName
                        ? t("provisioning.routes.buy.subtitle", {
                            // POO-1512 [R7]: printed in the currency Paybis says it billed in.
                            amount: formatFiat(buyChargeUsd, buyChargeCurrency ?? "USD"),
                            method: buyMethodName,
                          })
                        : t("provisioning.routes.buy.subtitlePending")}
                    </span>
                  ) : null}
                  {/* POO-1153: the method's OWN minimum, surfaced only when the host passes one (the
                      order sits at the app floor, POO-1512) and the method is named. The user can switch
                      method in the widget, so telling them the real floor beats letting Paybis reject
                      the order. POO-1512 [R7]: printed in the minimum's own currency, never assumed
                      dollars. */}
                  {route.kind === "buy" &&
                  buyMethodMinUsd !== undefined &&
                  buyMethodName !== undefined ? (
                    <span className="min-w-0 break-words text-muted-foreground/80 text-xs">
                      {t("provisioning.routes.buy.minimum", {
                        amount: formatFiat(buyMethodMinUsd, buyMethodMinCurrency ?? "USD"),
                        method: buyMethodName,
                      })}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
              {/* POO-1446 [R2]/[R4]/[R13]: the disclosure the row has never had. On the buy row it
                  renders whenever that row renders WITH an amount, including before any quote
                  resolves, because that unresolved state is permanent in MOCK MODE (the host gates
                  `useBuyRouteQuote` off there) and reachable in production on any quote failure, and
                  is precisely the state `CR-CORE-016` is BLOCKING on. POO-1626: this used to say "and
                  on dev (the Paybis sandbox carries no `USDC-BASE` pair)". POO-1605 reversed that,
                  pool-party-api now substitutes the sandbox currency codes, so a real-mode dev run
                  DOES resolve a charge here. What dev still cannot do is SETTLE, since the sandbox
                  delivers on Sepolia and settlement watches Base (POO-1627). On the mixed row it
                  renders only when the floor binds
                  ([R13]): with the gap above the floor the printed figure IS the gap and there is no
                  excess to account for. See {@link disclosureReason}.

                  [R3] tap isolation is STRUCTURAL: the trigger is a sibling of the row button, never
                  a descendant, and the `<li>` carries no `onClick`, so a click on it cannot reach
                  `onSelect`. No `stopPropagation`, and none should be added. */}
              {reason ? (
                <RouteAmountDisclosure label={t("provisioning.routes.buy.disclosureLabel")}>
                  {/* [R5] The reason that ACTUALLY binds, decided by ONE comparison rather than by
                      recomputing the formula (which this component cannot do: `bufferPct` arrives
                      already rounded to an integer percent, and whether the reserve is in the figure
                      is the `onRampRouteBuysGas` question, not the target-chain one `gasUsd`
                      answers). `disclosureMinimum` names the floor on OUR order rather than the
                      title's price: in this branch the figure necessarily equals the title's, and
                      the sentence has to explain that figure rather than repeat it ([R7] v2). */}
                  <span>
                    {reason === "minimum"
                      ? t("provisioning.routes.buy.disclosureMinimum", {
                          minimum: formatUsd(PAYBIS_MIN_USD),
                        })
                      : t("provisioning.routes.buy.disclosureBuffer", { pct: bufferPct })}
                  </span>
                  {/* [R6] The half that answers the worry the other sentence creates. Shared by
                      every branch, because "where does the difference go" has one answer. */}
                  <span className="text-muted-foreground">
                    {t("provisioning.routes.buy.disclosureRemainder")}
                  </span>
                </RouteAmountDisclosure>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* [R7] Depositing from another wallet is still a way to fund this, so it stays reachable, but
          it is not one of the choices the cards present: it hands off to another surface entirely and
          settles its amount there. As a card it competed with routes that carry figures; as a ghost
          link it stops competing without disappearing. 16px clear of the cards.
          POO-1571: kept as a ghost (no visible border, no coloured background, muted text) so it
          still reads as secondary to the money-bearing cards above, but it now shares their ROW
          STRUCTURE: the same `px-4 py-3` padding (so its left edge lines up with the cards instead
          of sitting flush against the screen edge), a muted icon in the same circle shape, and the
          same trailing chevron, rather than a bare, unindented text link that read as visually
          abandoned (murilo, 2026-08-13). The border is declared `border-transparent` rather than
          omitted: the cards spend 1px a side on a real stroke, so a row with NO border box would sit
          its content 1px off theirs, which is the misalignment this fix exists to remove. */}
      {deposit ? (
        <button
          type="button"
          onClick={() => onSelect("deposit")}
          className="flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground"
          >
            <ArrowDownToLine className="size-4" />
          </span>
          <span className="min-w-0 flex-1 break-words text-sm">{t(ROUTE_TITLE_KEY.deposit)}</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        // [M5.2] Its own full-width row; the explicit 44pt is a min-height, not a bigger font
        // (MobileLocaleSheet.tsx precedent: `flex min-h-11 items-center`).
        className="flex min-h-11 w-full items-center justify-center rounded-md text-center text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("provisioning.routes.cancel")}
      </button>
    </div>
  );
}

/**
 * POO-1446 [R12]: the buy leg this mixed route will ACTUALLY place, which is not always its gap.
 *
 * `route.shortfallUsd` for `tokens-plus-buy` is `progress.remainingUsd`, the raw remaining gap, and
 * `sourceTargetUsd()` floors at `PAYBIS_MIN_USD` for `routeKind === "buy"` only. So a $3.20 gap used
 * to print `+ buy $3.20` while the rail will not sell below $10 and the user really will buy $10.00.
 *
 * A DISPLAY floor. It deliberately does not touch `fundingTarget.ts` / `fundingRoutes.ts`, and it is
 * deliberately not `sourceTargetUsd - availableUsd`: those two come off DIFFERENT bases
 * (`target.transactionUsd` against `progress.selectedUsd` measured on `requiredUsd`), so subtracting
 * them invents a third figure. See the file header.
 */
function mixedBuyLegUsd(route: FundingRoute): number {
  return Math.max(PAYBIS_MIN_USD, route.shortfallUsd);
}

/**
 * POO-1446 [R5]/[R13]: which sentence this row's figure owes, if any.
 *
 * `"minimum"`: the app's own order floor set the figure, so it exceeds what the transaction needs.
 * `"buffer"`: the buffer formula set it (the buy row only; the mixed row applies no buffer).
 * `undefined`: the figure needs no explaining, so no trigger renders on that row at all.
 *
 * **`buy`**: `sourceTargetUsd()` ends `Math.max(PAYBIS_MIN_USD, target)`, so the printed figure is the
 * floor exactly when the computed target fell at or below it. No epsilon: the value is cent-quantised
 * on BOTH sides of the comparison (the floor is a constant; the other arm came out of `ceilToUsd`), so
 * `<=` is an exact test with no tolerance to tune. It is NOT a proof that the floor bound, because
 * `ceilToUsd` can also land on exactly $10.00 without it: `Math.round(9_520_000 * 1.05) = 9_996_000`
 * ceils to `10.00`, and `Math.max(10, 10)` leaves it there. The sentence stays true either way, which
 * is what matters on a money path: a computed target of exactly $10.00 means the need was strictly
 * below $10.00, and $10.00 is still the smallest order we place. Guarded on the amount rather than on
 * `?? 0`, since an absent figure has no reason to explain and a fallback zero would read as floored.
 *
 * **`tokens-plus-buy`** ([R13]): only when the floor BINDS on the gap, since only then does the
 * printed leg exceed it. Never `"buffer"`: this row's figure is the raw gap with no buffer in it, so
 * "5% in case prices move" would be false here.
 */
function disclosureReason(route: FundingRoute): "minimum" | "buffer" | undefined {
  if (route.kind === "buy") {
    if (route.sourceTargetUsd === undefined) return undefined;
    return route.sourceTargetUsd <= PAYBIS_MIN_USD ? "minimum" : "buffer";
  }
  if (route.kind === "tokens-plus-buy") {
    return route.shortfallUsd <= PAYBIS_MIN_USD ? "minimum" : undefined;
  }
  return undefined;
}

/**
 * The row's own "why this amount" affordance, and the state that opens it.
 *
 * One instance per row since [R13], because two rows can carry one at once (`resolveFundingRoutes`
 * emits `tokens-plus-buy` and `buy` together) and a boolean shared by both would open both tooltips
 * on one tap.
 *
 * Mechanism copied byte for byte from the heading's breakdown affordance, with one deliberate change,
 * `relative` to `absolute`: the ::after hit area needs a positioned ancestor and `absolute` is one,
 * while shipping both utilities would leave the winner to Tailwind's cascade order. POO-840 [R5]:
 * Radix never opens a tooltip on a plain TAP, so the open state is controlled and `onClick` opens it,
 * while Radix keeps hover, focus, outside-tap and Esc. POO-840 [R2]'s ::after hit area takes the 16px
 * glyph to a ~44px touch target without changing its visual size.
 *
 * Geometry, from the card's right edge. `right-14` puts the 16px glyph at x 56-72 and its `-inset-3.5`
 * hit area at x 42-86: 10px clear of the chevron (x 16-32) and inside the 36px gutter the row's text
 * column opens for it. `bottom-3` rather than a vertical centre, because the `Recommended` notch is out
 * of flow below `sm` at `-translate-y-1/2` and reaches 11px above the card across this trigger's x
 * band; a centred hit area would reach 8px from the top of a 60px row and overlap it by 3px, which is
 * exactly the swallowed-tap class POO-1535 [M6.5] was opened for. Anchored to the bottom, the hit area
 * starts at rowHeight-42 (18px on a two-line row, more on a taller one), so it clears the notch at
 * every height this row can take. `z-10` is belt and braces against a future paint order, not
 * load-bearing today.
 */
function RouteAmountDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className="absolute right-14 bottom-3 z-10 inline-flex rounded-full text-muted-foreground transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        {/* `side` left unset on purpose: Radix's own collision handling flips it for a row near the
            sheet's bottom edge, and the content is portaled at `z-50`, so the sheet's overflow cannot
            clip it. */}
        <TooltipContent className="flex max-w-[320px] flex-col gap-2 text-left">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The interpolation values each title needs, and only those.
 *
 * `sourceTargetUsd` is non-null here: the caller returns the skeleton while any card lacks one, so
 * this is only reached once every amount is known.
 */
function routeTitleValues(route: FundingRoute): Record<string, string> {
  if (route.kind === "tokens-plus-buy") {
    return {
      available: formatUsd(route.availableUsd),
      // [R12] The leg the rail will really sell, never the raw gap. See {@link mixedBuyLegUsd}.
      shortfall: formatUsd(mixedBuyLegUsd(route)),
    };
  }
  return { amount: formatUsd(route.sourceTargetUsd ?? 0) };
}

/**
 * D1: the picker in the shape it will take, while the quote is in flight.
 *
 * Mirrors the ready layout's rhythm block for block rather than showing a spinner, so nothing jumps
 * when the figures land. The heading placeholder is short because the heading is short; the rows are
 * the height a one-line row actually is.
 */
function RoutePickerSkeleton({ cardCount, className }: { cardCount: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="funding-routes-loading">
      <Skeleton className="h-7 w-40" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: Math.max(cardCount, 2) }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows have no stable id
          <Skeleton key={index} className="h-[60px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
