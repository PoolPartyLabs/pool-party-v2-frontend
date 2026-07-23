/**
 * @id PP-MGR-SCR-002
 * @name DerivedMandateCard
 * @implements-rules-version v1
 *
 * The read-only "Calculated automatically" card: the 5-segment risk meter + category. Risk and
 * category are NEVER set by the manager — Pool Party derives them from the pool's composition and
 * the range width. Lives in the Build step's pool-node config so it re-derives LIVE as the manager
 * edits the range draft (the range — and therefore this card — moved out of the Mandate step).
 *
 * POO-830 R5: optionally shows the auto-derived ASSET + OBJECTIVE tags (also read-only, re-derived
 * live from the range). The tags are passed in only when the `strategyCategoryFilter` dark-launch flag
 * is on (BuildStep gates it); with `tags` omitted the card renders EXACTLY as before (flag-off parity).
 */
"use client";

import { useTranslations } from "next-intl";
import type { AssetTag, ObjectiveTag } from "@/lib/schemas";
import type { StrategyTags } from "@/lib/strategies/tags/deriveStrategyTags";
import { cn } from "@/lib/utils/cn";
import type { DerivedMandate } from "../lib/deriveMandate";

/** Public props for {@link DerivedMandateCard}. */
export interface DerivedMandateCardProps {
  /** The auto-derived risk + category to display. */
  derived: DerivedMandate;
  /**
   * POO-830 R5: the auto-derived asset + objective tags, shown read-only as extra rows. Present only
   * when the `strategyCategoryFilter` flag is on; when omitted, the card renders as before.
   */
  tags?: StrategyTags;
}

/** Read-only derived risk + category card ("Calculated automatically"). */
export function DerivedMandateCard({ derived, tags }: DerivedMandateCardProps) {
  const t = useTranslations("manager");
  const RISK_LABELS: Record<DerivedMandate["riskLevel"], string> = {
    1: t("mandate.risk.veryConservative"),
    2: t("mandate.risk.conservative"),
    3: t("mandate.risk.moderate"),
    4: t("mandate.risk.aggressive"),
    5: t("mandate.risk.veryAggressive"),
  };
  const CATEGORY_LABELS: Record<DerivedMandate["categoryKey"], string> = {
    stable: t("mandate.categoryStable"),
    blueChip: t("mandate.categoryBlueChip"),
    volatile: t("mandate.categoryVolatile"),
  };
  // Literal t() lookups (no dynamic keys — the i18n used-key scan resolves each label).
  const OBJECTIVE_LABELS: Record<ObjectiveTag, string> = {
    income: t("mandate.objective.income"),
    gradualBuy: t("mandate.objective.gradualBuy"),
    gradualSell: t("mandate.objective.gradualSell"),
  };
  const ASSET_LABELS: Record<AssetTag, string> = {
    bitcoin: t("mandate.asset.bitcoin"),
    ethereum: t("mandate.asset.ethereum"),
    stablecoins: t("mandate.asset.stablecoins"),
    altcoins: t("mandate.asset.altcoins"),
    meme: t("mandate.asset.meme"),
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <p className="font-medium text-foreground text-sm">{t("mandate.derivedLabel")}</p>
        <p className="text-muted-foreground text-xs">{t("mandate.derivedNote")}</p>
      </div>
      {/* Stacked (not 2 columns): the card lives in the 360px config rail — side-by-side labels
          ("Aggressive" + "Blue-chip LP") collide there. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{t("mandate.riskLabel")}</span>
          <div className="flex items-center gap-2">
            <span className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((seg) => (
                <span
                  key={seg}
                  className={cn(
                    "h-1.5 w-4 rounded-full",
                    seg <= derived.riskLevel ? "bg-primary" : "bg-surface-raised",
                  )}
                />
              ))}
            </span>
            <span className="font-medium text-foreground text-sm">
              {RISK_LABELS[derived.riskLevel]}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{t("mandate.categoryLabel")}</span>
          <span className="font-medium text-foreground text-sm">
            {CATEGORY_LABELS[derived.categoryKey]}
          </span>
        </div>
        {/* POO-830 R5: read-only asset + objective tags, gated by the strategyCategoryFilter flag
            (BuildStep passes `tags` only when the flag is on). Chips distinguish the multi-tag cases
            (a crypto→crypto rotation carries two objectives; a crypto pair carries two assets). */}
        {tags ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{t("mandate.objectiveLabel")}</span>
              <span className="flex flex-wrap gap-1.5">
                {tags.objectiveTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2 py-0.5 font-medium text-foreground text-xs"
                  >
                    {OBJECTIVE_LABELS[tag]}
                  </span>
                ))}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{t("mandate.assetLabel")}</span>
              <span className="flex flex-wrap gap-1.5">
                {tags.assetTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2 py-0.5 font-medium text-foreground text-xs"
                  >
                    {ASSET_LABELS[tag]}
                  </span>
                ))}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
