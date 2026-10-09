/**
 * @id PP-MGR-SCR-002
 * @name FundStrategyBuilderScreen
 * @implements-rules-version v3 (POO-2122 rules v1, POO-2167 rules v3, POO-2157 rules v1, POO-2195 rules v1, POO-2197 rules v2)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events builder_mandate_started, builder_mandate_step_viewed,
 *   builder_mandate_step_submitted, builder_mandate_blocked, builder_mandate_completed,
 *   builder_mandate_abandoned, builder_draft_saved, builder_mandate_error,
 *   builder_build_abandoned, builder_build_error, builder_build_submitted, builder_build_completed,
 *   builder_review_error (the Build canvas and ReviewPhase own their view/interaction events),
 *   solana_preview_viewed, solana_preview_started, solana_preview_interacted,
 *   solana_preview_applied, solana_preview_abandoned, solana_preview_blocked, solana_preview_error
 *
 * The fund-contracts strategy builder: the shell the five Mandate steps live in (POO-2122, epic
 * POO-2119). Page header, the three-phase stepper, the collapsible sub-step header, the step body,
 * the sticky action bar, Save & exit, the unsaved guard, deep links and the funnel.
 *
 * The step BODIES are separate slices and arrive as placeholders. Everything below is what does not
 * belong to any one of them: where the manager is, how they move, and what is recorded when they do.
 *
 * ## The draft is the current step
 *
 * There is no `step` state here. The current step is `draft.lastStep`, because the draft is also
 * what a resumed session reads, and two sources would have to be kept in sync by hand across Next,
 * Back, the sub-step header, a deep link and a reload. One of the two would eventually win on the
 * wrong screen. `passedSteps` is the other half: it is append-only and it is what makes a step
 * reachable, so navigation can never jump ahead of validation.
 *
 * One exception, read through `resumeStep`: when `lastStep` names a step the draft no longer has,
 * the current step is the first unpassed one. A stored draft parked on Pools whose only position
 * protocol was Uniswap v3 arrives exactly like that (R20 v3, POO-2167), and reading `lastStep` raw
 * drew one frame of a step the stepper does not show, with its view event and its URL.
 *
 * ## Why `completed` fires on the SAVE and not on the last Next
 *
 * CLAUDE.md premise 11 says a completion fires on settlement. The Mandate signs nothing, so its
 * only settlement is persistence: a mandate that was not written down does not exist after a
 * reload, and counting the click would report completions that left no trace. The last Next
 * therefore saves first (asking for a name when the draft has none) and emits only once `save()`
 * answered `{ ok: true }`.
 *
 * `completedAt` follows the same rule and for the same reason: it is stamped by that write
 * (`save(..., { complete: true })`), never before it. A stamp set on the click survives a failed
 * save and a "Keep editing", leaving a draft that claims a completion no event ever reported and
 * that `?phase=build` happily opens. The symmetric half is in `update` below: a selection changed
 * after the mandate closed takes the stamp back, so Build can never summarise a mandate the draft
 * no longer holds.
 *
 * That last Next is also the one that validates the WHOLE mandate rather than the step in front of
 * the manager, because a step passed earlier can have stopped being satisfied since: see
 * {@link firstRefusal}.
 *
 * ## Why the blocked and abandoned events are not optional
 *
 * Four of the five steps can refuse Next with the button still enabled (R6), and a disabled CTA
 * generates no click, no error and no event. Without `builder_mandate_blocked` a manager stopped by
 * the product looks exactly like a manager who lost interest; without `builder_mandate_abandoned`
 * the funnel's arithmetic does not close (`started` = `completed` + `abandoned`, with
 * `draft_saved` separating the session that lost work from the one that parked it).
 *
 * ## The URL is written only once the draft exists
 *
 * A draft lives in memory until the first save, so until then there is nothing a reload could
 * restore and the URL stays clean. From the first save on, every step change rewrites
 * `?draft=<id>&step=<key>`, which is what makes a refresh and a Console "Open" land on the same
 * screen.
 *
 * ## Why the phase is derived rather than set in an effect (POO-2127 [B3])
 *
 * The Build phase (`BuildScreen`, the canvas, POO-2157) opens when the mandate completes, and a
 * `?phase=build` link reopens it on a draft that already completed. That second half cannot be an
 * effect. The resume effect and the step-view effect run in the SAME commit after hydration, so an
 * effect that called `setPhase("build")` would still leave `phase === "mandate"` in the render the
 * view effect reads,
 * and every deep link into Build would emit a phantom `builder_mandate_step_viewed{step:"limits"}`
 * for a screen the manager never saw. Deriving the phase during render closes that window: the
 * first render that has the stored draft already knows which phase it is.
 *
 * `phase=build` is NOT trusted on its own. Build exists only for a mandate that closed, so a stale
 * or hand-edited link into it lands on the Mandate instead of on a Build canvas planning over a
 * mandate that was never finished.
 *
 * ## The Build phase (POO-2157, handoff v1.2 of the Build canvas)
 *
 * The canvas replaced the Build landing (D24) and takes the full content width (D23). The header,
 * Save & exit and the stepper stay here, unchanged, with Build current (AN1). Four things are the
 * shell's because only the shell sees them:
 *
 * 1. **Every way out passes the canvas's selection guard (HU3).** The panel of the next batch will
 *    refuse to lose unapplied changes; Back: Mandate and the Edit mandate links are the canvas's
 *    own, while Save & exit and the stepper's Mandate pill are here, so they ask the guard through
 *    the `leaveGuardRef` the canvas fills while it is mounted.
 * 2. **Every save writes the phase the manager is in (`lastPhase`, D16):** `build` in Build,
 *    `mandate` in the Mandate phase, including after Back: Mandate and after an Edit mandate link.
 *    Without it, Back then Save & exit would leave `build` behind and the Console Open would land
 *    on Build instead of on the step the manager left. The completing save of the mandate writes
 *    `build`: it is the write that opens Build, so a manager who leaves right after it is resumed
 *    where they were.
 * 3. **An Edit mandate link opens Mandate step 1 or 2** with the plan in the draft; walking forward
 *    through Next: Build strategy returns to Build with the plan intact (C6, A4).
 * 4. **The end of a Build session is reported as Build's:** leaving without a Save & exit is
 *    `builder_build_abandoned` (whether unsaved plan edits were left behind, and how many blocks),
 *    and a save that fails from Build is `builder_build_error`. A Build session is never also counted
 *    as a Mandate abandonment: the mandate it plans over is already closed.
 *
 * ## The Review phase (POO-2195 rules v1)
 *
 * Next: Review first passes the Build selection guard and readiness check, then saves the plan
 * with `lastPhase: "review"` before opening ReviewPhase. The stored phase and `?phase=review`
 * resume a completed mandate directly in Review; an incomplete mandate still resumes Mandate.
 * Save & exit preserves `review`, while Back: Build restores `build` and can reveal the selected
 * readiness blocker without changing the canvas selection. ReviewPhase owns the review fields,
 * launch gates and the existing launch journey; this shell owns phase persistence and navigation.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBuildShellLayout } from "@/components/layout/BuildShellLayout";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { AnalyticsMandateBlockReason } from "@/lib/analytics/events";
import type { AnalyticsBlockReason } from "@/lib/analytics/txFlowKit";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useAuth } from "@/lib/auth/useAuth";
import { useSolanaPreviewExitAcknowledgement } from "@/lib/experiments/solanaPreviewStore";
import { useNavigationGuard, useUnsavedChanges } from "@/lib/hooks/unsavedChanges";
import { cn } from "@/lib/utils/cn";
import { BuilderStepper } from "../components/BuilderStepper";
import { BuildScreen, type LeaveGuard } from "./build/BuildScreen";
import type { MandateEditStep } from "./build/blocks/useBuildCanvas";
import { planCounts } from "./build/buildAnalytics";
import { type BuilderPhase, planOf } from "./build/plan/buildPlan";
import type { ReadinessTarget } from "./build/plan/planReadiness";
import { BuilderActionBar } from "./components/BuilderActionBar";
import { MandateCatalogStatus } from "./components/MandateCatalogStatus";
import { MandateSubStepHeader } from "./components/MandateSubStepHeader";
import { NameDraftDialog } from "./components/NameDraftDialog";
import { getLaunchStatusForDraft } from "./launch/journey";
import type { MandateCatalog } from "./mandateCatalog";
import {
  firstUnpassedStep,
  isBlocked,
  isStepReachable,
  MANDATE_STEP_ORDER,
  type MandateBlockReason,
  type MandateDraft,
  type MandateStepKey,
  nextStep,
  previousStep,
  resumeStep,
  type StepBlock,
  selectionCounts,
  selectionFingerprint,
  stepIndex,
  validateStep,
  visibleSteps,
} from "./mandateDraft";
import { LocalSolanaReview } from "./review/LocalSolanaReview";
import { ReviewPhase } from "./review/ReviewPhase";
import { SolanaPreviewRenderBoundary } from "./solana-preview/SolanaPreviewErrorBoundary";
import { useSolanaBuilderDraft } from "./solana-preview/useSolanaBuilderDraft";
import { LimitsStep } from "./steps/LimitsStep";
import { NetworksStep } from "./steps/NetworksStep";
import { PoolsStep } from "./steps/PoolsStep";
import { ProtocolsStep } from "./steps/ProtocolsStep";
import type { MandateStepProps } from "./steps/stepProps";
import { TokensStep } from "./steps/TokensStep";
import { type UseMandateDraftResult, useMandateDraft } from "./useMandateDraft";

/** Which component renders each step. The shell knows the keys; the bodies know the mandate. */
const STEP_BODIES: Record<MandateStepKey, ComponentType<MandateStepProps>> = {
  networks: NetworksStep,
  protocols: ProtocolsStep,
  tokens: TokensStep,
  pools: PoolsStep,
  limits: LimitsStep,
};

/** The two steps that render a second column, and therefore need the full content width. */
const WIDE_STEPS: readonly MandateStepKey[] = ["tokens", "pools"];

/**
 * Every refusal the mandate can raise, as the reason GA4 receives.
 *
 * Total by construction (a `Record` over the domain union), so a reason added upstream fails to
 * compile here rather than reaching the dataLayer as an unmapped string. Two fold into reasons that
 * already existed: a name that fails its length rule is `name_invalid`, which is what the V1 Review
 * already reports for the identical rule, and a token with no price feed is `price_unknown`. One
 * question, one series, across both builders.
 */
export const MANDATE_BLOCK_REASON_EVENT: Record<
  MandateBlockReason,
  AnalyticsBlockReason | AnalyticsMandateBlockReason
> = {
  nothing_selected: "nothing_selected",
  cap_missing: "cap_missing",
  token_allowance_required: "token_allowance_required",
  no_slots: "no_slots",
  has_hook: "has_hook",
  coming_soon: "coming_soon",
  not_priced: "price_unknown",
  name_length: "name_invalid",
};

/** The counts every funnel event carries, so a drop-off can be read against what was chosen. */
function countParams(draft: MandateDraft) {
  const counts = selectionCounts(draft);
  return {
    networks_count: counts.networks,
    protocols_count: counts.protocols,
    tokens_count: counts.tokens,
    pools_count: counts.pools,
  };
}

/** A step key from the URL, or null for anything else (an old link, a typo, a removed step). */
function parseStepKey(value: string | null): MandateStepKey | null {
  return MANDATE_STEP_ORDER.find((step) => step === value) ?? null;
}

/**
 * [B10] The first visible step that refuses, in mandate order; null when the whole mandate passes.
 *
 * A step is validated when it is PASSED, and `passedSteps` is append-only, so a step can stop being
 * satisfied after it was passed and nothing ever asks again. Two edits do exactly that from another
 * screen: removing a token on step 3 drops the pools that held it, and dropping a position protocol
 * on step 2 drops its pools too. Pools stayed in `passedSteps`, so the sub-step header kept offering
 * Limits and the completing Next closed a mandate that names a position protocol and holds no pools
 * at all, which the handoff's per-screen contract and R6's "step 4 with zero pools" both refuse.
 *
 * In mandate order rather than "the worst one", because the first unsatisfied step is the earliest
 * decision the manager has to revisit, and fixing it can change what the later ones even ask.
 */
function firstRefusal(draft: MandateDraft, catalog: MandateCatalog): StepBlock | null {
  for (const candidate of visibleSteps(draft)) {
    const blocked = validateStep(draft, candidate, catalog);
    if (blocked) return blocked;
  }
  return null;
}

/** The shape the builder holds while the draft store has not been read yet. */
function BuilderSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Skeleton height={32} width="18rem" />
      <Skeleton height={96} radius="0.75rem" />
      <Skeleton height={96} radius="0.75rem" />
      <Skeleton height={96} radius="0.75rem" />
    </div>
  );
}

/** The fund-contracts strategy builder (V2). Renders the Mandate phase, then the Build canvas. */
export interface FundStrategyBuilderScreenProps {
  runtime?: "standard" | "solana-local";
  onExitPreview?: (onAccepted: () => void) => void;
  standardCheckpoint?: { current: import("./useMandateDraft").MandateDraftCheckpoint | null };
}
export function FundStrategyBuilderScreen({
  runtime = "standard",
  onExitPreview,
  standardCheckpoint,
}: FundStrategyBuilderScreenProps = {}) {
  return runtime === "solana-local" ? (
    <LocalBuilderBinding onExitPreview={onExitPreview} />
  ) : (
    <StandardBuilderBinding checkpoint={standardCheckpoint} />
  );
}
function StandardBuilderBinding({
  checkpoint,
}: {
  checkpoint: FundStrategyBuilderScreenProps["standardCheckpoint"];
}) {
  const searchParams = useSearchParams();
  const [initialDraftId] = useState(() => searchParams.get("draft") ?? undefined);
  const [requestedStep] = useState(() =>
    checkpoint?.current ? null : parseStepKey(searchParams.get("step")),
  );
  const [requestedPhase] = useState(() =>
    checkpoint?.current ? (checkpoint.current.phase ?? null) : searchParams.get("phase"),
  );
  const state = useMandateDraft(initialDraftId, checkpoint);
  const { address, isLoading: walletLoading } = useAuth();
  const hasExistingJourney =
    state.hydrated && getLaunchStatusForDraft(state.draft.id, address ?? null) !== null;
  return (
    <FundBuilderShell
      binding={state}
      initialDraftId={initialDraftId}
      requestedStep={requestedStep}
      requestedPhase={requestedPhase}
      walletLoading={walletLoading}
      hasExistingJourney={hasExistingJourney}
      checkpoint={checkpoint}
    />
  );
}
function LocalBuilderBinding({
  onExitPreview,
}: {
  onExitPreview?: FundStrategyBuilderScreenProps["onExitPreview"];
}) {
  const state = useSolanaBuilderDraft();
  const t = useTranslations("manager");
  const { track } = useAnalytics();
  const router = useRouter();
  const guard = useNavigationGuard();
  const [pendingChanges, setPendingChanges] = useState(false);
  const [didExit, setDidExit] = useState(false);
  const latest = useRef({ dirty: state.isDirty, pending: pendingChanges, track });
  latest.current = { dirty: state.isDirty, pending: pendingChanges, track };
  const exited = useRef(false);
  const acceptOwnerExit = useCallback(() => {
    exited.current = true;
    setDidExit(true);
  }, []);
  useSolanaPreviewExitAcknowledgement(acceptOwnerExit);
  const exit = useCallback(
    (onShellAccepted: () => void) => {
      const accept = () => {
        acceptOwnerExit();
        onShellAccepted();
      };
      if (onExitPreview) onExitPreview(accept);
      else
        guard(() => {
          accept();
          router.push("/manager");
        });
    },
    [acceptOwnerExit, guard, onExitPreview, router],
  );
  // A render failure removes inner guards; applied and last-reported pending changes remain owned here.
  useUnsavedChanges(!didExit && (state.isDirty || pendingChanges));
  // The owner survives render fallback/retry. Only disposing the local session is abandonment.
  useEffect(
    () => () => {
      if (!exited.current)
        latest.current.track("solana_preview_abandoned", {
          has_local_changes: latest.current.dirty || latest.current.pending,
        });
    },
    [],
  );
  return (
    <SolanaPreviewRenderBoundary
      hasLocalChanges={state.isDirty || pendingChanges}
      fallback={(retry) => (
        <div role="alert" className="rounded-2xl border border-border bg-surface p-5">
          <p>{t("solanaPreview.unexpectedError")}</p>
          <Button className="mt-3" onClick={retry}>
            {t("solanaPreview.tryAgain")}
          </Button>
        </div>
      )}
    >
      <FundBuilderShell
        binding={state}
        walletLoading={false}
        hasExistingJourney={false}
        onExitPreview={exit}
        localExitAccepted={didExit}
        onLocalPendingChangesChange={setPendingChanges}
      />
    </SolanaPreviewRenderBoundary>
  );
}
/** One presentation and navigation shell; only its data/recovery binding differs. */
function FundBuilderShell({
  binding,
  initialDraftId,
  requestedStep = null,
  requestedPhase = null,
  walletLoading,
  hasExistingJourney,
  onExitPreview,
  localExitAccepted = false,
  onLocalPendingChangesChange,
  checkpoint,
}: {
  binding: UseMandateDraftResult;
  initialDraftId?: string;
  requestedStep?: MandateStepKey | null;
  requestedPhase?: string | null;
  walletLoading: boolean;
  hasExistingJourney: boolean;
  onExitPreview?: (onAccepted: () => void) => void;
  localExitAccepted?: boolean;
  onLocalPendingChangesChange?: (dirty: boolean) => void;
  checkpoint?: FundStrategyBuilderScreenProps["standardCheckpoint"];
}) {
  const t = useTranslations("manager");
  const router = useRouter();
  const pathname = usePathname();
  const analytics = useAnalytics();
  const local = binding.draft.runtime === "solana-local";
  const track = useCallback<typeof analytics.track>(
    (event, params) => {
      if (!local) {
        analytics.track(event, params);
        return;
      }
      if (event.includes("abandoned")) return;
      else if (event.includes("error"))
        analytics.track("solana_preview_error", { error_code: "SOLANA_LOCAL_SAVE_FAILED" });
      else if (event.includes("blocked"))
        analytics.track("solana_preview_blocked", { error_code: "SOLANA_LOCAL_INTENT_BLOCKED" });
      else if (event === "builder_mandate_started") analytics.track("solana_preview_viewed");
      else if (event.includes("started")) analytics.track("solana_preview_started");
      else if (event.includes("completed") || event === "builder_draft_saved")
        analytics.track("solana_preview_applied");
      else analytics.track("solana_preview_interacted");
    },
    [analytics.track, local],
  );
  const {
    draft,
    catalog,
    update: applyReducer,
    save,
    hydrated,
    lastBlock,
    clearBlock,
    isDirty,
  } = binding;
  const awaitingWallet = hydrated && draft.completedAt !== null && walletLoading;
  const awaitingCatalog =
    hydrated &&
    draft.completedAt !== null &&
    !hasExistingJourney &&
    catalog.dataMode === "real" &&
    Boolean(catalog.loading || catalog.error);
  const resumePending = awaitingWallet || awaitingCatalog;
  const revisedLimitsBlock = useMemo(
    () =>
      hydrated && draft.completedAt !== null && !hasExistingJourney && !resumePending
        ? validateStep(draft, "limits", catalog)
        : null,
    [hydrated, draft, hasExistingJourney, resumePending, catalog],
  );
  const [revisitedMandate, setRevisitedMandate] = useState(false);
  const step =
    revisedLimitsBlock &&
    !revisitedMandate &&
    ["build", "review"].includes(requestedPhase ?? draft.lastPhase ?? "")
      ? "limits"
      : resumeStep(draft);
  const steps = visibleSteps(draft);
  const position = stepIndex(draft, step);

  /**
   * The phase the manager NAVIGATED to, or null while nobody has moved between phases yet.
   *
   * Null is not "mandate": it means the URL and the draft still decide, which is what makes the
   * derivation below correct on the very first render that has the stored draft. See the file
   * header for why this is not an effect.
   */
  const [reviewRevealTarget, setReviewRevealTarget] = useState<ReadinessTarget | null>(null);
  const [phaseChoice, setPhaseChoice] = useState<BuilderPhase | null>(null);
  const phase: BuilderPhase = revisedLimitsBlock
    ? "mandate"
    : (phaseChoice ??
      (["build", "review"].includes(requestedPhase ?? draft.lastPhase ?? "") &&
      draft.completedAt !== null
        ? ((requestedPhase ?? draft.lastPhase) as BuilderPhase)
        : "mandate"));

  const localBuildEntered = useRef(false);
  if (local && phase === "build") localBuildEntered.current = true;

  useEffect(() => {
    if (checkpoint?.current) checkpoint.current.phase = phase;
  }, [checkpoint, phase]);

  useBuildShellLayout(phase === "build");
  const [dialog, setDialog] = useState<"exit" | "complete" | null>(null);
  const [shellBlock, setShellBlock] = useState<StepBlock | null>(null);
  const [exiting, setExiting] = useState(false);

  // The block the step body renders: the shell's own (a refused Next) takes precedence over the
  // hook's, which records a reducer that refused a selection.
  const activeBlock = shellBlock ?? lastBlock ?? revisedLimitsBlock;

  // R9 / handoff: the browser warns before losing a mandate, from the first selection onward.
  // `exiting` disarms it on the way out, so Save & exit does not prompt about work it just saved.
  useUnsavedChanges(isDirty && !exiting && !localExitAccepted);

  // Refs for the values the unmount handler reads. A closure would report where the manager was
  // when the effect was created, which on an abandonment is never where they left.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const trackRef = useRef(track);
  trackRef.current = track;
  const routerRef = useRef(router);
  routerRef.current = router;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  /** Set by a completion or a Save & exit: the session was answered, not abandoned. */
  const concludedRef = useRef(false);
  /** Guards the funnel arithmetic: one completion per session, however the session got there. */
  const completedRef = useRef(false);
  /** Set by Save & exit only: a Build session that ended there was parked, not abandoned. */
  const exitedRef = useRef(false);
  // The unmount handler and the save failure report by phase, and the Build abandonment says
  // whether unsaved plan edits were left behind: both read the value of the LAST render.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  /**
   * [HU3] The Build canvas's leave check, filled by `BuildScreen` while it is mounted. The shell's
   * own ways out of Build (Save & exit, the stepper's Mandate pill) pass through it; in the Mandate
   * phase there is no canvas and they proceed at once.
   */
  const buildLeaveRef = useRef<LeaveGuard | null>(null);
  /**
   * [Finding 19, POO-2187] The block selected when an Edit mandate link left Build: the walk forward
   * brings Build back with it selected. Back: Mandate is not an edit and clears it.
   */
  const [buildReturnBlock, setBuildReturnBlock] = useState<string | null>(
    () => checkpoint?.current?.selectedId ?? null,
  );
  const guardBuildExit = useCallback((proceed: () => void) => {
    const guard = phaseRef.current === "build" ? buildLeaveRef.current : null;
    if (guard) guard(proceed);
    else proceed();
  }, []);

  /**
   * [D16] Stamp the phase this save belongs to, right before the save reads the draft.
   *
   * Straight to the reducer, like the universe count below: the phase is bookkeeping, in no
   * fingerprint, so it neither reopens a completed mandate nor arms the leave prompt, and it leaves
   * the shell's refused-Next notice alone.
   */
  const stampPhase = useCallback(
    (next: BuilderPhase) => {
      // A draft already stamped is left alone: even an identical write clears the hook's own notice.
      if (draftRef.current.lastPhase === next) return;
      applyReducer((d) => ({ ...d, lastPhase: next }));
    },
    [applyReducer],
  );

  /**
   * Every write to the draft, with the two things only the shell can know.
   *
   * **A refusal is answered by the next selection that works.** `shellBlock` outranks the hook's own
   * block (a refused Next has to win over an older reducer refusal) and used to be cleared only by
   * navigation, so the notice outlived the problem: a cap was set, the Add button came back, and the
   * manager still read a refusal until they pressed Next or Back. A notice that survives its cause is
   * how people learn to ignore notices.
   *
   * **A completed mandate that is edited is open again.** `completedAt` is what makes the Build
   * canvas reachable and what a `?phase=build` link trusts, so a cap moved after the mandate closed
   * has to take it back; the next Next through Limits closes it again, and that Next is a write,
   * which is what a completion is. Only the five SELECTIONS count, through
   * `selectionFingerprint`: moving between steps is not an edit, and counting `lastStep` here would
   * un-complete a mandate for walking back through it.
   */
  const update = useCallback(
    (fn: (current: MandateDraft) => MandateDraft | { blocked: StepBlock }) => {
      let settled = false;
      applyReducer((current) => {
        const result = fn(current);
        if (isBlocked(result)) return result;
        settled = true;
        if (current.completedAt === null) return result;
        return selectionFingerprint(result) === selectionFingerprint(current)
          ? result
          : { ...result, completedAt: null };
      });
      // `applyReducer` runs the reducer synchronously, so this reads THIS call's outcome.
      if (settled) setShellBlock(null);
    },
    [applyReducer],
  );

  /**
   * The denominator the Pools step resolved (R13), written AROUND the wrapper above.
   *
   * `update` clears a refused Next as soon as a write settles, which is what makes a notice
   * disappear the moment the manager answers it. This write is not an answer: the step publishes its
   * universe count from a passive effect, the moment a read it started on open comes back, so a Next
   * refused while the pools were loading lost its notice a few hundred milliseconds later with
   * nothing having been chosen. Going straight to the reducer keeps the notice up.
   *
   * It also cannot reopen a completed mandate or arm the leave-page prompt, and that is by design
   * rather than by luck: `selectionFingerprint` and `useMandateDraft`'s own dirty check both exclude
   * `poolUniverseCount`, because it is bookkeeping the step derives rather than anything a manager
   * chose. The equality check keeps the write out of React entirely when the draft already agrees.
   */
  const recordUniverseCount = useCallback(
    (count: number) => {
      applyReducer((d) => (d.poolUniverseCount === count ? d : { ...d, poolUniverseCount: count }));
    },
    [applyReducer],
  );

  const reportBlocked = useCallback(
    (block: StepBlock) => {
      setShellBlock(block);
      track("builder_mandate_blocked", {
        step: block.step,
        block_reason: MANDATE_BLOCK_REASON_EVENT[block.reason],
      });
    },
    [track],
  );

  const reportedRevisionBlock = useRef<string | null>(null);
  useEffect(() => {
    if (!revisedLimitsBlock || walletLoading) return;
    const key = `${draft.id}:${revisedLimitsBlock.reason}:${revisedLimitsBlock.rowId}`;
    if (reportedRevisionBlock.current === key) return;
    reportedRevisionBlock.current = key;
    track("builder_mandate_blocked", {
      step: "limits",
      block_reason: MANDATE_BLOCK_REASON_EVENT[revisedLimitsBlock.reason],
    });
  }, [draft.id, revisedLimitsBlock, track, walletLoading]);

  /**
   * The Pools step could not read its catalog (POO-2125 [R30]).
   *
   * `error_origin: "upstream"` and not `"app"`: the step's own code ran, the read it depends on did
   * not come back, and the two origins are what separates a defect of ours from a dependency that is
   * down. The step reports through a prop rather than tracking directly, so every event this builder
   * emits still leaves from one file.
   */
  const reportPoolsError = useCallback(
    (error: { code: string }) => {
      track("builder_mandate_error", {
        step: "pools",
        error_code: error.code,
        error_origin: "upstream",
      });
    },
    [track],
  );

  const reportSaveFailure = useCallback(() => {
    // A save that fails from the Build canvas is Build's error: the mandate is already closed, and a
    // Mandate error row would put a Build failure on the Limits step's count.
    if (phaseRef.current === "review") {
      track("builder_review_error", { error_code: "REVIEW_SAVE_FAILED" });
      return;
    }
    if (phaseRef.current === "build") {
      track("builder_build_error", { error_code: "DRAFT_SAVE_FAILED", error_origin: "app" });
      return;
    }
    track("builder_mandate_error", {
      step: draftRef.current.lastStep,
      // Spelled as a code, not as "storage": `error_code` is a dimension people group by, and every
      // value in it is shaped `<DOMAIN>_<REASON>` (`isAnalyticsErrorCodeShape`). A free word would be
      // a failure row that groups with nothing.
      error_code: "DRAFT_SAVE_FAILED",
      error_origin: "app",
    });
  }, [track]);

  /**
   * Resume where the draft says, or where it is allowed to.
   *
   * Runs once, after the store has been read. A requested step that nobody reached is not an error
   * worth a screen: the manager is put on the first step they have not passed and the URL is
   * corrected to say so, which is also what an old bookmark into a mandate that shrank needs.
   */
  const resumed = useRef(false);
  useEffect(() => {
    if (!hydrated || resumePending || resumed.current) return;
    resumed.current = true;
    const current = draftRef.current;

    // `savedAt` is stamped only by `save()`, so a draft that still has none was never in storage:
    // either no id was asked for, or the id in the URL names a draft that is gone.
    if (current.savedAt === null) {
      if (initialDraftId) routerRef.current.replace(pathnameRef.current, { scroll: false });
      trackRef.current("builder_mandate_started", countParams(current));
      return;
    }

    const wanted = requestedStep ?? current.lastStep;
    const target = isStepReachable(current, wanted) ? wanted : firstUnpassedStep(current);
    if (target !== current.lastStep) update((d) => ({ ...d, lastStep: target }));
  }, [hydrated, resumePending, initialDraftId, requestedStep, update]);

  /**
   * One view per step VISIT, not per render and not per mount.
   *
   * The five steps share a pathname, so `page_viewed` sees one screen where there are five. A
   * revisit counts again on purpose: Back is part of how the Mandate is used, and a denominator
   * that ignored it would make the per-step refusal rates look better than they are.
   */
  const viewedStep = useRef<MandateStepKey | null>(null);
  useEffect(() => {
    if (!hydrated || resumePending || phase !== "mandate" || viewedStep.current === step) return;
    viewedStep.current = step;
    track("builder_mandate_step_viewed", { step });
  }, [hydrated, resumePending, phase, step, track]);

  /**
   * From the first save on, the URL names the draft, the step and the phase, so a reload restores
   * all three. The phase is appended only in Build: `&phase=mandate` would be a parameter that
   * means the default, and a Back from Build has to leave the URL as it was before it.
   */
  useEffect(() => {
    if (local || !hydrated || resumePending || draft.savedAt === null) return;
    const query = `?draft=${draft.id}&step=${step}${phase !== "mandate" ? `&phase=${phase}` : ""}`;
    routerRef.current.replace(`${pathname}${query}`, { scroll: false });
  }, [hydrated, resumePending, draft.savedAt, draft.id, step, phase, pathname, local]);

  // Every step transition starts at the top: the steps are tall, and advancing otherwise drops the
  // manager mid-scroll into a list they have not seen the top of. Instant, per the 2026-06-26 rule.
  // biome-ignore lint/correctness/useExhaustiveDependencies: step is the trigger; the body does not read it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  /**
   * A session that neither completed nor saved and left reports that it was abandoned.
   *
   * Empty deps so the cleanup runs on the REAL unmount, and everything it reads comes from a ref:
   * the pattern `provisioningFunnel.ts` and `txFlowKit.ts` settled, for the same reason here.
   */
  useEffect(
    () => () => {
      // Local session abandonment belongs to the owner outside its retry boundary.
      if (draftRef.current.runtime === "solana-local") return;
      // A session that ends on the Build canvas is Build's to report (POO-2157): the mandate under
      // it already closed. Only a Save & exit parks it; everything else is an abandonment, and what
      // it lost is a plan edit made since the last save.
      if (phaseRef.current === "review") return;
      if (phaseRef.current === "build") {
        if (exitedRef.current) return;
        trackRef.current("builder_build_abandoned", {
          draft_saved: !isDirtyRef.current,
          blocks_count: planCounts(planOf(draftRef.current)).blocks_count,
        });
        return;
      }
      if (concludedRef.current) return;
      trackRef.current("builder_mandate_abandoned", {
        step: draftRef.current.lastStep,
        // Saved AND nothing unsaved since (POO-2157, review F3 of PR #41): a draft saved once and
        // edited afterwards (a selection, or a plan edit before a Back: Mandate) lost those edits.
        draft_saved: draftRef.current.savedAt !== null && !isDirtyRef.current,
      });
    },
    [],
  );

  /** Record the completion and open the Build phase. Only ever called after a save landed. */
  const concludeCompletion = useCallback(() => {
    concludedRef.current = true;
    if (completedRef.current) {
      setPhaseChoice("build");
      return;
    }
    completedRef.current = true;
    track("builder_mandate_completed", {
      step: "limits",
      ...countParams(draftRef.current),
    });
    setPhaseChoice("build");
  }, [track]);

  /**
   * [B2] Leave the Build phase for the last Mandate step.
   *
   * Lands on Limits rather than on wherever `lastStep` happens to point: Build is reachable only
   * once the whole mandate passed, so "Back: Mandate" means the end of the mandate, and a
   * `?step=tokens&phase=build` link would otherwise send the Back button somewhere the manager
   * never was.
   *
   * The view ref is cleared so Limits is counted again. Returning from Build IS a visit, and the
   * per-step denominator that ignored it would make the step's own refusal rate read better than
   * it is, which is the exact failure `builder_mandate_step_viewed` exists to prevent.
   */
  const handleBackToMandate = useCallback(() => {
    viewedStep.current = null;
    setShellBlock(null);
    clearBlock();
    setBuildReturnBlock(null);
    setPhaseChoice("mandate");
    update((d) => ({ ...d, lastStep: "limits" }));
  }, [clearBlock, update]);

  /**
   * [C6, A4] An Edit mandate link of the Build canvas (step 1 networks, step 2 protocols) or of its
   * configuration panel (step 3 tokens, step 4 pools, step 5 limits; finding 19), with the plan left
   * in the draft. Every step was passed (Build needs a closed mandate), so it is reachable; walking
   * forward through Next: Build strategy closes the mandate again and returns to Build with the plan
   * intact and the block that was selected selected again. The canvas already asked its guard.
   */
  const handleEditMandate = useCallback(
    (target: MandateEditStep, selectedId: string | null) => {
      viewedStep.current = null;
      setShellBlock(null);
      clearBlock();
      setBuildReturnBlock(selectedId);
      setPhaseChoice("mandate");
      update((d) => ({ ...d, lastStep: target }));
    },
    [clearBlock, update],
  );

  const handleNext = useCallback(async () => {
    const next = nextStep(draft, step);

    /**
     * [B10] The completing Next answers for the WHOLE mandate; every other Next answers for the
     * step in front of the manager.
     *
     * Walking forward validates each step as it is left, which is enough while there is a step
     * after this one. The last Next is different in kind: it is the one that closes the mandate, and
     * a step passed earlier can have stopped being satisfied since (see {@link firstRefusal}).
     */
    const blocked = next ? validateStep(draft, step, catalog) : firstRefusal(draft, catalog);
    if (blocked) {
      // Take the manager to the step that actually failed: a notice on Limits about Pools would be
      // a dead end on a screen with nothing to fix. The navigation goes FIRST, because `update`
      // clears `shellBlock` on any write that settles, so reporting before it would hand the
      // manager the right screen with no notice on it.
      if (blocked.step !== step) {
        setRevisitedMandate(true);
        update((d) => ({ ...d, lastStep: blocked.step }));
      }
      reportBlocked(blocked);
      return;
    }
    setShellBlock(null);
    clearBlock();
    track("builder_mandate_step_submitted", { step, ...countParams(draft) });

    if (next) {
      update((d) => ({
        ...d,
        passedSteps: d.passedSteps.includes(step) ? d.passedSteps : [...d.passedSteps, step],
        lastStep: next,
      }));
      return;
    }

    // The last step. Nothing is marked finished here: `completedAt` is stamped by the WRITE that
    // settles the mandate (`save(..., { complete: true })`), because a stamp set before the write
    // survives a failed one and leaves a draft that claims a completion nothing recorded. An unnamed
    // draft answers the dialog first, and that dialog's save is the completing one.
    update((d) => ({
      ...d,
      passedSteps: d.passedSteps.includes(step) ? d.passedSteps : [...d.passedSteps, step],
    }));
    if (draft.name === null) {
      setDialog("complete");
      return;
    }
    // D16: the completing save is the write that opens Build, so it records Build.
    stampPhase("build");
    const result = await save(undefined, { complete: true });
    if (!result.ok) {
      reportSaveFailure();
      toast.error(t("fundBuilder.draft.saveFailed"));
      return;
    }
    track("builder_draft_saved", { step, first_save: false });
    concludeCompletion();
  }, [
    catalog,
    clearBlock,
    concludeCompletion,
    draft,
    reportBlocked,
    reportSaveFailure,
    save,
    stampPhase,
    step,
    t,
    track,
    update,
  ]);

  const handleBack = useCallback(() => {
    const previous = previousStep(draft, step);
    if (!previous) return;
    setRevisitedMandate(true);
    setShellBlock(null);
    clearBlock();
    update((d) => ({ ...d, lastStep: previous }));
  }, [clearBlock, draft, step, update]);

  const handleNavigate = useCallback(
    (target: MandateStepKey) => {
      if (!isStepReachable(draft, target)) return;
      setRevisitedMandate(true);
      setShellBlock(null);
      clearBlock();
      update((d) => ({ ...d, lastStep: target }));
    },
    [clearBlock, draft, update],
  );

  const leaveForConsole = useCallback(() => {
    const accept = () => {
      concludedRef.current = true;
      exitedRef.current = true;
      setExiting(true);
    };
    if (local && onExitPreview) onExitPreview(accept);
    else {
      accept();
      router.push("/manager");
    }
  }, [router, local, onExitPreview]);

  const handleSaveExit = useCallback(async () => {
    // R7: the first save is the one that needs a name, and the dialog is where it is asked for.
    if (draft.name === null) {
      setDialog("exit");
      return;
    }
    // D16: the save records the phase the manager is in, so the Console Open resumes there.
    stampPhase(phaseRef.current);
    const result = await save();
    if (!result.ok) {
      reportSaveFailure();
      toast.error(t("fundBuilder.draft.saveFailed"));
      return;
    }
    track("builder_draft_saved", { step, first_save: false });
    toast(t(local ? "solanaPreview.localApplied" : "fundBuilder.draft.saved"));
    leaveForConsole();
  }, [draft.name, leaveForConsole, local, reportSaveFailure, save, stampPhase, step, t, track]);

  /**
   * The dialog's save. Wrapped so the shell reports the failure the dialog only renders.
   *
   * The MODE decides whether this write completes the mandate. The same dialog asks for the same
   * name on a Save & exit from step 2 and on the last Next, and only the second one is a completion;
   * a Keep editing in between must leave the mandate open, which is why nothing stamps it earlier.
   */
  const handleDialogSave = useCallback(
    async (name: string) => {
      // D16, as on the other two saves: the completing one records Build, the others the phase.
      stampPhase(dialog === "complete" ? "build" : phaseRef.current);
      const result = await save(name, { complete: dialog === "complete" });
      if (!result.ok && result.error === "storage") reportSaveFailure();
      return result;
    },
    [dialog, reportSaveFailure, save, stampPhase],
  );

  const handleDialogSaved = useCallback(() => {
    const mode = dialog;
    setDialog(null);
    // Always true here: the dialog only opens for a draft that has no name yet.
    track("builder_draft_saved", { step, first_save: true });
    if (mode === "complete") {
      concludeCompletion();
      return;
    }
    toast(t(local ? "solanaPreview.localApplied" : "fundBuilder.draft.saved"));
    leaveForConsole();
  }, [concludeCompletion, dialog, leaveForConsole, local, step, t, track]);

  const handleDialogBlocked = useCallback(() => {
    track("builder_mandate_blocked", {
      step,
      block_reason: MANDATE_BLOCK_REASON_EVENT.name_length,
    });
  }, [step, track]);

  const handleOpenReview = useCallback(async () => {
    track("builder_build_submitted", { family: "v2" });
    stampPhase("review");
    const result = await save();
    if (!result.ok) {
      stampPhase("build");
      reportSaveFailure();
      return;
    }
    track("builder_build_completed", { family: "v2" });
    setPhaseChoice("review");
  }, [save, stampPhase, reportSaveFailure, track]);
  const handleReviewBack = useCallback(
    (target?: ReadinessTarget | null) => {
      stampPhase("build");
      setPhaseChoice("build");
      setReviewRevealTarget(target ?? null);
    },
    [stampPhase],
  );

  if (!hydrated || awaitingWallet) return <BuilderSkeleton />;
  if (awaitingCatalog)
    return (
      <section className="mx-auto w-full max-w-3xl">
        <MandateCatalogStatus catalog={catalog} draft={draft} />
      </section>
    );

  const Body = STEP_BODIES[step];
  const counts = selectionCounts(draft);

  return (
    <section
      className={cn(
        "mx-auto flex w-full flex-col gap-6",
        // D23: the Build canvas takes the full content width; the Mandate keeps its columns.
        phase !== "mandate" ? null : WIDE_STEPS.includes(step) ? "max-w-[1100px]" : "max-w-3xl",
      )}
    >
      <div className="flex items-baseline gap-4">
        <h1 className="font-semibold text-2xl text-foreground">{t("builder.title")}</h1>
        {/* R1: no "Back to console" anywhere in this builder. Managers used it to step back one
            screen and lost everything, so the only way out is the one that saves. In Build it
            asks the canvas's selection guard first (HU3). */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            guardBuildExit(() => {
              void handleSaveExit();
            })
          }
        >
          {t("fundBuilder.header.saveExit")}
        </Button>
      </div>

      {local ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("solanaPreview.visualOnly")}
        </p>
      ) : null}

      {/* R2: the V1 stepper, unchanged. Build is reachable only once the mandate is finished, and
          [B4] Review stays unreachable: the stepper only makes an EARLIER phase clickable. Its
          Mandate pill is a way out of Build, so it asks the canvas's guard (HU3). */}
      <BuilderStepper
        active={phase}
        onStepClick={(target) => {
          if (target === "mandate") guardBuildExit(handleBackToMandate);
          if (target === "build" && phase === "review") {
            stampPhase("build");
            setPhaseChoice("build");
          }
        }}
      />

      {(local ? localBuildEntered.current : phase === "build") ? (
        <BuildScreen
          active={phase === "build"}
          draft={draft}
          catalog={catalog}
          update={update}
          onBackToMandate={handleBackToMandate}
          onEditMandate={handleEditMandate}
          initialSelectedId={buildReturnBlock}
          onSelectionChange={
            checkpoint
              ? (selectedId) => {
                  if (checkpoint.current) checkpoint.current.selectedId = selectedId;
                }
              : undefined
          }
          leaveGuardRef={buildLeaveRef}
          onLocalPendingChangesChange={onLocalPendingChangesChange}
          onReview={() => void handleOpenReview()}
          initialRevealTarget={reviewRevealTarget}
        />
      ) : null}

      {phase === "review" ? (
        local ? (
          <LocalSolanaReview
            draft={draft}
            update={update}
            onBackToBuild={handleReviewBack}
            onEditMandate={() => handleEditMandate("networks", null)}
          />
        ) : (
          <ReviewPhase
            draftId={draft.id}
            onBackToBuild={handleReviewBack}
            onEditMandate={() => handleEditMandate("networks", null)}
          />
        )
      ) : phase === "mandate" ? (
        <>
          <MandateSubStepHeader
            steps={steps}
            current={step}
            passed={draft.passedSteps}
            reachable={steps.filter((candidate) => isStepReachable(draft, candidate))}
            onNavigate={handleNavigate}
          />

          {/* Pools is the one step with a read that can fail, so it is the one step handed an
              `onError`. Everything else takes the shared contract unchanged. */}
          {step === "pools" ? (
            <PoolsStep
              draft={draft}
              catalog={catalog}
              update={update}
              block={activeBlock}
              onBlocked={reportBlocked}
              onError={reportPoolsError}
              onUniverseCount={recordUniverseCount}
            />
          ) : (
            <Body
              draft={draft}
              catalog={catalog}
              update={update}
              block={activeBlock}
              onBlocked={reportBlocked}
            />
          )}

          <BuilderActionBar
            previous={previousStep(draft, step)}
            next={nextStep(draft, step)}
            onBack={handleBack}
            onNext={() => {
              void handleNext();
            }}
          />
        </>
      ) : null}

      {dialog ? (
        <NameDraftDialog
          open
          mode={dialog}
          counts={{
            networks: counts.networks,
            protocols: counts.protocols,
            tokens: counts.tokens,
          }}
          position={position}
          onSave={handleDialogSave}
          onSaved={handleDialogSaved}
          onBlocked={handleDialogBlocked}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
