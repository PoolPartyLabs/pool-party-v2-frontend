/**
 * @id PP-DEP-CMP-005
 * @name PaymentMethodList
 * @implements-rules-version v4 (POO-1643 rules v1) · v3 (POO-1612 rules v1) · v2 (POO-1609 rules v1) · v1 (POO-1612 rules v1)
 *
 * The payment-method ROWS, extracted from {@link PaymentMethodDialog} so both the dialog (below
 * `lg`) and the inline payment-method section on the amount step (`lg` and above, POO-1612 S2) can
 * render them from one place. Defining the blocked-row rules here once is the reason this file
 * exists rather than two copies drifting apart.
 *
 * ## The blocked row (POO-1609)
 *
 * The shipped "raise the order to the method's minimum" is deleted, not gated (murilo, 2026-08-14,
 * second and standing reversal: "the charge is never raised"). A method whose own minimum exceeds
 * the order instead renders BLOCKED, in its normal position, never hidden and never reordered:
 * `method.blocked` replaces `method.minimum` (one line, not two), the radio cannot become the
 * selection, and it carries `aria-disabled="true"` rather than `disabled` — a `disabled` control
 * drops out of the tab order, and a method the buyer cannot reach and cannot hear announced is worse
 * than one they can hear is unavailable and why. The comparison itself
 * ({@link isMethodBelowFloor}, PP-CORE-LIB-101) is two-tiered and lives outside this component so
 * a host needing the same "is everything blocked" answer (to disable Continue and name the lowest
 * floor) reads the identical rule rather than a second guess at it.
 *
 * ## Every row carries its own charge (POO-1612, inverts an older rule)
 *
 * Until POO-1599 a quote priced ONE method, so a charge could only ever render on the row that was
 * SELECTED. POO-1599 unpinned the listing quote (Paybis prices every method for the pair in one
 * call), so `useBuyRouteQuote` now exposes the whole answer (`BuyRouteQuoteState.quote`) and every
 * row shows its OWN figure, not only the active one: comparing prices side by side is the reason
 * this list is inline on desktop rather than hidden in a modal. A BLOCKED row is the one exception:
 * it carries `method.blocked` and no charge, even when the quote priced it.
 *
 * ## The chip slot is the VENDOR's (POO-1603 [R3], and D1's other half)
 *
 * `labels` has ridden `OnRampPaymentMethod` since POO-1603 and nothing rendered it until now. Every
 * label the vendor sends is printed, all of them, verbatim, in one generic chip that never branches
 * on the value: POO-1603 made "a consumer may RENDER a label and may not BRANCH on one" a contract
 * because the value set is undocumented, and a chip keyed on `"instant"` drops whatever Paybis adds
 * next. Multiple labels per method is the normal case, not an edge case: the live sandbox capture
 * (14/08) shows one method carrying all three of `instant`, `low-fee` and `high-approval-rate`.
 *
 * The whole vocabulary is POSITIVE, and a slow rail expresses itself only by OMITTING `instant`. So
 * this prints no slowness of its own: there is no "1-2 business days" in the payload and inventing
 * one is the forbidden thing {@link OnRampPaymentMethod.labels} exists to replace.
 *
 * ## The vendor's logo, through our own origin (POO-1643, X11 of epic POO-1129)
 *
 * `icon` rides the same payload as `labels` and was RENDERED BY NOTHING until now, because an `<img>`
 * pointed at `cdn.paybis.com` would tell a payment venue, from the buyer's own IP and with a
 * referrer, that they opened a picker they have not chosen anything in. Paybis otherwise learns
 * nothing about a buyer until `request-id` is minted, which is a deliberate act.
 *
 * POO-1643 settles it rather than deferring it: every `src` here is a RELATIVE path to our own proxy
 * ({@link buildMethodIconProxyUrl}, `PP-CORE-SEC-003`), our server fetches the bytes, and a relative
 * URL is structurally incapable of reaching another origin. So the logo renders and the disclosure
 * does not happen.
 *
 * The fallback is ONE neutral tile for every method, and that is a rule and not a style. `icon` is
 * optional BY CONTRACT (POO-1603 [R4]), so absence is the normal answer and not a degraded one, and
 * the whole reason POO-1603 carried the field through was to stop this picker "inventing a glyph
 * family" per method. A monogram (the {@link ManagerAvatar} / {@link TokenLogo} precedent) is
 * deliberately NOT used here: it derives from the display name, which sits on the same row two
 * elements away, so it would print the same letter twice and would be a per-method mark in a slot
 * that must carry none.
 *
 * ## No superlative of ours sits beside a money figure (D1, epic POO-1129, 16/08)
 *
 * A **Best price** pill was built here and is deleted, not hidden: murilo, *"use as labels do vendor
 * so"* — use the vendor's labels only. The chip slot beside a row belongs to what PAYBIS says about
 * its own method, never to a claim this app derives and then has to defend on a money screen.
 *
 * POO-1639 finished it: `selectBestPriceMethodIds` (PP-CORE-LIB-100) was kept unwired on the argument
 * that it would back a cheapest-viable default, and that default was never built and no open issue
 * schedules one. The module is deleted rather than left as an unexplained export. If a default ever
 * needs the comparison, it comes back from `git show b0624813:src/lib/onramp/bestPrice.ts`, and it
 * still puts no copy on screen.
 *
 * This list owns no state and fires no analytics (POO-1612): activating a blocked row still calls
 * the ONE `onSelect`, so the host decides whether the activation was a real pick or a blocked
 * intent to report.
 *
 * PP-INTEGRATION-POINT: the rows are the live Paybis method list, supplied by the host from
 * `useBuyRouteQuote` (`getOnRampPaymentMethodsAction`, PP-CORE-LIB-063).
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { isMethodBelowFloor } from "@/lib/onramp/methodFloor";
import { buildMethodIconProxyUrl } from "@/lib/onramp/methodIconProxy";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import { cn } from "@/lib/utils/cn";
import { formatFiat } from "@/lib/utils/format";

/** One row's own charge, when the quote priced it. */
export interface PaymentMethodCharge {
  /** The figure, in {@link currencyCode}. Never re-derived here; it is Paybis' own number. */
  amount: number;
  /** POO-1512 [R7]: what it is billed in. The buyer is not necessarily charged in dollars. */
  currencyCode: string;
}

/** Shared geometry, so the logo and the tile it degrades to occupy the identical box. */
const ICON_BOX = "size-8 shrink-0 rounded-lg";

/**
 * The method's logo, served from our own origin, with one neutral tile behind it (POO-1643 [R6]).
 *
 * Four causes, one appearance: the vendor sent no icon, `wireIconSchema` decoded a value it could not
 * vouch for to absence, {@link buildMethodIconProxyUrl} refused it here, or the image failed in the
 * browser. The last one is why this holds state at all and is the {@link ManagerAvatar} pattern
 * (PP-MGR-CMP-033, POO-771 R8): a URL that validated can still 404, and a broken-image icon on a
 * money screen reads as our defect.
 *
 * Decorative: the method name is the next element on the row and carries the meaning, so an empty
 * `alt` here is what stops a screen reader announcing the method twice.
 */
function MethodIcon({ icon }: { icon?: string }) {
  const source = buildMethodIconProxyUrl(icon);
  const [failed, setFailed] = useState(false);

  if (source === undefined || failed) {
    // No mark, no letter, no borrowed iconography: an empty slot makes no claim about a rail whose
    // logo we do not have, and keeps every row's text on the same left edge.
    return (
      <span
        aria-hidden="true"
        data-testid="payment-method-icon-fallback"
        className={cn(ICON_BOX, "border border-border bg-surface-raised")}
      />
    );
  }

  // A plain `<img>`, matching every other logo in this app (`TokenLogo`, `ManagerAvatar`), and here
  // it is forced rather than conventional: `next/image` refuses an SVG upstream without the GLOBAL
  // `dangerouslyAllowSVG` and throws without `sharp`, which this repo does not ship. The measurement
  // is in the route's header. Biome's `noImgElement` warning is the same one those two carry.
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
      className={cn(ICON_BOX, "object-contain")}
    />
  );
}

/** A selectable method row (radio). Blocked rows stay focusable but cannot become the selection. */
function MethodRow({
  selected,
  blocked,
  icon,
  name,
  labels,
  meta,
  charge,
  onSelect,
}: {
  selected: boolean;
  blocked: boolean;
  icon?: string;
  name: string;
  labels: readonly string[];
  meta: string | null;
  charge: string | null;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3.5 transition-colors",
        "focus-within:ring-2 focus-within:ring-ring",
        blocked
          ? "border-border opacity-60"
          : selected
            ? "border-input bg-surface-raised"
            : "border-border hover:bg-surface-raised",
      )}
    >
      {/*
        POO-1609 [S2]: `aria-disabled` and NEVER `disabled`. A `disabled` radio leaves the tab order,
        so a screen-reader user never reaches the option and never hears why it does not serve them.
        It stays focusable, stays announced, and refuses the change instead. The controlled `checked`
        makes React restore the row on the native click a label always performs.
      */}
      <input
        type="radio"
        name="payment-method"
        checked={selected}
        aria-disabled={blocked ? "true" : undefined}
        onChange={onSelect}
        className="sr-only"
      />
      <MethodIcon icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="block font-medium text-foreground text-sm">{name}</span>
          {/*
            POO-1603 [R3]: the vendor's own tags, ALL of them, exactly as they arrived. One generic
            chip and no branch on the value: POO-1603 made "may RENDER, may not BRANCH" a contract
            because the value set is undocumented, so a chip keyed on "instant" silently drops
            whatever Paybis adds next. Not translated either: it is provider data, not our copy, and
            since D1 it is the ONLY thing allowed in this slot.
          */}
          {labels.map((label) => (
            <span
              key={label}
              className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 font-medium text-muted-foreground text-xs"
            >
              {label}
            </span>
          ))}
        </span>
        {meta ? <span className="block text-muted-foreground text-xs">{meta}</span> : null}
      </span>
      {charge ? <span className="shrink-0 text-foreground text-sm">{charge}</span> : null}
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

/** Public props for {@link PaymentMethodList}. */
export interface PaymentMethodListProps {
  /**
   * The live methods for the buyer's resolved currency. `undefined` while unresolved and when the list
   * could not be read: both render the informational state, never a blocker (see `PaymentMethodDialog`'s
   * header).
   */
  methods?: OnRampPaymentMethod[];
  /** The Paybis identifier currently selected (the buyer's choice, or the list-derived default). */
  value?: string;
  /** Called with the Paybis identifier of the row the buyer activated, blocked or not (see header). */
  onSelect: (paymentMethod: string) => void;
  /** Every row's OWN charge, keyed by Paybis identifier, when the quote priced it. */
  charges?: Record<string, PaymentMethodCharge>;
  /** The buyer's entered amount (USDC, received-fixed), for the tier-2 comparison on an unpriced row. */
  enteredAmount: number;
  /**
   * POO-1630: a methods call is IN FLIGHT, so an empty list means "not yet" and not "none".
   *
   * Without it every currency pick prints "Paybis did not return any payment options right now" for
   * the length of a real round trip, which accuses the provider of an outage during OUR reload. That
   * window existed before the currency control (first paint, the pair flip) but the buyer could not
   * cause it; now they cause it deliberately, every time.
   *
   * Optional because the callers that never reload have nothing to say here, and absent reads as
   * "nothing in flight", which is the correct answer for them.
   */
  loading?: boolean;
}

/** The payment-method rows, built from the live Paybis list. Owns no state. */
export function PaymentMethodList({
  methods,
  value,
  onSelect,
  charges,
  enteredAmount,
  loading,
}: PaymentMethodListProps) {
  const t = useTranslations("deposit");
  const hasMethods = methods !== undefined && methods.length > 0;

  // Checked BEFORE the empty state, deliberately: mid-reload the list is empty AND in flight, and of
  // the two facts only "in flight" is true about the provider. Three bars because three is the shape
  // of this list, not a claim about how many methods are coming. Mirrors the provisioning step.
  if (loading && !hasMethods) {
    return (
      <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
        <span className="sr-only">{t("method.loading")}</span>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="h-[60px] animate-pulse rounded-xl bg-surface-raised"
          />
        ))}
      </div>
    );
  }

  if (!hasMethods) {
    return (
      <p className="rounded-xl border border-border bg-surface px-3 py-3 text-muted-foreground text-sm">
        {t("method.unavailable")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {methods.map((method) => {
        const charge = charges?.[method.paymentMethod];
        const blocked = isMethodBelowFloor({ method, charge, enteredAmount });
        const selected = !blocked && value === method.paymentMethod;
        return (
          <MethodRow
            key={method.paymentMethod}
            selected={selected}
            blocked={blocked}
            icon={method.icon}
            name={method.displayName}
            // A blank tag is a chip with no text, so it is dropped; the rest of the row is untouched.
            labels={(method.labels ?? []).filter((label) => label.trim() !== "")}
            meta={
              blocked
                ? t("method.blocked", {
                    amount: formatFiat(method.minUsd, method.minCurrencyCode),
                  })
                : method.minUsd > 0
                  ? t("method.minimum", {
                      amount: formatFiat(method.minUsd, method.minCurrencyCode),
                    })
                  : null
            }
            charge={
              !blocked && charge
                ? t("method.charge", {
                    amount: formatFiat(charge.amount, charge.currencyCode),
                  })
                : null
            }
            onSelect={() => onSelect(method.paymentMethod)}
          />
        );
      })}
    </div>
  );
}
