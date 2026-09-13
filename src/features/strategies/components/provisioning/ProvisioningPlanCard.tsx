/**
 * @id PP-CORE-CMP-044 (POO-1927)
 * @name ProvisioningPlanCard
 * @implements-rules-version v8 (POO-1927 rules v1) · v7 (POO-1575 rules v2) · v6 (POO-1381 rules v2) · v5 (POO-1136 / POO-1129 rules v3) · v4 (POO-1088 rules v2) · v3 (POO-1087 rules v1) · v2 (POO-1041 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The Plan-state body of the provisioning wizard (PP-CORE-MOD-011, POO-409): a card listing the
 * assembled steps as numbered {@link PlanStepRow}s, fed by the pure {@link buildPlanView} mapping. It
 * resolves the i18n titles/captions (the op row renders the caller's `opLabel`; a row interpolates
 * `{network}` / `{token}` from the values the mapper carries; the buy caption appends whatever
 * vendor attribution the mapper's `attributionKey` names), and slots the inline gas selector into the
 * gas row. No "You pay" total is rendered (fees abstracted, decided 2026-06-30).
 *
 * v2 (POO-1041): the card renders a REAL plan, which differs from a fixture in three visible ways.
 * The rail's approval rows appear, so the list is what the wallet will actually ask for ([R6]). A
 * bridge row says how long it takes, from the quote's own estimate ([R2]). And once a leg has
 * broadcast, its row links to the transaction on the chain it was sent on ([R2]) — a transfer that
 * takes minutes is indistinguishable from a hung app without it. A row with no hash, or on a chain
 * this app cannot name an explorer for, renders no link at all ([R4]).
 *
 * v6 (POO-1381): on the Confirm screen the step list COLLAPSES by default, behind a real disclosure
 * button (`aria-expanded` + `aria-controls`), so a phone reaches the "You pay" summary and the CTA
 * without scrolling past five steps and their sub-lines. Two carve-outs, both so the collapse
 * declutters WITHOUT hiding something the user needs (rules v2): the `running` and failed screens
 * ([R1]-[R7] of POO-1088) are never collapsed, because hiding the step in flight during a live
 * purchase is a regression, not a cleanup; and a plan that renders the inline gas selector stays
 * expanded, because that is where the user picks the top-up and the CTA can hang on its validity (it
 * is also the "One step" plan, which has nothing to declutter). The rows stay MOUNTED while collapsed
 * (the `hidden` attribute, the same pattern as {@link CollapsibleReceiptRows}), so `aria-controls`
 * resolves and the e2e leg contract is untouched; `hidden` is what drops them from layout and the
 * accessibility tree. The "You pay" summary is a separate sibling ({@link ProvisioningCostBreakdown},
 * whose own "Show more" discloses the FEE itemisation), so this collapse cannot affect it.
 *
 * v7 (POO-1575): the buy row's caption names the payment methods that resolved for THIS buyer
 * (`{methods}`, joined in the active locale) instead of the hardcoded "Card or Pix" it shipped with.
 * The attribution is untouched by that: it hangs on the caption KEY existing, and both the named and
 * the neutral branch supply one.
 *
 * v8 (POO-1927): the attribution is no longer the Paybis key. This card resolves `row.attributionKey`,
 * whatever the mapper decided from the rail, because the previous `poweredByPaybis` boolean credited
 * Paybis on every fiat leg including one Privy brokers through Stripe or MoonPay. The card stays dumb:
 * the rail-to-copy decision is `provisioningView`'s, testable without React.
 */
"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { networkStableSymbol } from "@/lib/chains/config";
import type { TxErrorKind } from "@/lib/tx/diagnostics";
import { cn } from "@/lib/utils/cn";
import { SigningDisclosure } from "../SigningDisclosure";
import { executionStepCopy } from "./executionCopy";
import { PlanStepRow } from "./PlanStepRow";
import { formatPaymentMethods, type PlanRow, type PlanView } from "./provisioningView";

/** Public props for {@link ProvisioningPlanCard}. */
export interface ProvisioningPlanCardProps {
  /** The mapped plan view (from {@link buildPlanView}). */
  view: PlanView;
  /** Title for the op anchor row, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /**
   * `plan` is the Confirm screen, `running` the execution one (POO-1088 [F5-R1]).
   *
   * The SAME card, deliberately. The design shows execution as the list the user just confirmed,
   * with statuses and the same figures, and `PlanView` already carries `status`, `txHash` and
   * `explorerNetwork` per row. Swapping in a separate stepper would be a second list to keep aligned
   * with the first, which is exactly the misalignment POO-1041 [R6] was opened to fix.
   */
  mode?: "plan" | "running";
  /** What `running` needs beyond the rows themselves. Ignored in `plan` mode. */
  execution?: {
    /** Has any step failed? An `idle` row means "not started" after that, not "waiting". */
    routeFailed?: boolean;
    /** The classification of the failure, for the row that carries it. */
    errorKind?: TxErrorKind;
    /** The plan's OWN max-slippage, so the failure line quotes a real figure, never a default. */
    slippagePct?: number;
  };
}

/**
 * The status mark that replaces the step number while a route runs ([F5-R1]).
 *
 * Never colour alone: each state has a different SHAPE (check, spinner, number, cross), so it
 * survives a monochrome rendering and any form of colour blindness. Decorative, because the row's
 * sub-line already says the same thing in words.
 */
function StatusBadge({ status, index }: { status: PlanRow["status"]; index: number }) {
  const base =
    "flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs";
  if (status === "done") {
    return (
      <span aria-hidden="true" className={cn(base, "bg-success/15 text-success")}>
        <Check className="size-3.5" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span aria-hidden="true" className={cn(base, "bg-destructive/15 text-destructive")}>
        <X className="size-3.5" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span aria-hidden="true" className={cn(base, "relative bg-primary/15 text-primary")}>
        {/* The NUMBER stays and a ring spins around it, per [F5-R1] and the Figma. A spinner that
            REPLACES the number says something is happening and forgets to say which step it is,
            which is the one thing the badge column exists to answer. */}
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        {index}
      </span>
    );
  }
  // idle / skipped: the number, muted. It is still a step, it just has not run.
  return (
    <span aria-hidden="true" className={cn(base, "bg-surface-raised text-muted-foreground")}>
      {index}
    </span>
  );
}

/**
 * The interpolation values a row's label needs, and only those.
 *
 * Built conditionally because next-intl rejects a message whose placeholder has no value, and a
 * message with no placeholder is happy to be handed an empty object.
 */
export function labelValues(row: PlanRow): Record<string, string> {
  return {
    ...(row.networkName === undefined ? {} : { network: row.networkName }),
    ...(row.tokenSymbol === undefined ? {} : { token: row.tokenSymbol }),
  };
}

/**
 * The values a row's CAPTION needs, which are not the title's (POO-1087 [F4-R2]).
 *
 * A bridge's title names where the funds GO and its caption names where they come FROM, so handing
 * both the same `{network}` would make the caption lie about half the route.
 *
 * POO-1575: `{methods}` rides here too, joined in the ACTIVE locale (`Intl.ListFormat`, so the
 * separator between "Pix" and a card is translated rather than an English " or "). It is added only
 * when the row carries names, which is exactly when the mapper chose the caption key that has the
 * placeholder: next-intl THROWS on a placeholder with no value, and tolerates a value with no
 * placeholder, so the conditional belongs on this side.
 */
export function captionValues(row: PlanRow, locale: string): Record<string, string> {
  const network = row.sourceNetworkName ?? row.networkName;
  const methods = formatPaymentMethods(row.paymentMethodNames, locale);
  return {
    ...(network === undefined ? {} : { network }),
    ...(row.tokenSymbol === undefined ? {} : { token: row.tokenSymbol }),
    ...(methods === undefined ? {} : { methods }),
    // POO-1779 [R1]: "Paid from your USDG" on Robinhood Chain. Always present, because the caption
    // that reads it must never render a raw `{stable}` when the row could not name its chain.
    stable: networkStableSymbol(row.sourceNetwork),
  };
}

/** The numbered step list card shown in the wizard's Plan state. */
export function ProvisioningPlanCard({
  view,
  opLabel,
  mode = "plan",
  execution,
}: ProvisioningPlanCardProps) {
  const t = useTranslations("strategies");
  // POO-1575: the caption's `{methods}` list is joined with this locale's own disjunction.
  const locale = useLocale();
  const running = mode === "running";
  /**
   * POO-1381 [R1]/[R2]: on the Confirm screen the step list opens CLOSED, so the "You pay" summary
   * and CTA are reachable on a phone. One carve-out, because the collapse must declutter WITHOUT
   * hiding something the user needs: `running` (and the failed screen) is never collapsed, so the
   * step in flight is always on screen ([R3]). A collapsed card mid-purchase is a regression, not a
   * cleanup.
   *
   * POO-1509 [R34] retired the second carve-out. It existed for the inline gas selector, a control
   * the user had to operate and the CTA could hang on, so a card that rendered it stayed expanded.
   * With no picker in this flow there is no such control, and the "One step" gas plan this mostly
   * described is now a screen of its own ({@link GasTopUpBody}).
   */
  const collapsible = !running;
  const [stepsOpen, setStepsOpen] = useState(false);
  const listId = useId();

  const list = (
    <ol
      id={listId}
      // Kept mounted while collapsed (the `hidden` attribute, as {@link CollapsibleReceiptRows} does)
      // so the toggle's aria-controls always resolves and the rows stay addressable; `hidden` is what
      // drops them from layout and from the accessibility tree.
      //
      // That last part holds ONLY because Tailwind preflight ships
      // `[hidden]:where(:not([hidden="until-found"])) { display: none !important }`. Without the
      // `!important` the `flex` class below would win and a "collapsed" row would stay visible. The
      // jsdom tests assert visibility by reading the attribute, so they would NOT catch preflight
      // being customised out; this would silently stop hiding anything.
      hidden={collapsible && !stepsOpen}
      className="flex flex-col rounded-2xl border border-border bg-white/[0.04] p-4"
    >
      {view.rows.map((row, i) => {
        const title = row.isOp ? opLabel : t(row.labelKey, labelValues(row));
        // [F5-R2] While running, the sub-line says where the step GOT TO, not what it is. The
        // plan caption has already been read; the status has not.
        const execCopy = running
          ? executionStepCopy({
              status: row.status,
              // POO-1136: the fiat buy's active state is the embedded widget, not a wallet prompt.
              ...(row.type === "buy" ? { inIframe: true } : {}),
              ...(execution?.routeFailed === undefined
                ? {}
                : { routeFailed: execution.routeFailed }),
              ...(row.status === "error" && execution?.errorKind !== undefined
                ? { errorKind: execution.errorKind }
                : {}),
              ...(execution?.slippagePct === undefined
                ? {}
                : { slippagePct: execution.slippagePct }),
            })
          : null;
        const caption = execCopy
          ? t(execCopy.key, execCopy.values ?? {})
          : row.captionKey
            ? // POO-1927 [R2]: the attribution is whatever copy this row's RAIL earns, decided in
              // `provisioningView` rather than pinned to the Paybis key here. It was a
              // `poweredByPaybis` boolean, so a charge Privy brokers through Stripe or MoonPay
              // credited a vendor with no part in it, in all 12 locales.
              row.attributionKey
              ? `${t(row.captionKey, captionValues(row, locale))} · ${t(row.attributionKey)}`
              : t(row.captionKey, captionValues(row, locale))
            : undefined;
        // [R2]/[R4] Verifiable the instant it broadcasts, absent until then. Gated on both fields
        // rather than left to the link's own guard, so a row with nothing to show renders no slot
        // at all instead of an empty one that still takes vertical space.
        const link =
          row.explorerNetwork && row.txHash ? (
            <ExplorerTxLink network={row.explorerNetwork} hash={row.txHash} />
          ) : null;
        // POO-1509 [R34]/[R35]: there is no gas-selector slot under a gas row any more, and with it
        // goes the `Gas on arrival` label that only existed to name the figure the control changed.
        // The picker lives on the one screen whose subject is gas (`GasTopUpBody`).
        /**
         * [F5-R4] The clear-vs-blind signing disclosure (UF-28 [R4]), on the row the wallet is
         * actually asking about.
         *
         * An allowance and a transfer authorize very different things, and this is where a user
         * finds out which one is in front of them. It moved here with the surface: before POO-1088
         * the execution phase was `WalletSteps`, which carried it, and swapping the stepper for this
         * card without it would have traded a security affordance for a layout.
         */
        // POO-1136: the fiat buy row carries no wallet-signing disclosure. Its active surface is the
        // embedded Paybis widget the panel renders beside the card, not an in-wallet signature.
        const disclosure =
          running && row.status === "active" && row.type !== "buy" ? (
            <SigningDisclosure
              why={
                row.isApproval && row.tokenSymbol
                  ? {
                      name: t("sign.explain.approve.name"),
                      body: t("sign.explain.approve.body", { token: row.tokenSymbol }),
                    }
                  : { name: t("sign.explain.confirm.name"), body: t("sign.explain.confirm.body") }
              }
            />
          ) : null;
        /**
         * POO-1109 [R3]/[R5]: the leg-polling contract, which moves here with the surface.
         *
         * `e2e/helpers/provisioning.ts` follows a route by reading `[data-testid^="wallet-step-"]`
         * INSIDE the provisioning panel and polling `data-status` / `data-tx-hash`. `WalletSteps`
         * emitted those; taking it out of the panel merges into main without a single conflict
         * marker, so the harness would have degraded silently to iterating an empty array and the
         * rail would have lost its only on-chain proof that a leg reported as `done` is a mined,
         * non-reverted transaction.
         *
         * Only funding legs are exposed, never the op anchor: the harness maps one node to one leg
         * and the operation is not one. `idle` is emitted as `pending`, the word `WalletSteps` used,
         * so the vocabulary the harness reads does not shift under it.
         */
        const legHooks =
          running && !row.isOp
            ? {
                stepKey: row.key,
                stepStatus: row.status === "idle" ? "pending" : row.status,
                ...(row.txHash === undefined ? {} : { txHash: row.txHash }),
              }
            : {};
        /**
         * [F5-R3] The bridge ETA, only while it is still a forecast.
         *
         * "This usually takes about 3 minutes, we'll continue as soon as your funds arrive" is true
         * on the plan and true while the route runs. Under a step that has FAILED it is a promise
         * nobody is going to keep, sitting directly beneath the line explaining why the transfer
         * stopped. That is the same defect [F5-R2] fixed for "Waiting": copy that reads as
         * still-in-flight when nothing is coming.
         */
        const showEta = row.eta && !(running && (execution?.routeFailed || row.status === "error"));
        return (
          <PlanStepRow
            key={row.key}
            index={row.index}
            {...(running ? { badge: <StatusBadge status={row.status} index={row.index} /> } : {})}
            {...(running && row.status === "active" ? { isActive: true } : {})}
            {...(disclosure ? { disclosure } : {})}
            {...legHooks}
            title={title}
            caption={
              showEta && row.eta ? (
                <>
                  {caption}
                  {/* [R2] The one step measured in minutes says so, before the user commits. */}
                  <span className="mt-0.5 block">{t(row.eta.key, row.eta.values)}</span>
                </>
              ) : (
                caption
              )
            }
            amountUsd={row.amountUsd}
            isLast={i === view.rows.length - 1}
          >
            {link}
          </PlanStepRow>
        );
      })}
      {/* [F4-R4] The line the design closes on. The itemised breakdown still sits below the card
          (POO-1043 [R9]) and stays collapsed by default, so this is the summary of it rather than a
          replacement for it: dropping the itemisation would lose the TTL re-quote and the figures
          the price-impact gate is read against. */}
      {running ? null : (
        <li className="mt-3 list-none text-center text-muted-foreground text-xs">
          {t("provisioning.plan.feesIncluded")}
        </li>
      )}
    </ol>
  );

  // The full list, no disclosure: the running and failed screens ([R3], never collapsed) and any
  // Confirm plan that carries the inline gas selector (the control must stay reachable).
  if (!collapsible) return list;

  // [R1]/[R2] Confirm screen: collapsed by default behind a real disclosure button. Distinct copy
  // ("Show steps" / "Hide steps") from the cost card's own "Show more", so the two never read as the
  // same control.
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setStepsOpen((open) => !open)}
        aria-expanded={stepsOpen}
        aria-controls={listId}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-white/[0.04] px-4 py-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="min-w-0 break-words font-medium text-foreground text-sm">
          {t(stepsOpen ? "provisioning.plan.hideSteps" : "provisioning.plan.showSteps")}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            stepsOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {list}
    </div>
  );
}
