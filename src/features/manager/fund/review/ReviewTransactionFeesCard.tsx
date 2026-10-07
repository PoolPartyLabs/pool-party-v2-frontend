/**
 * @id PP-MGR-CMP-090 (POO-2289)
 * @name ReviewTransactionFeesCard
 * @implements-rules-version v1
 * @analytics-events none: read-only information; ReviewPhase owns its existing events.
 * @i18n-namespace manager
 * Entry and exit fees stay unavailable until authoritative semantics and amounts are supplied.
 */
"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Card } from "@/components/ui/Card";
import { PanelFieldLabel } from "../build/panel/PanelFieldLabel";

export function ReviewTransactionFeesCard() {
  const t = useTranslations("manager.fundBuilder.review.transactionFees");
  const panel = useTranslations("manager.fundBuilder.canvas.panel");
  const titleId = useId();
  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-4 rounded-[20px] p-4"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={titleId} className="break-words font-medium text-sm">
          {t("title")}
        </h3>
        <p className="break-words text-muted-foreground text-xs">{t("helper")}</p>
      </div>
      {/* PP-INTEGRATION-POINT: authoritative entry/exit fee meaning, units and provenance are absent; do not reuse manager/protocol fees. */}
      <dl className="flex min-w-0 flex-col gap-4">
        {(["entry", "exit"] as const).map((key, index) => (
          <div
            key={key}
            className={`flex min-h-6 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1${index > 0 ? " border-t border-border pt-4" : ""}`}
          >
            <dt className="min-w-0 flex-[1_1_9rem]">
              <PanelFieldLabel
                label={t(key)}
                help={t("helper")}
                helpLabel={panel("moreAbout", { label: t(key) })}
              />
            </dt>
            <dd className="max-w-full break-words text-right font-semibold text-foreground text-sm tabular-nums">
              {t("unavailable")}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
