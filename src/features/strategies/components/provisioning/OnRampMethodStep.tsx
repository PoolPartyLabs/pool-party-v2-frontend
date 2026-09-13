/**
 * @id PP-STR-CMP-028 (POO-1576, POO-1618, POO-1621, POO-1129)
 * @name OnRampMethodStep
 * @implements-rules-version v3 (POO-1129 rules v1) · v2 (POO-1618 rules v1) · v1 (POO-1576 rules v1)
 * @analytics-events none, deliberately. This step's five classes (`funding_method_viewed`,
 *   `_chosen`, `_abandoned`, `_blocked`, `_unavailable`, `funding_method_currency_changed`) are
 *   emitted by the HOST
 *   (`ProvisioningPanel`, PP-CORE-CMP-046) through PP-CORE-LIB-058, which holds the funding funnel's
 *   session context (flow, chain, strategy) that every row in that series carries. This component
 *   reports the interactions upward; it never tracks.
 *
 * "Choose how to pay": the step between the buy amount and the Paybis checkout.
 *
 * Until POO-1576 the provisioning buy route never asked. `resolveWidgetPrefill` called
 * `pickDefaultPaymentMethod`, which prefers a card by regex, and that method was sent to the mint: a
 * buyer who wanted SEPA, a bank transfer or Pix had no way to say so before the widget opened, and
 * the charge printed on the funding picker belonged to the card they had not chosen. This screen is
 * where they say so. It is a BEHAVIOUR change, not a decoration — pressing `Buy $X` now lands here,
 * and the checkout opens only once a method is picked.
 *
 * ## What a row says (frames `3c` / `3e`, Murilo 2026-08-14, corrected by POO-1129)
 *
 * ONE chip slot, and it belongs to the vendor: the provider's own `labels`, rendered verbatim
 * (POO-1603 [R3]: rendered, never branched on). Then the row's own charge for this order, or
 * `Min. $500.00` where that charge would be when the provider could not price it.
 *
 * **POO-1129 D1 removed the `Best price` pill.** Murilo: *"use as labels do vendor so."* No
 * superlative of ours sits beside a money figure. POO-1639 then removed the comparison behind it:
 * `bestPrice.ts` (PP-CORE-LIB-100) was kept "for a future cheapest-viable default" that nothing
 * schedules, so it is deleted rather than left as an export with no caller and no owner.
 *
 * ## A row below its floor is REFUSED, and the charge is never raised (POO-1129 D2/D3)
 *
 * > Murilo: *"a cobrança nunca é elevada ... a modalidade de pagamento deve ficar bloqueada com uma
 * > mensagem explicando."*
 *
 * `/deposit` shipped this first (PR #897) and this step matches its semantics deliberately, because
 * POO-1609 AC6 requires the two screens to agree for the same method and the same order. A blocked
 * row renders at reduced emphasis, in its own position, never hidden and never reordered, carrying
 * the refusal INSTEAD of its minimum so it states one fact and not two. It keeps its radio and stays
 * focusable, marked `aria-disabled` and never `disabled`, and it cannot become the host's `value`.
 *
 * A row the provider merely did not PRICE is a different thing and stays selectable: an absent
 * charge is not a comparison, and POO-1609's chosen fail direction is that "a method wrongly blocked
 * removes an option the buyer could have used, while a method wrongly offered is recoverable at
 * checkout."
 *
 * ## Instant only, for this iteration (POO-1129 A7-b)
 *
 * Non-instant methods are deferred, which contradicts the reference frames (they draw `Bank
 * transfer` here, one of them as the cheapest option). The rule wins; the frames are being redrawn.
 * The filter is ELIGIBILITY and lives in `selectInstantMethods`, upstream of every row this
 * component sees, so the [R3] rule that a consumer may RENDER a label and may not BRANCH on one
 * still governs the chip below without exception.
 *
 * ## Currency is the buyer's to choose (POO-1618, Rafael 2026-08-14)
 *
 * The frame draws a full-width currency control, and it is one: "we can leave both selectors for the
 * user to choose, none of them needs to be read-only, we only need to add the skeleton to load new
 * payment methods based on the currency selected (e.g. brazil will likely load pix and euro can load
 * mbway, so each new currency selected needs a reload on payment method)."
 *
 * Three properties it must have, and each is a rule rather than a style:
 *
 *   * **the options are the vendor's** (POO-1621, `useOnRampCurrencies`). Never a hardcoded list:
 *     the set is per pair and changes without a release, which is the defect POO-1513 deleted one
 *     layer down. With no readable set there is NO control, and the step states the resolved
 *     currency exactly as it did before, because a Select offering what it cannot switch to lies.
 *   * **the choice is a PROPOSAL** (POO-1618 [R2]). It leaves on `proposedCurrencyCodeFrom`, the
 *     server matches it against the supported set, and what comes back is what this component
 *     displays. So `currencyCode` here is always the SERVER's answer and never the buyer's request:
 *     a refused choice leaves one currency on screen and in the mint, not two.
 *   * **the list reloads under it** (POO-1618 [R3]). Not a relabel: `directa24_pix` is BRL-only and
 *     `poolparty-trustly` is USD-only, so a buyer on the wrong currency loses Pix or SEPA entirely.
 *     {@link OnRampMethodStepProps.loading} is what makes that visible; see its own note.
 *
 * A native `<select>` on purpose. The measured set is 44 fiats, and the platform's own control
 * brings type-ahead, keyboard support, and a native picker on mobile that no list of ours would
 * match. The frame's flag assets are still placeholders (Rafael: "don't worry about flag images").
 *
 * ## Nothing to choose is informational, never a dead end (POO-1576 Q3, Rafael 2026-08-13)
 *
 * "Vanishing is fine, but the empty state needs to inform the user that the provider didn't give us
 * any quotes so the user knows it's not a problem with our platform." So an empty list neither blocks
 * nor silently skips: the section keeps its shape, the provider is named as the source of the gap,
 * and `Continue` proceeds on `pickDefaultPaymentMethod`'s prefill exactly as before this issue.
 *
 * That state is now reached only when the list has actually ANSWERED with nothing. A list still in
 * flight is a third thing and says so ({@link OnRampMethodStepProps.loading}), which it has to be
 * once the buyer can change the currency: the two used to be one informational block, on the
 * argument that the window was small, and a buyer-triggered reload reopens that window on purpose,
 * every time, in the middle of the step.
 *
 * PP-INTEGRATION-POINT: every row is live Paybis data, supplied by the host from `useBuyRouteQuote`
 * (`getOnRampPaymentMethodsAction` + `getOnRampQuoteAction`, PP-CORE-LIB-063).
 */
"use client";

import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type RefObject, useId } from "react";
import { Button } from "@/components/ui/Button";
import type { OnRampMethodRow } from "@/features/strategies/lib/onRampMethodRows";
import { cn } from "@/lib/utils/cn";
import { formatFiat } from "@/lib/utils/format";
import { StickyActionFooter } from "./StickyActionFooter";

/** What {@link OnRampMethodStep} needs. */
export interface OnRampMethodStepProps {
  /** The rows to choose between, already built by `buildOnRampMethodRows`. Empty is a valid state. */
  rows: readonly OnRampMethodRow[];
  /**
   * ISO-4217 the list and its figures are denominated in, as the SERVER resolved it (POO-1512), or
   * as it ANSWERED a buyer's proposal with (POO-1618 [R2]). Never the raw proposal: a refused choice
   * would otherwise print one currency beside another's figures.
   *
   * Absent while the list has not resolved, where the currency is not known either.
   */
  currencyCode?: string;
  /**
   * POO-1621: the fiats this pair can be bought with, from the server, or nothing when the set could
   * not be read. Nothing means NO control: the step states {@link currencyCode} instead, which is
   * what it did before the control existed.
   *
   * A single option is also not a control and is rendered the same way. That is deliberate rather
   * than incidental: it is the shape a fabricated or collapsed set would take, and offering a
   * chooser with one choice invites the buyer to look for an option this pair does not have.
   */
  currencies?: readonly string[];
  /** The buyer proposed a different currency. Absent when the step cannot offer the choice. */
  onCurrencyChange?: (currencyCode: string) => void;
  /**
   * POO-1618 [R3]: a methods call is IN FLIGHT, so the rows below are neither the answer nor the
   * absence of one.
   *
   * It exists for the currency reload and is correct on the first load too. What it must never do is
   * GATE: `Continue` stays enabled through it, on the prefill the rail has always used, because Q3's
   * "never a dead end, never a spinner that traps the user mid-funding" applies to a slow list
   * exactly as it does to an empty one.
   */
  loading?: boolean;
  /**
   * The Paybis identifier currently selected, or nothing when no list has resolved AND when every
   * row is blocked. The host never puts a blocked identifier here (POO-1129 D3): a method this
   * order cannot reach is never the one the step shows as chosen nor the one the mint receives.
   */
  value?: string;
  /** The buyer picked a REACHABLE row. Fires for every pick, including one that reselects it. */
  onSelect: (paymentMethod: string) => void;
  /**
   * POO-1129 D3: the buyer activated a BLOCKED row. Premise 11's blocked intent, and never a
   * selection.
   *
   * Separate from {@link onSelect} rather than folded into it, so the contract says out loud that a
   * blocked identifier can never travel the selection path. The host owns the dedupe: one refusal
   * per method per entry is the meaningful unit, not one per click.
   */
  onBlockedSelect: (paymentMethod: string) => void;
  /** `Continue`: proceed to the checkout with {@link value}, or with the prefill when there is none. */
  onContinue: () => void;
  /** `Cancel`: end the purchase without opening the checkout. */
  onCancel: () => void;
  /**
   * The step's body, so the host can land focus on it (a11y).
   *
   * Opening this step UNMOUNTS the carousel, and the carousel holds a keyboard-reachable control, so
   * a keyboard or screen-reader user who was on it would be dropped to `body` with no event fired.
   * The host samples that at the moment of the swap (the only moment both facts exist at once) and
   * focuses this; the same relay then carries focus on to the mini summary when the checkout opens.
   */
  containerRef?: RefObject<HTMLDivElement | null>;
}

/** The currency's own name in the reader's language, or nothing when the runtime cannot name it. */
function currencyName(locale: string, code: string): string | undefined {
  try {
    // A native platform capability rather than 12 locales x N currencies of our own copy: the ICU
    // data ships with the runtime and is already correct in every locale this app configures.
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    // `of` echoes the input when it has no name for it, which is not a name.
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/** One method row: a radio, the name, its vendor labels, and its charge, floor or refusal. */
function MethodRow({
  row,
  selected,
  onSelect,
  onBlockedSelect,
}: {
  row: OnRampMethodRow;
  selected: boolean;
  onSelect: () => void;
  onBlockedSelect: () => void;
}) {
  const t = useTranslations("strategies");
  const blocked = row.blocked;

  return (
    <label
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl border p-3.5 transition-colors",
        "focus-within:ring-2 focus-within:ring-ring",
        blocked
          ? "cursor-not-allowed border-border opacity-60"
          : selected
            ? "cursor-pointer border-input bg-surface-raised"
            : "cursor-pointer border-border hover:bg-surface-raised",
      )}
      data-testid="onramp-method-row"
      data-method={row.id}
      data-blocked={blocked ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      {/*
        POO-1129 D3: `aria-disabled` and NEVER `disabled`. A `disabled` radio leaves the tab order,
        so a screen-reader user never reaches the option and never hears why it does not serve them,
        which is strictly worse than hearing that it is unavailable and why. It stays focusable,
        stays announced, and refuses the SELECTION instead. The refused activation is still reported
        upward, because wanting to pay that way and being told no is premise 11's blocked intent and
        it must be counted whether or not the row was already known to be refused.
      */}
      <input
        type="radio"
        name="onramp-payment-method"
        value={row.id}
        checked={selected}
        aria-disabled={blocked || undefined}
        onChange={blocked ? onBlockedSelect : onSelect}
        className="sr-only"
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground text-sm">{row.name}</span>
        {/* POO-1603 [R3]: the vendor's tags, verbatim and neutral. Nothing HERE branches on the
          value. A7-b's instant rule reads one, and it does so as ELIGIBILITY before a row is built
          (`selectInstantMethods`), never as presentation: the two are deliberately separate, so a
          label can never change how a row that is on screen looks or behaves. POO-1129 D1 removed
          the one chip in this slot that was ours rather than the vendor's. */}
        {row.labels.map((label) => (
          <span
            key={label}
            className="rounded-full bg-surface-raised px-2 py-0.5 text-muted-foreground text-xs"
          >
            {label}
          </span>
        ))}
      </span>
      {/* The refusal, the charge, or the floor where the charge would be. `formatFiat` with the
        figure's OWN currency, never `formatUsd`: since POO-1512 a minimum can be EUR 500 and
        `$500.00` would be a different number.

        POO-1129 D3: on a blocked row the refusal REPLACES the figure rather than stacking under it,
        so a blocked row states one fact and not two. */}
      {blocked && row.minimum ? (
        <span className="shrink-0 text-muted-foreground text-sm">
          {t("provisioning.onramp.method.blocked", {
            amount: formatFiat(row.minimum.amount, row.minimum.currencyCode),
          })}
        </span>
      ) : row.charge ? (
        <span className="shrink-0 text-foreground text-sm tabular-nums">
          {formatFiat(row.charge.amount, row.charge.currencyCode)}
        </span>
      ) : row.minimum ? (
        <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
          {t("provisioning.onramp.method.minimum", {
            amount: formatFiat(row.minimum.amount, row.minimum.currencyCode),
          })}
        </span>
      ) : null}
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground" : "border-border",
        )}
        aria-hidden="true"
      >
        {selected ? <span className="size-2.5 rounded-full bg-foreground" /> : null}
      </span>
    </label>
  );
}

/** The "Choose how to pay" step: the buyer's method, before the checkout opens. */
export function OnRampMethodStep({
  rows,
  currencyCode,
  currencies,
  onCurrencyChange,
  loading = false,
  value,
  onSelect,
  onBlockedSelect,
  onContinue,
  onCancel,
  containerRef,
}: OnRampMethodStepProps) {
  const t = useTranslations("strategies");
  const locale = useLocale();
  const listLabelId = useId();
  const currencyLabelId = useId();
  const selected = rows.find((row) => row.id === value);
  /**
   * POO-1129 D3 / POO-1609 [P38]: the list ANSWERED and no row in it can take this order.
   *
   * A list that is merely empty is a different state and keeps `Continue` live (Q3): there, the
   * provider told us nothing and the checkout can still ask. Here it told us something, and
   * continuing would open a checkout every method refuses.
   *
   * `/deposit` cannot reach this state at all, so this is not a divergence from it: its quote is
   * PINNED to one method, blockedness accumulates one refusal at a time, and the fallback it hands
   * back is always the CHECKED row, which dispatches no change event and so can never become the
   * next refusal. This step reads the UNPINNED listing quote (POO-1599), which prices every row at
   * once, so "all blocked" is a fact the quote can state directly with no selection involved.
   */
  const allBlocked = rows.length > 0 && rows.every((row) => row.blocked);
  /**
   * The smallest floor in the list: the least the buyer would have to reach to unblock ANYTHING.
   *
   * Comparing the amounts is sound rather than convenient: a row only blocks when its own floor and
   * its own charge were proved to share a currency, and every charge came from ONE quote with one
   * `chargeCurrencyCode`, so all blocked floors are denominated alike. The winner's own code is
   * still what formats it.
   */
  const lowestFloor = rows.reduce<OnRampMethodRow["minimum"]>((lowest, row) => {
    if (!row.minimum) return lowest;
    return lowest === undefined || row.minimum.amount < lowest.amount ? row.minimum : lowest;
  }, undefined);
  const name = currencyCode ? currencyName(locale, currencyCode) : undefined;
  /**
   * Whether there is a CHOICE. One option is not one, and neither is an unreadable set: both render
   * the read-only statement, which is a true sentence rather than a control that cannot move.
   *
   * The resolved currency is unioned in rather than assumed present: the server can answer with a
   * currency the cached set has not caught up with, and a Select whose value is not among its own
   * options silently displays the FIRST one, which would show a currency nobody is being charged.
   */
  const options =
    currencies && currencyCode && onCurrencyChange
      ? [...new Set([currencyCode, ...currencies])].sort()
      : undefined;
  const canChoose = options !== undefined && options.length > 1;

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="flex flex-col gap-4 focus-visible:outline-none"
        data-testid="provisioning-method-step"
      >
        <h3 className="font-semibold text-foreground text-lg">
          {t("provisioning.onramp.method.title")}
        </h3>

        {currencyCode ? (
          <div className="flex flex-col gap-1.5">
            <p
              id={currencyLabelId}
              className="text-muted-foreground text-xs uppercase tracking-wide"
            >
              {t("provisioning.onramp.method.currencyLabel")}
            </p>
            {canChoose && options ? (
              // POO-1618: the buyer's own choice. `value` is the SERVER's answer, so a refused
              // proposal snaps the control back to what is actually being charged rather than
              // leaving it showing a currency nobody will be billed in.
              <div className="relative">
                <select
                  aria-labelledby={currencyLabelId}
                  className="min-h-11 w-full appearance-none rounded-xl bg-surface-raised py-3 pr-10 pl-3.5 text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="provisioning-method-currency"
                  onChange={(event) => onCurrencyChange?.(event.target.value)}
                  value={currencyCode}
                >
                  {options.map((code) => {
                    const label = currencyName(locale, code);
                    return (
                      <option key={code} value={code}>
                        {label ? `${code} · ${label}` : code}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            ) : (
              // POO-1630 / POO-494 [R1]: the honest degrade. With no set to choose from there is
              // nothing to open, and a chevron that opens nothing approximates the frame worse than
              // a true statement of what the buyer is being charged in.
              <div
                className="flex min-h-11 items-center gap-3 rounded-xl bg-surface-raised px-3.5 py-3"
                data-testid="provisioning-method-currency-static"
              >
                {/* The frame's flag, as a placeholder: the ISO code is the identity, and no flag
                  asset is worth blocking this screen on (Rafael 2026-08-14). */}
                <span
                  aria-hidden="true"
                  className="rounded-md border border-border px-1.5 py-0.5 font-medium text-muted-foreground text-xs"
                >
                  {currencyCode}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground text-sm">
                  {name ?? currencyCode}
                </span>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              {t("provisioning.onramp.method.currencyNote")}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p id={listLabelId} className="text-muted-foreground text-xs uppercase tracking-wide">
            {t("provisioning.onramp.method.listLabel")}
          </p>
          {loading ? (
            /* POO-1618 [R3]: the currency just changed and the new list is on its way. Three bars
              because three is the shape of the frame's own list, not because three is the answer.
              `aria-busy` says the same thing to a screen reader that the shimmer says to an eye. */
            <div
              aria-busy="true"
              aria-live="polite"
              className="flex flex-col gap-2"
              data-testid="provisioning-method-loading"
            >
              <span className="sr-only">{t("provisioning.onramp.method.loading")}</span>
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className="h-[60px] animate-pulse rounded-xl bg-surface-raised"
                />
              ))}
            </div>
          ) : rows.length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: a native <fieldset> cannot carry this
            // layout without resetting the grid the rows sit in; the ARIA group is the same promise.
            <div role="radiogroup" aria-labelledby={listLabelId} className="flex flex-col gap-2">
              {rows.map((row) => (
                <MethodRow
                  key={row.id}
                  row={row}
                  selected={!row.blocked && row.id === value}
                  onSelect={() => onSelect(row.id)}
                  onBlockedSelect={() => onBlockedSelect(row.id)}
                />
              ))}
            </div>
          ) : (
            // Q3: the section keeps its shape, the provider is named, and Continue still works.
            <p
              className="rounded-xl border border-border bg-surface px-3.5 py-3 text-muted-foreground text-sm"
              data-testid="provisioning-method-unavailable"
            >
              {t("provisioning.onramp.method.unavailable")}
            </p>
          )}
        </div>

        {/* POO-1129 D3 / POO-1609 [P38]: a dead end is a defect and not a state, so it is drawn.
          The message names the lowest floor, and the control that clears it is `Cancel` directly
          below, which returns to the step the amount lives on. */}
        {allBlocked && lowestFloor ? (
          <p
            className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-warning"
            data-testid="provisioning-method-all-blocked"
          >
            {t("provisioning.onramp.method.allBlocked", {
              amount: formatFiat(lowestFloor.amount, lowestFloor.currencyCode),
            })}
          </p>
        ) : selected?.unpriced && selected.minimum ? (
          /* The floor of a row the provider did not price, named AFTER the pick rather than in the
            row (frame 3e: the row shows the figure and nothing else). It is NOT a block: an absent
            charge is not a comparison, so the row stays selectable and this warns instead. Both
            obligations Rafael's Q2 answer made a rule: the floor is the PROVIDER's, and any surplus
            stays the buyer's. */
          <p
            className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-warning"
            data-testid="provisioning-method-minimum-notice"
          >
            {t("provisioning.onramp.method.minimumNotice", {
              method: selected.name,
              amount: formatFiat(selected.minimum.amount, selected.minimum.currencyCode),
            })}
          </p>
        ) : null}
      </div>

      {/* POO-1525: the footer is the phase root's own last child, never nested in the body above —
        `position: sticky` cannot escape its containing block. Rendered as a sibling through this
        fragment so the host's phase root stays the sticky anchor. */}
      <StickyActionFooter>
        {/* Disabled ONLY on the all-blocked dead end. Q3's "never a spinner that traps the user" is
          untouched: a slow list and an empty one both keep this live, on the rail's own prefill. */}
        <Button
          className="w-full"
          size="lg"
          disabled={allBlocked}
          onClick={onContinue}
          data-testid="provisioning-method-continue"
        >
          {t("provisioning.onramp.method.continue")}
        </Button>
        <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
          {t("provisioning.onramp.method.cancel")}
        </Button>
      </StickyActionFooter>
    </>
  );
}
