/**
 * @id PP-MGR-SCR-002
 * @name BuildScreen
 * @implements-rules-version v1 (POO-2157 rules v1)
 * @analytics-events builder_build_viewed, builder_build_started, builder_block_added,
 *   builder_network_added, builder_network_removed, builder_flow_block_inserted,
 *   builder_block_removed, builder_block_restored, builder_build_blocked
 *
 * The Build phase of the fund strategy builder (slice S7, POO-2157, epic POO-2144; handoff v1.2):
 * the canvas that replaced the Build landing. The shell (`FundStrategyBuilderScreen`) keeps the page
 * header, Save & exit and the phase stepper; everything under them in the Build phase is here.
 *
 * It owns no domain logic of its own. It JOINS the dormant slices: the plan (S1, `useBuildPlan`),
 * the step scaffold and viewport (S2), the layout (S3, through `useDraftGraphLayout`), the graph
 * renderer (S6, `BuildGraph`) and the controller with its palette, menus, panel stub and selection
 * guard (S5, `useBuildCanvas`, `useBlockSelection`). What only a live screen needs is added here:
 *
 * - [AN4, D19] **Next: Review is never disabled.** A press runs the ordered checks of
 *   `buildScreenModel.reviewVerdict`; a refusal shows its inline notice in the bar
 *   (`fundBuilder.canvas.review.*`), brings the first offending block into view and reports
 *   `builder_build_blocked` with the matching reason. A plan that passes every check would leave the
 *   step for Review, so that press asks the selection guard first (HU3) and, Review not existing
 *   yet, answers "Review is not available yet". The notice belongs to the plan it was given for: any
 *   edit takes it away, because a notice that outlives its cause teaches people to ignore notices.
 * - [HU3] **Every way out passes `selection.guardLeave`**: Back: Mandate here, both Edit mandate
 *   links in the controller, and the shell's own Save & exit and stepper through `leaveGuardRef`.
 * - [I8, I9] The viewport opens at fit (S2 does it on the first graph size); after a change the new
 *   or newly selected block is revealed by the minimum pan (`revealTarget`), never re-fitted.
 * - [D18] A draft whose stored plan this build cannot read says so, with the empty canvas under
 *   it; the stored plan is replaced only by a save that carries a plan the manager made here.
 * - [AE1 to AE6] The view, the first block (`started`), the canvas events of the controller and the
 *   refusals, all through `useAnalytics().track()` / `useTrackView`, mapped by `buildAnalytics.ts`.
 *   The abandonment and the save error are the shell's: it is what knows how the session ended.
 *
 * Wiring notes: the renderer's spoke removal is `onRemoveSpoke` and the controller's is
 * `removeSpoke`; `invalidNetworks` (required) is built from the violations whose code is
 * `network_not_in_mandate` (their `targetId` is the spoke's network). The undo toast and "Draft
 * saved" use the `<Toaster />` the locale layout already mounts once.
 *
 * PP-INTEGRATION-POINT: the plan rides the mandate draft (browser store, `useMandateDraft`); when
 * drafts move to the backend draft API (wiring issue POO-2132) this screen changes nothing.
 */
"use client";

import { useTranslations } from "next-intl";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { MandateCatalog } from "../mandateCatalog";
import type { MandateDraft } from "../mandateDraft";
import type { UseMandateDraftResult } from "../useMandateDraft";
import { BuildPalette } from "./blocks/BuildPalette";
import { CanvasMenu } from "./blocks/CanvasMenu";
import { PanelStub } from "./blocks/PanelStub";
import { useBlockSelection } from "./blocks/useBlockSelection";
import { type BuildCanvasEvent, useBuildCanvas } from "./blocks/useBuildCanvas";
import { canvasEventToAnalytics, planCounts, REVIEW_REFUSAL_EVENT } from "./buildAnalytics";
import {
  REVIEW_NOTICE_KEY,
  type ReviewNoticeKey,
  type ReviewRefusal,
  revealTarget,
  reviewVerdict,
  targetRect,
} from "./buildScreenModel";
import { BuildPanelSlot } from "./canvas/BuildPanelSlot";
import { BuildStepLayout } from "./canvas/BuildStepLayout";
import { CanvasViewport, type CanvasViewportHandle } from "./canvas/CanvasViewport";
import { BuildGraph } from "./graph/BuildGraph";
import { useDraftGraphLayout } from "./graph/useGraphLayout";
import type { GraphLayout } from "./layout/graphTypes";
import type { BuildPlan } from "./plan/buildPlan";
import { useBuildPlan } from "./plan/useBuildPlan";

/** Runs `proceed` (a way out of the Build step) only when the selection guards allow it (HU3). */
export type LeaveGuard = (proceed: () => void) => void;

/** Public props for {@link BuildScreen}. */
export interface BuildScreenProps {
  /** The draft the shell holds: a completed mandate, and its plan. */
  draft: MandateDraft;
  /** The catalog the draft was built against. */
  catalog: MandateCatalog;
  /** The shell's draft writer; the plan is written through it (`useBuildPlan`). */
  update: UseMandateDraftResult["update"];
  /** Back: Mandate, already past the guard. Lands on the last Mandate step. */
  onBackToMandate(): void;
  /** An Edit mandate link, already past the guard: step 1 (networks) or step 2 (protocols). */
  onEditMandate(step: "networks" | "protocols"): void;
  /**
   * Receives the selection guard's leave check while Build is mounted, so the shell's own ways out
   * (Save & exit, the stepper's Mandate pill) pass it too (HU3). Cleared on unmount.
   */
  leaveGuardRef?: MutableRefObject<LeaveGuard | null>;
}

/** The six Next: Review notices, through literal keys so the i18n usage scan sees each one. */
function useReviewCopy(): Record<ReviewNoticeKey, string> {
  const t = useTranslations("manager");
  return useMemo(
    () => ({
      emptyPlan: t("fundBuilder.canvas.review.emptyPlan"),
      invalidBlock: t("fundBuilder.canvas.review.invalidBlock"),
      comingSoon: t("fundBuilder.canvas.review.comingSoon"),
      emptyBlock: t("fundBuilder.canvas.review.emptyBlock"),
      overShare: t("fundBuilder.canvas.review.overShare"),
      unavailable: t("fundBuilder.canvas.review.unavailable"),
    }),
    [t],
  );
}

/** The Build phase: palette, canvas, panel stub and the Back / Next bar. */
export function BuildScreen({
  draft,
  catalog,
  update,
  onBackToMandate,
  onEditMandate,
  leaveGuardRef,
}: BuildScreenProps) {
  const t = useTranslations("manager");
  const reviewCopy = useReviewCopy();
  const { track } = useAnalytics();

  const buildPlan = useBuildPlan({ draft, catalog, update });
  const selection = useBlockSelection();
  const plan = buildPlan.plan;
  const { violations } = buildPlan;

  // [AE1] One view per visit, with what the plan held on arrival.
  useTrackView("builder_build_viewed", planCounts(plan));

  // The plan of the LAST render. A canvas event is reported synchronously inside the gesture that
  // changed the plan, before React renders again, so this is the plan as it was before the change.
  const planBefore = useRef(plan);
  planBefore.current = plan;
  const started = useRef(false);

  const onEvent = useCallback(
    (event: BuildCanvasEvent) => {
      // [AE1] The first block placed on an empty plan starts the phase, once per visit.
      if (
        event.type === "blockAdded" &&
        !started.current &&
        planCounts(planBefore.current).blocks_count === 0
      ) {
        started.current = true;
        track("builder_build_started");
      }
      const mapped = canvasEventToAnalytics(event);
      track(mapped.event, mapped.params);
    },
    [track],
  );

  const controller = useBuildCanvas({
    draft,
    catalog,
    buildPlan,
    selection,
    onEvent,
    onEditMandate,
  });

  // [HU3] The shell's own exits read the guard while Build is on screen.
  const { guardLeave } = selection;
  useEffect(() => {
    if (!leaveGuardRef) return;
    leaveGuardRef.current = guardLeave;
    return () => {
      if (leaveGuardRef.current === guardLeave) leaveGuardRef.current = null;
    };
  }, [leaveGuardRef, guardLeave]);

  // [C1] The layout is a pure function of the plan, memoised on it (S6's hook measures the empty
  // canvas's sentence in the active locale).
  const layout = useDraftGraphLayout(draft);
  const graphSize = useMemo(
    () => ({ width: layout.width, height: layout.height }),
    [layout.width, layout.height],
  );
  const viewportRef = useRef<CanvasViewportHandle>(null);

  // [D6] The spokes whose network left the mandate are drawn as invalid groups.
  const invalidNetworks = useMemo(
    () =>
      new Set(
        violations
          .filter((violation) => violation.code === "network_not_in_mandate")
          .map((violation) => violation.targetId)
          .filter((network): network is string => network !== null),
      ),
    [violations],
  );

  // [I9] After a change, reveal the new or newly selected block with the minimum pan. The first
  // layout is not a change: the viewport opens at fit on its own.
  const selectedId = selection.selectedId;
  const shown = useRef<{ layout: GraphLayout; selectedId: string | null } | null>(null);
  useEffect(() => {
    const before = shown.current;
    shown.current = { layout, selectedId };
    if (!before) return;
    const rect = revealTarget(before, { layout, selectedId });
    if (rect) viewportRef.current?.revealRect(rect);
  }, [layout, selectedId]);

  // [AN4] The refusal on screen, tied to the plan it was given for.
  const [notice, setNotice] = useState<{ refusal: ReviewRefusal; plan: BuildPlan } | null>(null);

  const latest = useRef({ plan, violations, layout });
  latest.current = { plan, violations, layout };

  const refuse = useCallback(
    (refusal: ReviewRefusal) => {
      setNotice({ refusal, plan: latest.current.plan });
      track("builder_build_blocked", { block_reason: REVIEW_REFUSAL_EVENT[refusal] });
    },
    [track],
  );

  const handleNext = useCallback(() => {
    const { plan: current, violations: broken, layout: drawn } = latest.current;
    const verdict = reviewVerdict(current, broken);
    if (verdict.refusal === "review_unavailable") {
      // A valid plan would leave the step here, so the press asks the guard first (HU3). Review does
      // not exist yet (D19): the way out leads to the notice that says so.
      guardLeave(() => refuse("review_unavailable"));
      return;
    }
    refuse(verdict.refusal);
    const rect = targetRect(drawn, verdict.target);
    if (rect) viewportRef.current?.revealRect(rect);
  }, [guardLeave, refuse]);

  const handleBack = useCallback(() => guardLeave(onBackToMandate), [guardLeave, onBackToMandate]);

  const noticeText =
    notice && notice.plan === plan ? reviewCopy[REVIEW_NOTICE_KEY[notice.refusal]] : null;

  // [D18] Storage holds a plan this build cannot read; until the manager makes a new one, say so.
  const unreadable = draft.planUnreadable === true && draft.plan === undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the Build step hands Delete and Escape to the canvas controller (I10); the keys come from the focused card, template or port inside it.
    <div data-build-screen="" className="flex flex-col gap-6" onKeyDown={controller.onKeyDown}>
      {unreadable ? (
        <p
          role="status"
          data-build-plan-unreadable=""
          className="rounded-lg border border-border bg-surface px-4 py-3 text-muted-foreground text-sm"
        >
          {t("fundBuilder.canvas.planUnreadable")}
        </p>
      ) : null}

      <BuildStepLayout
        palette={<BuildPalette {...controller.paletteProps} />}
        canvas={
          <CanvasViewport
            graphSize={graphSize}
            onBackgroundClick={controller.onBackgroundClick}
            viewportRef={viewportRef}
          >
            <BuildGraph
              layout={layout}
              describeBlock={controller.describeBlock}
              describeFlow={controller.describeFlow}
              networkName={controller.networkName}
              selectedId={selectedId}
              activeTargetKeys={controller.activeTargetKeys}
              onTarget={controller.onTarget}
              onRemoveSpoke={controller.removeSpoke}
              invalidNetworks={invalidNetworks}
            />
          </CanvasViewport>
        }
        panel={
          <BuildPanelSlot>
            <PanelStub {...controller.panelProps} />
          </BuildPanelSlot>
        }
        onBack={handleBack}
        onNext={handleNext}
        notice={noticeText}
      />

      <CanvasMenu {...controller.menuProps} />
    </div>
  );
}
