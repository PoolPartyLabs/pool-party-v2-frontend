/**
 * @id PP-CORE-CMP-046
 * @name ProvisioningPanel
 * @implements-rules-version v3 (POO-1037 rules v1) · v2 (POO-807 rules v1) · v1 (POO-1023 rules v1)
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
 * POO-1037 (hackathon POO-1022): a bridge leg settles on ANOTHER chain, minutes after its source
 * transaction mines, so this panel can no longer assume a step resolves in a beat. The running bridge
 * row says how long it should take [R2], the dismissal lock holds for the whole wait [R5], and a wait
 * that outlives the rail's poll ceiling lands in a fourth phase, `settling`: not a failure, not a
 * success, and deliberately WITHOUT a retry, because `flow.retry()` re-invokes the failed step
 * verbatim and a bridge already in flight would be broadcast a second time [R3].
 *
 * PP-INTEGRATION-POINT: the planner behind the seam is still the deterministic mock (POO-420); the
 * real one lands in POO-1034 and `buildPlanSteps` runs the real rail in POO-1036. Wallet balances
 * that feed `input` are wired in POO-1042.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { MockBadge } from "@/components/ui/MockBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiNetworkForChain } from "@/lib/chains/config";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import { spendableTokenUsd } from "@/lib/provisioning";
import type { TxError } from "@/lib/tx/diagnostics";
import { useProvisioningPlan } from "../hooks/useProvisioningPlan";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { BRIDGE_PENDING_CODE } from "../lib/awaitBridgeSettlement";
import { GasAmountSelector } from "./provisioning/GasAmountSelector";
import { selectPreset, validateGas } from "./provisioning/gasSelection";
import { ProvisioningPlanCard } from "./provisioning/ProvisioningPlanCard";
import { bridgeEtaCopy, buildPlanView } from "./provisioning/provisioningView";
import { settleOutcome, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionStatus } from "./TransactionStatus";
import { WalletSteps } from "./WalletSteps";

/**
 * Panel phases: the assembled plan, its execution, a recoverable error, and `settling` — a bridge
 * that is still in flight at the rail's poll ceiling (POO-1037 [R3]). `settling` is terminal for this
 * panel but not for the money: the route is recoverable and the operation is never resumed off it.
 */
type Phase = "plan" | "pending" | "settling" | "error";

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

  // Report the in-flight lock to the host (no dismissal while provisioning runs). POO-1037 [R5]: a
  // bridge leg keeps the flow in `pending` for the WHOLE settlement wait, so the lock holds for it
  // with no extra state; the ceiling moves to `settling`, which releases it precisely because the
  // user is then free to leave and come back to a recoverable route.
  useEffect(() => {
    onLockChangeRef.current?.(phase === "pending");
  }, [phase]);

  // On success → resume the op; on failure → the recoverable error state. POO-1037 [R3]: a bridge
  // still in flight at the poll ceiling is NEITHER, so it branches before the error state ever
  // renders — its copy, and above all its absent retry, are the whole point.
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") onDoneRef.current();
    else if (flow.status === "error") {
      setTxError(flow.error);
      setPhase(flow.error?.code === BRIDGE_PENDING_CODE ? "settling" : "error");
    }
  }, [flow.status, flow.error, phase]);

  // The plan step the flow is on, matched by KEY and never by index: the real rail expands one plan
  // step into an approval step plus the leg itself, so the two lists are not index-aligned.
  const activeStepKey = flowSteps[flow.activeStep]?.key;
  const activePlanStep = plan?.steps.find((step) => step.key === activeStepKey);
  const bridgeStep = activePlanStep?.type === "bridge" ? activePlanStep : undefined;

  const ctaDisabled = hasGasStep && !gasValidity.ok;
  const gasSelector = hasGasStep ? (
    <GasAmountSelector
      value={displayGas}
      onChange={setGasChoice}
      balanceUsd={spendableTokenUsd(input)}
    />
  ) : undefined;

  if (phase === "pending") {
    // [R2] The bridge row is the one step measured in minutes, so it says so while it runs. The
    // figure is the quote's own `estimatedFillTimeMs`; with no estimate we admit that instead of
    // inventing one.
    const eta = bridgeStep
      ? bridgeEtaCopy(bridgeStep.leg?.etaSeconds ?? bridgeStep.etaSeconds)
      : null;
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
        {eta ? (
          <p className="text-center text-muted-foreground text-sm" aria-live="polite">
            {t(eta.key, eta.values)}
          </p>
        ) : null}
      </div>
    );
  }

  // [R3] Still settling: the funds left, they have not landed, and we stopped watching. Never framed
  // as a failure, never as a success, and never offering the retry that would re-broadcast it. The
  // explorer link is the honest answer to "is my money actually moving": it points at the SOURCE
  // chain, which is where the transaction we hold a hash for exists.
  if (phase === "settling") {
    const sourceChainId =
      activePlanStep?.leg?.chainId ?? activePlanStep?.chainId ?? activePlanStep?.fromChainId;
    return (
      <TransactionStatus
        phase="pending"
        title={t("provisioning.bridge.settlingTitle")}
        body={t("provisioning.bridge.settlingBody")}
      >
        <ExplorerTxLink
          network={sourceChainId === undefined ? undefined : apiNetworkForChain(sourceChainId)}
          hash={txError?.txHash}
        />
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          {t("provisioning.bridge.settlingClose")}
        </Button>
      </TransactionStatus>
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
