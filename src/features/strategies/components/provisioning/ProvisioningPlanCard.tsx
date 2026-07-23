/**
 * @id PP-CORE-CMP-044
 * @name ProvisioningPlanCard
 * @implements-rules-version v1
 *
 * The Plan-state body of the provisioning wizard (PP-CORE-MOD-011, POO-409): a card listing the
 * assembled steps as numbered {@link PlanStepRow}s, fed by the pure {@link buildPlanView} mapping. It
 * resolves the i18n titles/captions (the op row renders the caller's `opLabel`; the bridge row
 * interpolates `{network}`; the buy-usdc caption appends "Powered by Paybis"), and slots the inline
 * gas selector into the gas row. No "You pay" total is rendered (fees abstracted, decided 2026-06-30).
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PlanStepRow } from "./PlanStepRow";
import type { PlanView } from "./provisioningView";

/** Public props for {@link ProvisioningPlanCard}. */
export interface ProvisioningPlanCardProps {
  /** The mapped plan view (from {@link buildPlanView}). */
  view: PlanView;
  /** Title for the op anchor row, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /** The inline gas selector, rendered under the gas step (if present). */
  gasSelector?: ReactNode;
}

/** The numbered step list card shown in the wizard's Plan state. */
export function ProvisioningPlanCard({ view, opLabel, gasSelector }: ProvisioningPlanCardProps) {
  const t = useTranslations("strategies");

  return (
    <ol className="flex flex-col rounded-2xl border border-border bg-white/[0.04] p-4">
      {view.rows.map((row, i) => {
        const title = row.isOp
          ? opLabel
          : t(row.labelKey, row.networkName ? { network: row.networkName } : undefined);
        const caption = row.captionKey
          ? row.poweredByPaybis
            ? `${t(row.captionKey)} · ${t("provisioning.poweredByPaybis")}`
            : t(row.captionKey)
          : undefined;
        return (
          <PlanStepRow
            key={row.key}
            index={row.index}
            title={title}
            caption={caption}
            amountUsd={row.amountUsd}
            isLast={i === view.rows.length - 1}
          >
            {row.isGas ? gasSelector : null}
          </PlanStepRow>
        );
      })}
    </ol>
  );
}
