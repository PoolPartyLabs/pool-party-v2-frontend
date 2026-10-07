/**
 * @id PP-MGR-CMP-077 (POO-2195)
 * @name ReviewPhase
 * @implements-rules-version v1
 * @analytics-events builder_review_view, builder_review_field_changed, builder_launch_clicked,
 *   builder_launch_blocked, builder_review_abandoned, builder_review_error
 * @i18n-namespace manager
 * Saved Review binding and guarded entry into the existing launch journey.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { isMockMode } from "@/lib/services";
import { REVIEW_NOTICE_KEY } from "../build/buildScreenModel";
import { planOf } from "../build/plan/buildPlan";
import { validatePlan } from "../build/plan/planInvariants";
import { planReadiness, type ReadinessTarget } from "../build/plan/planReadiness";
import type { FundLaunchDraft, LaunchStepPreview } from "../launch/contracts";
import { getLaunchSteps } from "../launch/journey";
import { startFundLaunch } from "../launch/startFundLaunch";
import { useV2LaunchStatus } from "../launch/useV2LaunchStatus";
import { useV2ReviewDraft } from "../launch/useV2ReviewDraft";
import { ReviewFeesCard } from "./ReviewFeesCard";
import { ReviewFirstDepositCard } from "./ReviewFirstDepositCard";
import { ReviewIdentityCard } from "./ReviewIdentityCard";
import { ReviewInvestorPreview } from "./ReviewInvestorPreview";
import { ReviewLaunchPreview } from "./ReviewLaunchPreview";
import { ReviewPlanSummary } from "./ReviewPlanSummary";
import { ReviewTermsCard } from "./ReviewTermsCard";
import { ReviewTransactionFeesCard } from "./ReviewTransactionFeesCard";
import { type FeeField, listReviewReasons } from "./reviewForm";
export interface ReviewPhaseProps {
  /** Persisted mandate draft identifier. */ draftId: string;
  /** Returns to Build, optionally revealing its first blocker. */ onBackToBuild: (
    target?: ReadinessTarget | null,
  ) => void;
  /** Opens the saved mandate for editing. */ onEditMandate: () => void;
}
export function ReviewPhase(props: ReviewPhaseProps) {
  const t = useTranslations("manager.fundBuilder.review");
  // Mock mode has no real wallet providers. Keep the real Review hook outside that branch.
  if (isMockMode)
    return (
      <div role="alert" className="space-y-3">
        <p>{t("mockUnavailable")}</p>
        <Button variant="secondary" onClick={() => props.onBackToBuild()}>
          {t("backBuild")}
        </Button>
      </div>
    );
  return <ConnectedReviewPhase {...props} />;
}
function ConnectedReviewPhase({ draftId, onBackToBuild, onEditMandate }: ReviewPhaseProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const all = useTranslations("manager");
  const router = useRouter();
  const { track } = useAnalytics();
  // PP-INTEGRATION-POINT: saved review, validated upload, real hub balance and fee provenance.
  const binding = useV2ReviewDraft(draftId);
  // PP-INTEGRATION-POINT: read-only checkpoint status from the existing launch journal.
  const status = useV2LaunchStatus(draftId);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const started = useRef(false);
  const concluded = useRef(false);
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(() => {
    setReady(true);
    track("builder_review_view", { family: "v2" });
    return () => {
      if (!concluded.current) trackRef.current("builder_review_abandoned", { family: "v2" });
    };
  }, [track]);
  useEffect(() => {
    if (ready && !binding.draft)
      track("builder_review_error", { error_code: "REVIEW_DRAFT_UNAVAILABLE" });
  }, [ready, binding.draft, track]);
  useEffect(() => {
    if (binding.uploadError) track("builder_review_error", { error_code: "REVIEW_LOGO_FAILED" });
  }, [binding.uploadError, track]);
  const draft = binding.draft;
  const plan = draft ? planOf(draft) : null;
  const readiness =
    plan && draft
      ? planReadiness(plan, validatePlan(plan, { draft, catalog: binding.catalog }))
      : null;
  const buildReason =
    readiness && !readiness.ready
      ? {
          code: readiness.refusal,
          messageKey: `fundBuilder.canvas.review.${REVIEW_NOTICE_KEY[readiness.refusal]}`,
        }
      : null;
  let steps: LaunchStepPreview[] = [];
  if (draft?.plan)
    try {
      steps = getLaunchSteps({ ...draft, review: binding.review } as FundLaunchDraft);
    } catch {}
  const reasons = listReviewReasons({ ...binding, buildReason });
  const reason = reasons[0] ?? null;
  const errorFor = (field: string) => {
    const found = reasons.find((item) => item.field === field);
    return found ? all(found.messageKey) : undefined;
  };
  const changed = (field: keyof typeof binding.review) =>
    track("builder_review_field_changed", { review_field: field });
  const field = (key: keyof typeof binding.review, value: string) => {
    binding.setField(key, value);
    changed(key);
  };
  const fee = (key: FeeField, value: string) => {
    binding.setFeePercent(key, value);
    changed(key);
  };
  const refresh = async () => {
    try {
      await binding.refreshBalance();
    } catch {
      track("builder_review_error", { error_code: "REVIEW_BALANCE_FAILED" });
    }
  };
  const launch = async () => {
    if (started.current) return;
    track("builder_launch_clicked", { family: "v2" });
    if (reason) {
      track("builder_launch_blocked", {
        review_field: reason.field,
        error_code: `REVIEW_${reason.code.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`,
      });
      if (reason.field === "build") {
        onBackToBuild(readiness && !readiness.ready ? readiness.target : null);
        return;
      }
      const element = document.getElementById(`review-${reason.field}`);
      element?.focus();
      element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return;
    }
    if (!draft?.plan || !binding.manager || binding.catalog.loading || binding.catalog.error) {
      track("builder_launch_blocked", {
        review_field: "draft",
        error_code: "REVIEW_DATA_UNAVAILABLE",
      });
      return;
    }
    started.current = true;
    concluded.current = true;
    setBusy(true);
    setFailure(false);
    try {
      // PP-INTEGRATION-POINT: the existing driver freezes/validates once and owns journey navigation.
      await startFundLaunch({ ...draft, review: binding.review } as FundLaunchDraft);
      concluded.current = true;
    } catch {
      started.current = false;
      concluded.current = false;
      setBusy(false);
      setFailure(true);
      track("builder_review_error", { error_code: "REVIEW_LAUNCH_ENTRY_FAILED" });
    }
  };
  if (!ready) return <Skeleton height={160} />;
  if (!draft)
    return (
      <div id="review-draft" tabIndex={-1} role="alert" className="space-y-3">
        <p>{t("draftUnavailable")}</p>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
        <Button variant="ghost" onClick={() => onBackToBuild()}>
          {t("backBuild")}
        </Button>
      </div>
    );
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("caption")}</p>
      </div>
      {binding.catalog.loading && <Skeleton height={40} />}
      {binding.catalog.error && (
        <div role="alert">
          <p>{t("catalogUnavailable")}</p>
          <Button variant="secondary" onClick={binding.catalog.retry}>
            {t("retry")}
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ReviewIdentityCard
            {...binding.review}
            uploading={binding.uploading}
            uploadError={binding.uploadError ? all(binding.uploadError) : undefined}
            nameError={errorFor("name")}
            descriptionError={errorFor("description")}
            onNameChange={(value) => field("name", value)}
            onDescriptionChange={(value) => field("description", value)}
            onUploadLogo={async (file) => {
              const result = await binding.uploadLogo(file);
              changed("imageUrl");
              return result;
            }}
          />
          <ReviewFeesCard
            {...binding.review}
            onFeePercentChange={fee}
            errors={{
              performanceFeeBps: errorFor("performanceFeeBps"),
              managementFeeBps: errorFor("managementFeeBps"),
            }}
          />
          <ReviewTransactionFeesCard />
          <ReviewTermsCard
            {...binding.review}
            feeConfiguration={binding.feeConfiguration}
            onMinimumChange={(value) => field("minimum", value)}
            onFeePercentChange={fee}
            minimumError={errorFor("minimum")}
            payoutError={errorFor("payoutFeeBps")}
          />
          <ReviewFirstDepositCard
            {...binding.review}
            balance={binding.balance}
            preview={binding.preview}
            onSeedChange={(value) => field("seed", value)}
            onMax={() => {
              binding.setMax();
              changed("seed");
            }}
            error={errorFor("seed")}
          />
          {binding.balance === null && (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t("validation.balanceUnread")}</p>
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                {t("retryBalance")}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <ReviewInvestorPreview review={binding.review} />
          <ReviewPlanSummary
            draft={draft}
            onEditMandate={onEditMandate}
            onEditBuild={() => onBackToBuild()}
          />
          <ReviewLaunchPreview steps={steps} />
        </div>
      </div>
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
        <Button variant="secondary" onClick={() => onBackToBuild()}>
          {t("backBuild")}
        </Button>
        <div className="space-y-2 text-right">
          {reason && (
            <p role="status" className="text-xs text-destructive">
              {all(reason.messageKey)}
            </p>
          )}
          {failure && (
            <p role="alert" className="text-xs text-destructive">
              {t("launchFailed")}
            </p>
          )}
          {status ? (
            <Button
              onClick={() => {
                concluded.current = true;
                track("builder_launch_clicked", { family: "v2" });
                router.push(`/manager/fund-launch/${encodeURIComponent(status.journeyId)}`);
              }}
            >
              {t(status.status === "complete" ? "viewLaunch" : "resumeLaunch")}
            </Button>
          ) : (
            <Button loading={busy} disabled={busy} onClick={() => void launch()}>
              {t("launch")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
