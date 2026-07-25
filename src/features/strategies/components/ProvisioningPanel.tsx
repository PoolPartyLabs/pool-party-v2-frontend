/**
 * @id PP-CORE-CMP-046
 * @name ProvisioningPanel
 * @implements-rules-version v2 (POO-807 rules v1) · v1 (POO-1023 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The INLINE pre-flight provisioning body (epic POO-411, POO-418/POO-419). When an op is short on
 * gas / USDC / the right network, its modal swaps its confirm view for this panel (integration model
 * B, locked 2026-07-01): `confirm → provision (this panel) → pending (the op's own flow)`. The panel
 * is variant-agnostic — {@link ProvisioningPlanCard} renders whatever the plan needs (gas-only shows
 * "One quick step" + the swap-gas row with the inline gas selector; multi shows the full chain), then
 * the shared {@link WalletSteps} runs the assembled steps. On success it calls `onDone` so the host
 * resumes the ORIGINAL op with its original parameters; cancelling returns the host to its confirm.
 *
 * Surface-less by design (no Sheet/Dialog): the op modal owns the chrome. It reports `onLockChange`
 * so the host can lock dismissal while provisioning is in flight.
 *
 * POO-1023: the plan now resolves through the ONE mock/real seam via {@link useProvisioningPlan},
 * so whichever planner the toggle selects is the one that runs. It previously called
 * `mockComputePlan` directly, which meant the real planner could be wired and never called.
 *
 * PP-INTEGRATION-POINT: the planner behind the seam is still the deterministic mock (POO-420); the
 * real one lands in POO-1034 and `buildPlanSteps` runs the real rail in POO-1036. Wallet balances
 * that feed `input` are wired in POO-1042.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MockBadge } from "@/components/ui/MockBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import { spendableTokenUsd } from "@/lib/provisioning";
import type { TxError } from "@/lib/tx/diagnostics";
import { useProvisioningPlan } from "../hooks/useProvisioningPlan";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { GasAmountSelector } from "./provisioning/GasAmountSelector";
import { selectPreset, validateGas } from "./provisioning/gasSelection";
import { ProvisioningPlanCard } from "./provisioning/ProvisioningPlanCard";
import { buildPlanView } from "./provisioning/provisioningView";
import { settleOutcome, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionStatus } from "./TransactionStatus";
import { WalletSteps } from "./WalletSteps";

/** Panel phases: the assembled plan, its execution, then a recoverable error. */
type Phase = "plan" | "pending" | "error";

/** Accumulating context is unused (each step settles independently); kept generic for the runner. */
type PlanCtx = Record<string, unknown>;

/** Public props for {@link ProvisioningPanel}. */
export interface ProvisioningPanelProps {
  /** Op + wallet requirement context (USD) that drives the plan. */
  input: ProvisioningNeedInput;
  /** Op anchor title, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /** Provisioning succeeded → the host resumes the original op. */
  onDone: () => void;
  /** The user backed out → the host returns to its confirm view. */
  onCancel: () => void;
  /** Real-mode execution steps for the plan; absent → the mock settle runs (mock mode). */
  buildPlanSteps?: (plan: ProvisioningPlan) => FlowStep<PlanCtx>[];
  /** Reports whether provisioning is in flight, so the host can lock dismissal. */
  onLockChange?: (locked: boolean) => void;
}

/** The inline provisioning body embedded by an op modal's provision phase. */
export function ProvisioningPanel({
  input,
  opLabel,
  onDone,
  onCancel,
  buildPlanSteps,
  onLockChange,
}: ProvisioningPanelProps) {
  const t = useTranslations("strategies");
  const tCommon = useTranslations("common");
  const [phase, setPhase] = useState<Phase>("plan");
  const [gasChoice, setGasChoice] = useState<GasChoice | null>(null);
  const [txError, setTxError] = useState<TxError | null>(null);

  const buildPlanStepsRef = useRef(buildPlanSteps);
  buildPlanStepsRef.current = buildPlanSteps;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onLockChangeRef = useRef(onLockChange);
  onLockChangeRef.current = onLockChange;

  // The gas being edited (or the $10 default); only a VALID explicit choice resizes the plan, so an
  // empty/invalid Custom never drops the swap-gas step or re-enables the CTA (review POO-409).
  const displayGas = gasChoice ?? selectPreset(10);
  const gasValidity = validateGas(displayGas, spendableTokenUsd(input));
  const effectiveGas = gasChoice && gasValidity.ok ? gasChoice : undefined;
  // POO-1023: the plan resolves through the ONE mock/real seam (computePlan), never mockComputePlan.
  // The seam is async, so the hook owns the pending/error lifecycle and the re-plan race guard.
  const { plan, error: planError } = useProvisioningPlan(input, effectiveGas);
  const view = useMemo(() => (plan ? buildPlanView(plan) : null), [plan]);
  const hasGasStep = plan?.steps.some((step) => step.type === "swap-gas") ?? false;

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

  // Report the in-flight lock to the host (no dismissal while provisioning runs).
  useEffect(() => {
    onLockChangeRef.current?.(phase === "pending");
  }, [phase]);

  // On success → resume the op; on failure → the recoverable error state.
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") onDoneRef.current();
    else if (flow.status === "error") {
      setTxError(flow.error);
      setPhase("error");
    }
  }, [flow.status, flow.error, phase]);

  const ctaDisabled = hasGasStep && !gasValidity.ok;
  const gasSelector = hasGasStep ? (
    <GasAmountSelector
      value={displayGas}
      onChange={setGasChoice}
      balanceUsd={spendableTokenUsd(input)}
    />
  ) : undefined;

  if (phase === "pending") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-semibold text-foreground text-lg">{t("provisioning.exec.title")}</h3>
          <p className="mt-1 text-muted-foreground text-sm">{t("provisioning.exec.subtitle")}</p>
        </div>
        <WalletSteps
          steps={execLabels}
          activeStep={flow.activeStep}
          statuses={flow.statuses}
          txHashes={flow.txHashes}
        />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <TransactionStatus phase="error" title={t("flow.error.title")} body={errorBody}>
        <TransactionErrorActions
          onRetry={() => {
            setPhase("pending");
            void flow.retry();
          }}
          error={txError ?? undefined}
        />
      </TransactionStatus>
    );
  }

  // POO-1023 [R3]: the seam is async, so surface a planner failure as a recoverable error rather than
  // a plan card that never fills.
  if (planError) {
    return (
      <TransactionStatus phase="error" title={t("flow.error.title")} body={errorBody}>
        <TransactionErrorActions onRetry={onCancel} />
      </TransactionStatus>
    );
  }

  // Gate on `!view` ONLY, never on the hook's `loading`. `view` is null until the FIRST plan resolves,
  // so the skeleton still covers first load; but a re-plan (the user edits the inline gas amount) keeps
  // the PREVIOUS plan mounted while the new one resolves in the background. Gating on `loading` would
  // unmount the plan subtree on every keystroke that changes `effectiveGas`, wiping the
  // {@link GasAmountSelector} Custom field's local text and its focus, which makes multi-digit amounts
  // ($25, $100) impossible to type. {@link ProvisioningWizardModal} gates on `!view` for this reason.
  if (!view) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label={tCommon("loading")}>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground text-lg">{t(view.titleKey)}</h3>
          {/* POO-807 R1: the mock-mode indicator on the plan view (nothing in real mode). */}
          <MockBadge />
        </div>
        <p className="mt-1 text-muted-foreground text-sm">{t("provisioning.plan.subtitle")}</p>
      </div>
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
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          {t("provisioning.plan.cancel")}
        </Button>
      </div>
    </div>
  );
}
