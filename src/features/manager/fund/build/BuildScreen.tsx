/**
 * @id PP-MGR-SCR-002
 * @name BuildScreen
 * @implements-rules-version v1 (POO-2157 rules v1; the configuration panel of POO-2187 rules v1)
 * @analytics-events builder_build_viewed, builder_build_started, builder_block_added,
 *   builder_network_added, builder_network_removed, builder_flow_block_inserted,
 *   builder_block_removed (with cascade_count), builder_block_configured, builder_block_applied,
 *   builder_block_discarded, builder_block_leave_blocked, builder_block_limit_hit,
 *   builder_build_blocked, builder_build_error (PLAN_UNREADABLE only; the save error is the
 *   shell's)
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
 *   `builder_build_blocked` with the matching reason. Every press asks the selection guard first
 *   (HU3; since POO-2187 whatever the verdict, so changes not applied in the panel get its notice
 *   and the checks run on the plan they leave) and, Review not existing yet, a plan that passes
 *   every check answers "Review is not available yet". The notice belongs to the plan it was given
 *   for: any edit takes it away, because a notice that outlives its cause teaches people to ignore
 *   notices.
 * - [HU3] **Every way out passes `selection.guardLeave`**: Back: Mandate here, both Edit mandate
 *   links in the controller, and the shell's own Save & exit and stepper through `leaveGuardRef`.
 * - [I8, I9] The viewport opens at fit (S2 does it on the first graph size); after a change the new
 *   or newly selected block is revealed by the minimum pan (`revealTarget`), never re-fitted.
 * - [D18] A draft whose stored plan this build cannot read says so, with the empty canvas under
 *   it, until a save replaces that plan. It is replaced only by a plan the manager made here, and
 *   an EMPTY plan is not one: a write that leaves the plan empty again on such a draft stores no
 *   plan, so the store keeps the unreadable one, nothing is left to save and the leave prompt stays
 *   down (review F1 of PR #41: add a block, remove it, Save & exit used to erase it).
 * - [AE1 to AE6] The view, the first block (`started`), the canvas events of the controller and the
 *   refusals, all through `useAnalytics().track()` / `useTrackView`, mapped by `buildAnalytics.ts`.
 *   The abandonment and the save error are the shell's: it is what knows how the session ended.
 * - [POO-2187] The CONFIGURATION PANEL (`BlockPanel`, PP-MGR-CMP-061) replaces the canvas batch's
 *   stub in the right column. Its draft (`usePanelDraft`, PP-MGR-HOK-014) registers the selection
 *   guard, so with changes not applied every exit above (another block, the background, the Edit
 *   mandate links, Back, Next, Save & exit, the stepper) keeps the selection and shows the notice;
 *   Apply changes or Discard changes then completes the exit (P6). Remove block and the Delete key
 *   open the panel's confirm (P10, DP11); there is no Undo toast. An Edit mandate link names the
 *   selected block, and `initialSelectedId` brings it back selected (finding 19). The panel's events
 *   (configured, applied, discarded, leave blocked, limit hit) go through `buildAnalytics.ts` too.
 *
 * Wiring notes: the renderer's spoke removal is `onRemoveSpoke` and the controller's is
 * `removeSpoke`; `invalidNetworks` (required) is built from the violations whose code is
 * `network_not_in_mandate` (their `targetId` is the spoke's network). "Draft saved" uses the
 * `<Toaster />` the locale layout already mounts once.
 *
 * PP-NOTE: no seam of its own and no service call. The plan rides the mandate draft, whose store
 * read and write are the integration point (marked in `useMandateDraft`, wiring issue POO-2132);
 * when drafts move to the backend draft API this screen changes nothing.
 */
"use client";

import { useTranslations } from "next-intl";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { useUnsavedChanges } from "@/lib/hooks/unsavedChanges";
import type { MandateCatalog } from "../mandateCatalog";
import { isBlocked, type MandateDraft } from "../mandateDraft";
import type { UseMandateDraftResult } from "../useMandateDraft";
import { BuildPalette } from "./blocks/BuildPalette";
import { CanvasMenu } from "./blocks/CanvasMenu";
import { useBlockSelection } from "./blocks/useBlockSelection";
import {
  type BuildCanvasEvent,
  type MandateEditStep,
  useBuildCanvas,
} from "./blocks/useBuildCanvas";
import {
  canvasEventToAnalytics,
  limitHitToAnalytics,
  panelEventToAnalytics,
  planCounts,
  REVIEW_REFUSAL_EVENT,
} from "./buildAnalytics";
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
import { BlockPanel } from "./panel/BlockPanel";
import { type PanelDraftEvent, panelTarget, usePanelDraft } from "./panel/usePanelDraft";
import type { AllocationCeilingReason } from "./plan/allocationCeiling";
import type { BlockKind, BuildPlan } from "./plan/buildPlan";
import { planOf } from "./plan/buildPlan";
import { planFingerprint } from "./plan/planStorage";
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
  /**
   * An Edit mandate link, already past the guard: a canvas menu's (networks, protocols) or the
   * panel's (tokens, pools, limits), with the block selected when it was followed (finding 19).
   */
  onEditMandate(step: MandateEditStep, selectedId: string | null): void;
  /**
   * The block to select on arrival: the one selected when an Edit mandate link was followed, so the
   * walk back lands on Build with the same block. Ignored when the plan no longer holds it.
   */
  initialSelectedId?: string | null;
  /**
   * Receives the selection guard's leave check while Build is mounted, so the shell's own ways out
   * (Save & exit, the stepper's Mandate pill) pass it too (HU3). Cleared on unmount.
   */
  leaveGuardRef?: MutableRefObject<LeaveGuard | null>;
  /** Opens Review after readiness and the selected-panel leave guard pass. */
  onReview?: () => void;
}

/** The twelve Next: Review notices, through literal keys so the i18n usage scan sees each one. */
function useReviewCopy(): Record<ReviewNoticeKey, string> {
  const t = useTranslations("manager");
  return useMemo(
    () => ({
      emptyPlan: t("fundBuilder.canvas.review.emptyPlan"),
      invalidBlock: t("fundBuilder.canvas.review.invalidBlock"),
      comingSoon: t("fundBuilder.canvas.review.comingSoon"),
      emptyBlock: t("fundBuilder.canvas.review.emptyBlock"),
      overShare: t("fundBuilder.canvas.review.overShare"),
      incompleteBlock: t("fundBuilder.canvas.review.incompleteBlock"),
      zeroShare: t("fundBuilder.canvas.review.zeroShare"),
      unusedSpokeShare: t("fundBuilder.canvas.review.unusedSpokeShare"),
      stackedPositions: t("fundBuilder.canvas.review.stackedPositions"),
      duplicateReserve: t("fundBuilder.canvas.review.duplicateReserve"),
      unsupportedSwap: t("fundBuilder.canvas.review.unsupportedSwap"),
      unavailable: t("fundBuilder.canvas.review.unavailable"),
    }),
    [t],
  );
}

/** The Build phase: palette, canvas, configuration panel and the Back / Next bar. */
export function BuildScreen({
  draft,
  catalog,
  update,
  onBackToMandate,
  onEditMandate,
  initialSelectedId = null,
  leaveGuardRef,
  onReview,
}: BuildScreenProps) {
  const t = useTranslations("manager");
  const reviewCopy = useReviewCopy();
  const { track } = useAnalytics();

  // [D18] An unreadable stored plan is replaced only by a plan with something in it: a write that
  // leaves the plan EMPTY on such a draft stores no plan again (see the file header).
  const updateKeepingStoredPlan = useCallback<UseMandateDraftResult["update"]>(
    (fn) =>
      update((current) => {
        const next = fn(current);
        if (isBlocked(next) || next.planUnreadable !== true || next.plan === undefined) return next;
        if (planFingerprint(next.plan) !== planFingerprint(undefined)) return next;
        const { plan: _empty, ...withoutPlan } = next;
        return withoutPlan;
      }),
    [update],
  );

  const buildPlan = useBuildPlan({ draft, catalog, update: updateKeepingStoredPlan });
  // [Finding 19] Back from an Edit mandate link with the block selected then, if it still exists.
  const [arrivalSelection] = useState(() =>
    panelTarget(planOf(draft), initialSelectedId) ? initialSelectedId : null,
  );
  const selection = useBlockSelection(arrivalSelection);
  const plan = buildPlan.plan;
  const { violations } = buildPlan;

  // [AE1] One view per visit, with what the plan held on arrival.
  useTrackView("builder_build_viewed", planCounts(plan));

  // [AE, D18] Arriving on a stored plan this build cannot read is an error of ours: once per visit
  // (review F11 of PR #41). Latched like `useTrackView`, so a re-run effect never reports twice.
  const [unreadableOnArrival] = useState(() => draft.planUnreadable === true);
  const reportedUnreadable = useRef(false);
  useEffect(() => {
    if (!unreadableOnArrival || reportedUnreadable.current) return;
    reportedUnreadable.current = true;
    track("builder_build_error", { error_code: "PLAN_UNREADABLE", error_origin: "app" });
  }, [unreadableOnArrival, track]);

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

  // [POO-2187] The panel's draft of the selected block, and its guard (P3, P5, P6).
  const onPanelEvent = useCallback(
    (event: PanelDraftEvent) => {
      const mapped = panelEventToAnalytics(event);
      track(mapped.event, mapped.params);
    },
    [track],
  );
  const target = useMemo(
    () => panelTarget(plan, selection.selectedId),
    [plan, selection.selectedId],
  );
  const panel = usePanelDraft({
    target,
    registerGuard: selection.registerGuard,
    applyBlockConfig: buildPlan.applyBlockConfig,
    onEvent: onPanelEvent,
  });
  // [P6] Browser back, reload and closing the tab get the browser's own prompt while the panel
  // holds changes not applied, as the shell does for a draft not saved (the in-app exits ask the
  // selection guard instead).
  useUnsavedChanges(panel.dirty);

  const controller = useBuildCanvas({
    draft,
    catalog,
    buildPlan,
    selection,
    onEvent,
    onEditMandate,
    beforeRemove: panel.reset,
  });

  const onLimitHit = useCallback(
    (kind: BlockKind, reason: AllocationCeilingReason) => {
      const mapped = limitHitToAnalytics(kind, reason);
      track(mapped.event, mapped.params);
    },
    [track],
  );

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
    // [P6, review L1 of PR #54] Next asks the guard FIRST, whatever the verdict: with changes not
    // applied the panel's notice answers, and once Apply changes or Discard changes settled the
    // checks run on the plan as it then is (the resume reads `latest`). Review does not exist yet
    // (D19): a plan that passes every check leads to the notice that says so.
    guardLeave(() => {
      const { plan: current, violations: broken, layout: drawn } = latest.current;
      const verdict = reviewVerdict(current, broken);
      if (verdict.refusal === "review_unavailable" && onReview) {
        onReview();
        return;
      }
      refuse(verdict.refusal);
      if (verdict.refusal === "review_unavailable") return;
      const rect = targetRect(drawn, verdict.target);
      if (rect) viewportRef.current?.revealRect(rect);
    });
  }, [guardLeave, refuse, onReview]);

  const handleBack = useCallback(() => guardLeave(onBackToMandate), [guardLeave, onBackToMandate]);

  const noticeText =
    notice && notice.plan === plan ? reviewCopy[REVIEW_NOTICE_KEY[notice.refusal]] : null;

  // [D18] Storage holds a plan this build cannot read: say so until a save replaces it. The store
  // drops the marker only on the save that carries the new plan, so a block added since keeps the
  // notice up (its copy says that saving replaces the stored plan).
  const unreadable = draft.planUnreadable === true;

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
            <BlockPanel
              ctx={controller.context}
              selectedId={selectedId}
              menuSentence={controller.menuSentence}
              panel={panel}
              removeConfirmOpen={controller.removeConfirmId !== null}
              onRemoveRequest={() => {
                if (selectedId) controller.requestRemove(selectedId);
              }}
              onRemoveCancel={controller.cancelRemove}
              onRemoveConfirm={controller.confirmRemove}
              onEditMandate={controller.editMandate}
              onLimitHit={onLimitHit}
            />
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
