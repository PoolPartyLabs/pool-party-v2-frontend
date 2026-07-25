/**
 * @id PP-CORE-CMP-044
 * @name ProvisioningPlanCard
 * @implements-rules-version v2 (POO-1041 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The Plan-state body of the provisioning wizard (PP-CORE-MOD-011, POO-409): a card listing the
 * assembled steps as numbered {@link PlanStepRow}s, fed by the pure {@link buildPlanView} mapping. It
 * resolves the i18n titles/captions (the op row renders the caller's `opLabel`; a row interpolates
 * `{network}` / `{token}` from the values the mapper carries; the buy-usdc caption appends "Powered
 * by Paybis"), and slots the inline gas selector into the gas row. No "You pay" total is rendered
 * (fees abstracted, decided 2026-06-30).
 *
 * v2 (POO-1041): the card renders a REAL plan, which differs from a fixture in three visible ways.
 * The rail's approval rows appear, so the list is what the wallet will actually ask for ([R6]). A
 * bridge row says how long it takes, from the quote's own estimate ([R2]). And once a leg has
 * broadcast, its row links to the transaction on the chain it was sent on ([R2]) — a transfer that
 * takes minutes is indistinguishable from a hung app without it. A row with no hash, or on a chain
 * this app cannot name an explorer for, renders no link at all ([R4]).
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { PlanStepRow } from "./PlanStepRow";
import type { PlanRow, PlanView } from "./provisioningView";

/** Public props for {@link ProvisioningPlanCard}. */
export interface ProvisioningPlanCardProps {
  /** The mapped plan view (from {@link buildPlanView}). */
  view: PlanView;
  /** Title for the op anchor row, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /** The inline gas selector, rendered under the gas step (if present). */
  gasSelector?: ReactNode;
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

/** The numbered step list card shown in the wizard's Plan state. */
export function ProvisioningPlanCard({ view, opLabel, gasSelector }: ProvisioningPlanCardProps) {
  const t = useTranslations("strategies");

  return (
    <ol className="flex flex-col rounded-2xl border border-border bg-white/[0.04] p-4">
      {view.rows.map((row, i) => {
        const title = row.isOp ? opLabel : t(row.labelKey, labelValues(row));
        const caption = row.captionKey
          ? row.poweredByPaybis
            ? `${t(row.captionKey)} · ${t("provisioning.poweredByPaybis")}`
            : t(row.captionKey)
          : undefined;
        // [R2]/[R4] Verifiable the instant it broadcasts, absent until then. Gated on both fields
        // rather than left to the link's own guard, so a row with nothing to show renders no slot
        // at all instead of an empty one that still takes vertical space.
        const link =
          row.explorerNetwork && row.txHash ? (
            <ExplorerTxLink network={row.explorerNetwork} hash={row.txHash} />
          ) : null;
        const slot = row.isGas ? gasSelector : null;
        return (
          <PlanStepRow
            key={row.key}
            index={row.index}
            title={title}
            caption={
              row.eta ? (
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
            {slot || link ? (
              <>
                {slot}
                {link}
              </>
            ) : null}
          </PlanStepRow>
        );
      })}
    </ol>
  );
}
