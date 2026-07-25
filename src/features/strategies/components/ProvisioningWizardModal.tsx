/**
 * @id PP-CORE-MOD-011
 * @name ProvisioningWizardModal
 * @implements-rules-version v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * The inline provisioning wizard (POO-409): when an op needs more than gas (USDC for the op, a bridge
 * to the right network, plus optional gas), this assembles the steps and runs them here, then resumes
 * the original op — no detour to Deposit. Two states: **Plan** ({@link ProvisioningPlanCard}, with the
 * gas step's amount editable inline via {@link GasAmountSelector}) and **Execution** (the shared
 * {@link WalletSteps}). Mobile renders as a {@link Sheet} bottom sheet.
 *
 * Decided 2026-06-30: gas is an inline $10/$25/Custom selector (re-plans on change); no "You pay"
 * total (fees abstracted); the op-row title is the caller's `opLabel`. Gas-only cases use the simpler
 * buy-gas modal (PP-CORE-MOD-010) instead; this handles the multi-requirement case.
 *
 * POO-523: the plan executes swaps, so the Plan phase carries the shared settings gear
 * ({@link TransactionModalHeader} + {@link TransactionSettingsDialog}) with Max slippage (0.5/1/2,
 * default 2%) + deadline (R1); the chosen slippage rides `input.slippagePct` into the planner and
 * echoes on the plan for `buildPlanSteps` (R2), and resets to the 2% default on close (R3, the
 * POO-513 policy). Fees stay abstracted (2026-06-30 decision).
 *
 * PP-INTEGRATION-POINT: the plan now resolves through the `computePlan` seam (POO-1023), so whichever
 * planner the toggle selects is the one that runs; the real planner lands behind it in POO-1034 and
 * `buildPlanSteps` runs the real rail in POO-1036. On success the host resumes the original op via
 * `onDone` with its original parameters (POO-419).
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import type { TxError } from "@/lib/tx/diagnostics";
import { useProvisioningPlan } from "../hooks/useProvisioningPlan";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { GasAmountSelector } from "./provisioning/GasAmountSelector";
import { selectPreset, validateGas } from "./provisioning/gasSelection";
import { ProvisioningPlanCard } from "./provisioning/ProvisioningPlanCard";
import { buildPlanView } from "./provisioning/provisioningView";
import { settleOutcome, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionSettingsDialog } from "./TransactionSettingsDialog";
import { TransactionStatus } from "./TransactionStatus";
import { WalletSteps } from "./WalletSteps";

/** Flow phases for the wizard (success closes + resumes the op; there is no in-wizard success view). */
type Phase = "plan" | "pending" | "error";

/** Accumulating context is unused (each step settles independently); kept generic for the runner. */
type PlanCtx = Record<string, unknown>;

/** Public props for {@link ProvisioningWizardModal}. */
export interface ProvisioningWizardModalProps {
  /** Whether the sheet is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The op + wallet requirement context that drives the plan. */
  input: ProvisioningNeedInput;
  /** Title for the op anchor row, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /** Real-mode execution steps for the assembled plan; absent → the mock settle runs. */
  buildPlanSteps?: (plan: ProvisioningPlan) => FlowStep<PlanCtx>[];
  /** Called once provisioning succeeds, so the host resumes the original op with its params. */
  onDone?: () => void;
  className?: string;
}

/** The inline provisioning wizard. */
export function ProvisioningWizardModal({
  open,
  onOpenChange,
  input,
  opLabel,
  buildPlanSteps,
  onDone,
  className,
}: ProvisioningWizardModalProps) {
  const t = useTranslations("strategies");
  const tCommon = useTranslations("common");
  const [phase, setPhase] = useState<Phase>("plan");
  const [gasChoice, setGasChoice] = useState<GasChoice | null>(null);
  const [txError, setTxError] = useState<TxError | null>(null);
  // POO-523 R1: the settings gear state — Max slippage (investor default 2%) + deadline.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_PCT);
  const [deadlineMins, setDeadlineMins] = useState(30);

  const buildPlanStepsRef = useRef(buildPlanSteps);
  buildPlanStepsRef.current = buildPlanSteps;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // The gas the user is editing (or the $10 default); validated for the CTA + the inline selector.
  const displayGas = gasChoice ?? selectPreset(10);
  const gasValidity = validateGas(displayGas, input.usdcBalanceUsd);
  // Only a VALID explicit choice resizes the plan; an empty/invalid Custom keeps the default-sized gas
  // step so it never silently drops and the inline selector stays mounted mid-edit (review POO-409).
  const effectiveGas = gasChoice && gasValidity.ok ? gasChoice : undefined;
  // POO-1023: resolved through the ONE mock/real seam (computePlan), never mockComputePlan. The
  // gear's Max slippage rides input.slippagePct into the planner and onto the plan (POO-523 R2).
  const planInput = useMemo(() => ({ ...input, slippagePct: slippage }), [input, slippage]);
  const { plan, error: planError } = useProvisioningPlan(planInput, effectiveGas);
  const view = useMemo(() => (plan ? buildPlanView(plan) : null), [plan]);
  const hasGasStep = plan?.steps.some((step) => step.type === "swap-gas") ?? false;

  // The provisioning steps (everything but the op anchor) → WalletSteps labels + the flow runners.
  const execRows = view?.rows.filter((row) => !row.isOp) ?? [];
  const execLabels = execRows.map((row) => ({
    key: row.key,
    label: t(row.labelKey, row.networkName ? { network: row.networkName } : undefined),
    why: { name: t("sign.explain.confirm.name"), body: t("sign.explain.confirm.body") },
  }));

  const flowSteps = useMemo<FlowStep<PlanCtx>[]>(() => {
    if (!plan) return [];
    const buildReal = buildPlanStepsRef.current;
    if (buildReal) return buildReal(plan);
    // PP-MOCK: settle each provisioning step after a beat (always success in mock mode).
    return plan.steps
      .filter((step) => step.type !== "op")
      .map((step) => ({
        key: step.key,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 900));
          if (settleOutcome() === "error") {
            const mockError = settleTxError();
            throw Object.assign(new Error(mockError.message), { code: mockError.code });
          }
          return { txHash: settleTxHash() };
        },
      }));
  }, [plan]);
  const flow = useWalletSignFlow<PlanCtx>(flowSteps, { fallbackErrorCode: "PROVISIONING_FAILED" });
  // POO-461 R3: kind-aware error body (generic copy when the failure didn't classify).
  const errorBody = useTxErrorBody(txError);

  // On provisioning success, hand back to the host to resume the original op; on failure, show retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally driven only by flow/phase transitions; handleOpenChange is stable for this purpose.
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      onDoneRef.current?.();
      handleOpenChange(false);
    } else if (flow.status === "error") {
      setTxError(flow.error);
      setPhase("error");
    }
  }, [flow.status, flow.error, phase]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setSettingsOpen(false);
      flow.reset();
      setTimeout(() => {
        setPhase("plan");
        setGasChoice(null);
        setTxError(null);
        // POO-523 R3: closing resets the gear to the defaults (POO-513 universal policy).
        setSlippage(DEFAULT_SLIPPAGE_PCT);
        setDeadlineMins(30);
      }, 150);
    }
  }

  const ctaDisabled = hasGasStep && !gasValidity.ok;
  const locked = phase === "pending";

  const gasSelector = hasGasStep ? (
    <GasAmountSelector
      value={displayGas}
      onChange={setGasChoice}
      balanceUsd={input.usdcBalanceUsd}
    />
  ) : undefined;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className={className}
        showClose={!locked}
        disableSwipe={locked}
        aria-describedby={undefined}
        onInteractOutside={(event) => {
          if (locked) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        {phase === "plan" && !view && planError ? (
          // POO-1023 [R3]: a planner failure is an ERROR, not loading. It renders outside the
          // role="status" skeleton (which would announce "loading" to a screen reader while the
          // planner is dead) and carries a retry affordance, same as ProvisioningPanel.
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("flow.error.title")}</SheetTitle>
            </SheetHeader>
            <TransactionStatus phase="error" title={t("flow.error.title")} body={errorBody}>
              <TransactionErrorActions onRetry={() => handleOpenChange(false)} />
            </TransactionStatus>
          </>
        ) : phase === "plan" && !view ? (
          // POO-1023 [R3]: the seam is async. Hold a skeleton rather than flashing an empty plan card
          // on FIRST load; a re-plan keeps the previous view mounted, so this never interrupts an edit.
          <div className="flex flex-col gap-4" role="status" aria-label={tCommon("loading")}>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : phase === "plan" && view ? (
          <>
            {/* POO-523 R1: the shared header carries the settings gear (left of the X). */}
            <TransactionModalHeader
              title={t(view.titleKey)}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            <p className="text-muted-foreground text-sm">{t("provisioning.plan.subtitle")}</p>
            <ProvisioningPlanCard view={view} opLabel={opLabel} gasSelector={gasSelector} />
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                size="lg"
                disabled={ctaDisabled}
                onClick={() => {
                  setPhase("pending");
                  void flow.run();
                }}
              >
                {t("provisioning.plan.cta")}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => handleOpenChange(false)}>
                {t("provisioning.plan.cancel")}
              </Button>
            </div>
          </>
        ) : null}

        {phase === "pending" ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("provisioning.exec.title")}</SheetTitle>
            </SheetHeader>
            <p className="text-muted-foreground text-sm">{t("provisioning.exec.subtitle")}</p>
            <WalletSteps
              steps={execLabels}
              activeStep={flow.activeStep}
              statuses={flow.statuses}
              txHashes={flow.txHashes}
            />
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("flow.error.title")}</SheetTitle>
            </SheetHeader>
            <TransactionStatus phase="error" title={t("flow.error.title")} body={errorBody}>
              <TransactionErrorActions
                onRetry={() => {
                  setPhase("pending");
                  void flow.retry();
                }}
                error={txError ?? undefined}
              />
            </TransactionStatus>
          </>
        ) : null}
      </SheetContent>
      {/* POO-523 R1: Max slippage (0.5/1/2, default 2%) + deadline for the plan's swaps. Fees stay
          abstracted in the plan card (2026-06-30 decision). */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
      />
    </Sheet>
  );
}
