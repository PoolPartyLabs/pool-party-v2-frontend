/**
 * @id PP-MGR-CMP-102
 * @name LocalSolanaReview
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events solana_preview_viewed, solana_preview_interacted, solana_preview_blocked
 */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { MandateDraft } from "../mandateDraft";
import type { UseMandateDraftResult } from "../useMandateDraft";
import { ReviewFeesCard } from "./ReviewFeesCard";
import { ReviewFirstDepositCard } from "./ReviewFirstDepositCard";
import { ReviewIdentityCard } from "./ReviewIdentityCard";
import { ReviewInvestorPreview } from "./ReviewInvestorPreview";
import { ReviewLaunchPreview } from "./ReviewLaunchPreview";
import { ReviewLayout } from "./ReviewLayout";
import { ReviewPlanSummary } from "./ReviewPlanSummary";
import { ReviewTermsCard } from "./ReviewTermsCard";
import { ReviewTransactionFeesCard } from "./ReviewTransactionFeesCard";
import { percentTextToBps } from "./reviewForm";

/** Same Review cards and columns with a local binding. Missing execution never becomes a quote. */
export function LocalSolanaReview({
  draft,
  update,
  onBackToBuild,
  onEditMandate,
}: {
  draft: MandateDraft;
  update: UseMandateDraftResult["update"];
  onBackToBuild(): void;
  onEditMandate(): void;
}) {
  const t = useTranslations("manager.fundBuilder.review");
  const all = useTranslations("manager");
  const { track } = useAnalytics();
  useTrackView("solana_preview_viewed");
  const review = draft.review ?? {
    name: draft.name ?? "",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minimum: "100",
    seed: "100",
  };
  const change = (patch: Partial<typeof review>) => {
    update((current) => ({ ...current, review: { ...review, ...patch } }));
    track("solana_preview_interacted");
  };
  const feeChange = (
    field: "performanceFeeBps" | "managementFeeBps" | "payoutFeeBps",
    value: string,
  ) => {
    const bps = percentTextToBps(value);
    if (bps !== null) change({ [field]: bps });
  };
  // PP-INTEGRATION-POINT: Solana upload, authoritative fees, seed quote and launch are absent.
  // POO-2239/2240/2261/2262 provide real capabilities separately; local edits remain in memory.
  return (
    <ReviewLayout localVisual>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ReviewIdentityCard
            {...review}
            localVisual
            onNameChange={(name) => change({ name })}
            onDescriptionChange={(description) => change({ description })}
            onUploadLogo={async () => null}
            uploadUnavailable={all("solanaPreview.marketUnavailable")}
            onUploadBlocked={() => track("solana_preview_blocked")}
          />
          <ReviewFeesCard {...review} localVisual onFeePercentChange={feeChange} />
          <ReviewTransactionFeesCard />
          <ReviewTermsCard
            {...review}
            localVisual
            feeConfiguration={{ flowFeeBps: null, flowSource: "fund-detail" }}
            onMinimumChange={(minimum) => change({ minimum })}
            onFeePercentChange={feeChange}
          />
          <ReviewFirstDepositCard
            {...review}
            localVisual
            balance={null}
            preview={null}
            onSeedChange={(seed) => change({ seed })}
            onMax={() => {}}
            onMaxBlocked={() => track("solana_preview_blocked")}
          />
        </div>
        <div className="space-y-4">
          <ReviewInvestorPreview review={review} localVisual />
          <ReviewPlanSummary
            draft={draft}
            localVisual
            onEditMandate={onEditMandate}
            onEditBuild={onBackToBuild}
          />
          <ReviewLaunchPreview steps={[]} unavailable={all("solanaPreview.executionUnavailable")} />
        </div>
      </div>
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
        <Button variant="secondary" onClick={onBackToBuild}>
          {t("backBuild")}
        </Button>
        <div className="space-y-2 text-right">
          <p role="status" className="text-xs text-muted-foreground">
            {all("solanaPreview.executionUnavailable")}
          </p>
          <Button blocked onBlockedClick={() => track("solana_preview_blocked")}>
            {t("launch")}
          </Button>
        </div>
      </div>
    </ReviewLayout>
  );
}
