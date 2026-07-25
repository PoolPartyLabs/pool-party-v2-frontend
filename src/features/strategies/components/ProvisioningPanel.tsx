/**
 * @id PP-CORE-CMP-046
 * @name ProvisioningPanel
 * @implements-rules-version v6 (POO-1044 rules v1) · v5 (POO-1042 rules v1) · v4 (POO-1041 rules v1) · v3 (POO-1037 rules v1) · v2 (POO-807 rules v1) · v1 (POO-1023 rules v1)
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
 * POO-1041 (hackathon POO-1022): the panel renders the REAL rail. Two things were quietly wrong for
 * a real plan, and both are fixed here. The stepper's labels came from `plan.steps` while its
 * statuses and hashes came from the rail, and the rail expands one plan step into an approval PLUS
 * the leg, so the two lists were not the same length and never had been aligned [R6]; everything is
 * matched by KEY now, through the one view model. And a bridge leg's hash exists minutes before its
 * step returns, so a running transfer had no link on screen at all: `onLegBroadcast` is consumed
 * here, the instant the hash exists, and the row is verifiable while it is still moving [R2].
 *
 * POO-1042 (hackathon POO-1022): real mode is now a different, and honest, flow. With a live
 * {@link ProvisioningGateContext} the panel opens on the funding-source picker, and only quotes a
 * plan for what the user actually chose [R7]. Two things fall out of that, both of which the picker
 * alone could not do: a holding Uniswap cannot route to the operation's chain is not offered [R8],
 * and every chain on screen carries a gas verdict [R9]. And the CTA it opens is honest twice: the
 * picker's requirement is seeded conservatively, then RE-CHECKED against the quoted plan, which is
 * the only figure that is really what the user will pay. A plan that comes back short returns to the
 * picker with the real number, so the CTA never flips from enabled to disabled underneath anyone.
 *
 * POO-1044 (hackathon POO-1022): the gas branch, made honest at both ends. A GAS-ONLY requirement
 * skips the funding picker [R1]: the gas swap is sized by the classifier and sliced off a holding
 * already on the operation's chain, so a picker would ask the user to choose between things that do
 * not change the plan. And a plan the operation cannot run is no longer offered [R3]: a chain with
 * no native coin fails the planner outright, and the panel says which network needs what, with the
 * buy-crypto escape instead of a retry that would reach the same verdict. That branch also stopped
 * discarding the planner's own error: it was rendering the FLOW's error (always null there), so
 * every planner failure showed the generic body regardless of the code the planner typed.
 *
 * Mock mode passes no context and is byte-identical to before: it opens on the plan and settles it
 * with the local mock rail, inline gas selector included [R6]/[R7].
 *
 * PP-INTEGRATION-POINT: `context` is the live wallet read (PP-CORE-LIB-057) and `buildPlanSteps` is
 * the live Uniswap rail (PP-STR-LIB-017), both bound by `useProvisioningGate` and both absent in
 * mock mode.
 */
"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { MockBadge } from "@/components/ui/MockBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { apiNetworkForChain } from "@/lib/chains/config";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import { computeProvisioningNeed, spendableTokenUsd } from "@/lib/provisioning";
// Type-only, therefore erased: `gateContext.ts` is `server-only` and this is a client component.
// The value crosses as data through `getProvisioningContextAction` (ADR 0003).
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import type { TxError } from "@/lib/tx/diagnostics";
import { toTxError } from "@/lib/tx/diagnostics";
import { formatUsd } from "@/lib/utils/format";
import { useProvisioningPlan } from "../hooks/useProvisioningPlan";
import { useProvisioningRail } from "../hooks/useProvisioningRail";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { BRIDGE_PENDING_CODE } from "../lib/awaitBridgeSettlement";
import { type PlanRailDeps, planRailSteps } from "../lib/buildPlanSteps";
import { FundingSourceSelector } from "./provisioning/FundingSourceSelector";
import { fundingProgress, reachesChain, seedRequiredUsd } from "./provisioning/fundingSelection";
import { GasAmountSelector } from "./provisioning/GasAmountSelector";
import { selectPreset, validateGas } from "./provisioning/gasSelection";
import { labelValues, ProvisioningPlanCard } from "./provisioning/ProvisioningPlanCard";
import { buildPlanView } from "./provisioning/provisioningView";
import { settleOutcome, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionStatus } from "./TransactionStatus";
import type { WalletStepStatus } from "./WalletSteps";
import { WalletSteps } from "./WalletSteps";

/**
 * Panel phases: picking what to spend, the assembled plan, its execution, a recoverable error, and
 * `settling` — a bridge that is still in flight at the rail's poll ceiling (POO-1037 [R3]).
 * `settling` is terminal for this panel but not for the money: the route is recoverable and the
 * operation is never resumed off it.
 *
 * `sources` (POO-1042) exists only in real mode, where the user's own holdings are the funding: mock
 * mode has no inventory and opens on `plan`, exactly as it always has.
 */
type Phase = "sources" | "plan" | "pending" | "settling" | "error";

/** Accumulating context is unused (each step settles independently); kept generic for the runner. */
type PlanCtx = Record<string, unknown>;

/**
 * Where the buy-crypto escape hands off when a chain cannot pay for its own gas (POO-1044 [R3]).
 * The launched deposit surface, and the same destination the cost breakdown's peer option uses.
 */
const BUY_CRYPTO_HREF = "/deposit";

/**
 * What the panel hands the rail builder, so the rail can report what the flow structurally cannot.
 *
 * `useWalletSignFlow` only records a hash a step RETURNS, and a bridge leg does not return for
 * minutes after it broadcasts. The host owns the rail's dependencies (POO-1042) while the panel owns
 * what is on screen, so the reporter travels down with the plan rather than up through a prop.
 */
export interface PlanRailReporters {
  /** POO-1037's {@link PlanRailDeps.onLegBroadcast}, called the instant a leg has a hash. */
  onLegBroadcast: NonNullable<PlanRailDeps["onLegBroadcast"]>;
}

/** Public props for {@link ProvisioningPanel}. */
export interface ProvisioningPanelProps {
  /** Op + wallet requirement context (USD) that drives the plan. */
  input: ProvisioningNeedInput;
  /**
   * The live wallet context behind the gate decision (POO-1042): what can be spent, from where, and
   * whether each chain can pay its own gas. Present only in real mode, where it turns the panel into
   * "pick what to spend, then review the route"; absent (mock mode) the panel opens on the plan and
   * behaves exactly as it did.
   *
   * PP-INTEGRATION-POINT: read server-side by `getProvisioningContextAction` (PP-CORE-LIB-057) from
   * the SIWE wallet. Type-only across the boundary — never a value import.
   */
  context?: ProvisioningGateContext | null;
  /** Op anchor title, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /** Provisioning succeeded → the host resumes the original op. */
  onDone: () => void;
  /** The user backed out → the host returns to its confirm view. */
  onCancel: () => void;
  /**
   * Override for the execution rail. Left absent in production: the panel binds the SHIPPED rail
   * itself (POO-1042 [R10], see {@link useProvisioningRail}), which is what finally retires the
   * 900 ms mock settle that ran in its place for the whole epic.
   *
   * The prop stays because the rail is the one dependency a test or a story has to be able to
   * replace: it signs and broadcasts. Bind the deps in a closure and forward `rail` into them:
   * `buildPlanSteps={(plan, rail) => buildPlanSteps(plan, { ...deps, ...rail })}`.
   */
  buildPlanSteps?: (plan: ProvisioningPlan, rail: PlanRailReporters) => FlowStep<PlanCtx>[];
  /** Reports whether provisioning is in flight, so the host can lock dismissal. */
  onLockChange?: (locked: boolean) => void;
}

/** The inline provisioning body embedded by an op modal's provision phase. */
export function ProvisioningPanel({
  input,
  context,
  opLabel,
  onDone,
  onCancel,
  buildPlanSteps,
  onLockChange,
}: ProvisioningPanelProps) {
  const t = useTranslations("strategies");
  const tCommon = useTranslations("common");

  // [R7] What to ask for BEFORE a route exists: the bare shortfall plus a conservative buffer. The
  // quoted plan is the final word (see `quotedShortfallUsd` below); this only decides when the CTA
  // may open, and it deliberately over-asks so it can never close again.
  const need = useMemo(() => computeProvisioningNeed(input), [input]);

  /**
   * POO-1044 [R1]: a gas-only requirement has nothing to pick.
   *
   * The gas swap is sized by the classifier and taken from the largest routable holding ALREADY on
   * the operation's chain, so the funding picker would be asking the user to choose between things
   * that do not change the plan, to cover a requirement of a few cents. Skipping it puts the
   * one-step "One quick step" plan on screen directly, which is the flow POO-411 designed for this
   * case and the one the six op modals already branch on.
   *
   * The verdict is `computeProvisioningNeed`'s, so it is the same pure calculator the gate used to
   * decide to open at all: the panel cannot disagree with its host about which branch this is.
   */
  const gasOnly = context !== null && context !== undefined && need.variant === "gas-only";

  // [R7] Real mode otherwise opens on the picker: the funding IS the user's own holdings, and a plan
  // they were never asked about is a route they cannot have reviewed.
  const [phase, setPhase] = useState<Phase>(context && !gasOnly ? "sources" : "plan");
  const [gasChoice, setGasChoice] = useState<GasChoice | null>(null);
  const [txError, setTxError] = useState<TxError | null>(null);
  // [R2] Hashes of legs that have broadcast but not settled, keyed by rail step key. The flow cannot
  // hold these: it records a hash a step RETURNS, and a bridge leg returns minutes later.
  const [legHashes, setLegHashes] = useState<Record<string, string>>({});
  // [R4]/[R7] The picks, in PICK ORDER, which the planner treats as ROUTE order. `selected` is what
  // the user is building; `confirmedSelection` is what they committed to, and null until they do,
  // which is what keeps the planner from quoting a route nobody asked for.
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmedSelection, setConfirmedSelection] = useState<string[] | null>(null);

  // [R10] The real rail, bound to the connected wallet. Bound HERE rather than in the gate hook: this
  // panel is the only thing that signs, and it mounts only when provisioning actually runs, so an op
  // modal never needs wallet context just to decide whether to gate. Undefined in mock mode, which is
  // what keeps the mock settle below as mock mode's behaviour.
  const boundRail = useProvisioningRail(input.slippagePct);
  const rail = buildPlanSteps ?? boundRail;

  const buildPlanStepsRef = useRef(rail);
  buildPlanStepsRef.current = rail;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onLockChangeRef = useRef(onLockChange);
  onLockChangeRef.current = onLockChange;

  // [R8] What can actually be spent on this route. The SELECTOR is told the operation's chain (it
  // cannot know it otherwise) so an unroutable holding is greyed and explained rather than hidden,
  // exactly as a BLOCKED row is; this list is the same fact applied to the arithmetic, so the
  // running total and the coverage test never count money that cannot get there.
  const spendableSources = useMemo(
    () =>
      context
        ? context.sources.filter((source) => reachesChain(source, context.targetChainId))
        : [],
    [context],
  );

  const seededRequiredUsd = seedRequiredUsd(
    need.usdcShortfallUsd || input.opRequiredUsdc,
    context?.gasEstimateUsd ?? 0,
  );

  // The gas being edited (or the $10 default); only a VALID explicit choice resizes the plan, so an
  // empty/invalid Custom never drops the swap-gas step or re-enables the CTA (review POO-409).
  const displayGas = gasChoice ?? selectPreset(10);
  const gasValidity = validateGas(displayGas, spendableTokenUsd(input));
  const effectiveGas = gasChoice && gasValidity.ok ? gasChoice : undefined;
  // POO-1023: the plan resolves through the ONE mock/real seam (computePlan), never mockComputePlan.
  // The seam is async, so the hook owns the pending/error lifecycle and the re-plan race guard.
  // POO-1042: in real mode it is suspended until the user has confirmed a selection, so the planner's
  // per-chain quote fan-out never runs for a route nobody asked for.
  // POO-1044 [R1]: a gas-only plan is not suspended on a selection, because there is no selection to
  // wait for. Everything else still is.
  const { plan, error: planError } = useProvisioningPlan(input, effectiveGas, {
    ...(confirmedSelection ? { selection: confirmedSelection } : {}),
    enabled: !context || gasOnly || confirmedSelection !== null,
  });
  const hasGasStep = plan?.steps.some((step) => step.type === "swap-gas") ?? false;

  /**
   * [R7] The re-check. The picker's CTA opened against a SEEDED requirement; the honest figure is
   * the quoted plan's own `totalPayUsd`, which only exists now. When the selection does not cover
   * it, we go back to the picker with the real number rather than showing a plan whose confirm the
   * user would be pressing on a route that strands. The CTA never flips under them: it is a
   * different screen, with its own enabled CTA and an explicit reason.
   */
  const quotedShortfallUsd =
    context && plan && confirmedSelection
      ? fundingProgress(spendableSources, confirmedSelection, plan.quote.totalPayUsd).remainingUsd
      : 0;
  const quotedPlanFallsShort = quotedShortfallUsd > 0;

  // [R6] What the rail will REALLY run: one approval per ERC-20 leg, then the leg. Only in real mode
  // — the mock settle runs the plan's own steps, and a fixture plan carries no legs to approve.
  const railSteps = useMemo(
    () => (plan && buildPlanStepsRef.current ? planRailSteps(plan) : undefined),
    [plan],
  );
  const railStepsRef = useRef(railSteps);
  railStepsRef.current = railSteps;

  // [R2] The journal seam's display half. Identity, not position: a leg's `index` is stable across
  // the plan, while its position in the rail shifts with every approval that precedes it.
  const onLegBroadcast = useCallback<PlanRailReporters["onLegBroadcast"]>((event) => {
    const key = railStepsRef.current?.find(
      (step) => step.kind === "leg" && step.leg?.index === event.leg.index,
    )?.key;
    if (!key) return;
    setLegHashes((prev) => (prev[key] === event.txHash ? prev : { ...prev, [key]: event.txHash }));
  }, []);

  const flowSteps = useMemo<FlowStep<PlanCtx>[]>(() => {
    if (!plan) return [];
    const buildReal = buildPlanStepsRef.current;
    if (buildReal) return buildReal(plan, { onLegBroadcast });
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
  }, [plan, onLegBroadcast]);
  const flow = useWalletSignFlow<PlanCtx>(flowSteps, { fallbackErrorCode: "PROVISIONING_FAILED" });

  // [R1]/[R6] The flow reports status and hashes positionally against `flowSteps`, which is the RAIL
  // order. Re-key them here, once, so every surface below reads them by step key and the two lists
  // can never drift apart again.
  const statusByKey = useMemo(() => {
    const byKey: Record<string, WalletStepStatus> = {};
    flowSteps.forEach((step, index) => {
      byKey[step.key] = flow.statuses[index] ?? "idle";
    });
    return byKey;
  }, [flowSteps, flow.statuses]);

  const txHashByKey = useMemo(() => {
    // The in-flight hashes first, so a settled step's own hash supersedes its broadcast record.
    const byKey: Record<string, string | undefined> = { ...legHashes };
    flowSteps.forEach((step, index) => {
      const hash = flow.txHashes[index];
      if (hash) byKey[step.key] = hash;
    });
    return byKey;
  }, [flowSteps, flow.txHashes, legHashes]);

  const view = useMemo(
    () => (plan ? buildPlanView(plan, { railSteps, statusByKey, txHashByKey }) : null),
    [plan, railSteps, statusByKey, txHashByKey],
  );

  const execRows = view?.rows.filter((row) => !row.isOp) ?? [];
  const execLabels = execRows.map((row) => ({
    key: row.key,
    label: t(row.labelKey, labelValues(row)),
    // An allowance and a transfer authorize very different things, and the disclosure is where a
    // user finds out which one they are being asked for (UF-28 [R4], clear-vs-blind signing).
    why:
      row.isApproval && row.tokenSymbol
        ? {
            name: t("sign.explain.approve.name"),
            body: t("sign.explain.approve.body", { token: row.tokenSymbol }),
          }
        : { name: t("sign.explain.confirm.name"), body: t("sign.explain.confirm.body") },
  }));
  const activeRow = execRows.find((row) => row.status === "active");
  /**
   * POO-1044 [R3]: the planner's failure, classified.
   *
   * `useProvisioningPlan` hands back a raw `Error`, and this panel used to render the planner branch
   * with the FLOW's `txError` (null there, always), so every planner failure showed the generic
   * "didn't go through" body and the code the planner went to the trouble of typing was discarded.
   * A blocked gas chain is exactly the failure that copy is useless for.
   */
  const planTxError = planError ? toTxError(planError, "PROVISIONING_FAILED") : null;
  // POO-461 R3: kind-aware error body (generic copy when the failure didn't classify). The flow's
  // error wins when there is one: the two branches are mutually exclusive, and a failure that
  // reached the wallet is the more specific of the two.
  const errorBody = useTxErrorBody(txError ?? planTxError);

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

  /**
   * The inline gas selector is a MOCK-mode affordance, permanently (POO-1044 [R6]).
   *
   * In real mode the top-up is sized by the gas classifier from a live quote: the chain's own
   * shortfall, plus headroom, plus the top-up transaction's cost. The control's [$10, $200] bounds
   * are the PAYBIS FIAT MINIMUM, which a token swap does not have, so honouring a typed amount would
   * spend $10 of the user's holding to buy native on a chain that needs six cents of it. There is no
   * amount for the user to choose that is better than the one the quote produces, so there is no
   * control. The bounds and presets are untouched where the control does survive ([R7]): mock mode
   * here, and the standalone buy-gas modal.
   */
  const showGasSelector = hasGasStep && !context;
  const ctaDisabled = showGasSelector && !gasValidity.ok;
  const gasSelector = showGasSelector ? (
    <GasAmountSelector
      value={displayGas}
      onChange={setGasChoice}
      balanceUsd={spendableTokenUsd(input)}
    />
  ) : undefined;

  /**
   * [R7]/[R8]/[R9] Pick what to spend. Reached in real mode only, on open and again whenever the
   * quoted plan turns out to cost more than the selection covers.
   *
   * The verdict map is passed through verbatim: it carries an entry for every source chain (the
   * gate context guarantees it), which is what makes POO-1039's "no verdict, still selectable"
   * fallback unreachable here rather than load-bearing.
   */
  if (context && !gasOnly && (phase === "sources" || quotedPlanFallsShort)) {
    return (
      <div className="flex flex-col gap-4">
        {quotedPlanFallsShort ? (
          <p
            className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
            role="status"
          >
            {t("provisioning.fundingSources.repriced", {
              amount: formatUsd(quotedShortfallUsd),
            })}
          </p>
        ) : null}
        <FundingSourceSelector
          sources={context.sources}
          gasByChainId={context.gasByChain}
          targetChainId={context.targetChainId}
          // While re-picking, the requirement is the QUOTED total: the honest figure now exists.
          requiredUsd={quotedPlanFallsShort && plan ? plan.quote.totalPayUsd : seededRequiredUsd}
          selected={selected}
          onSelectedChange={(next) => {
            setSelected(next);
            // Back to picking: a changed selection invalidates the plan that was quoted for the old
            // one, and leaving it mounted would show a route for money the user just deselected.
            setConfirmedSelection(null);
            setPhase("sources");
          }}
          onConfirm={() => {
            setConfirmedSelection(selected);
            setPhase("plan");
          }}
        />
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          {t("provisioning.plan.cancel")}
        </Button>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-semibold text-foreground text-lg">{t("provisioning.exec.title")}</h3>
          <p className="mt-1 text-muted-foreground text-sm">{t("provisioning.exec.subtitle")}</p>
        </div>
        {/* [R6] Labels, statuses and hashes all come off the SAME key-matched rows, so the stepper
            cannot light up a different step than the one the rail is running. */}
        <WalletSteps
          steps={execLabels}
          activeStep={Math.max(
            execRows.findIndex((row) => row.status === "active"),
            0,
          )}
          statuses={execRows.map((row) => row.status)}
          txHashes={execRows.map((row) => row.txHash)}
        />
        {/* [R2] The bridge row is the one step measured in minutes, so it says so while it runs. The
            figure is the quote's own `estimatedFillTimeMs`; with no estimate we admit that instead
            of inventing one. */}
        {activeRow?.eta ? (
          <p className="text-center text-muted-foreground text-sm" aria-live="polite">
            {t(activeRow.eta.key, activeRow.eta.values)}
          </p>
        ) : null}
        {/* [R2] And it is verifiable WHILE it runs, not only once we have given up on it. Before
            this, the only link a bridge ever got was in the degraded `settling` state. */}
        {activeRow?.explorerNetwork && activeRow.txHash ? (
          <ExplorerTxLink network={activeRow.explorerNetwork} hash={activeRow.txHash} />
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
  if (planTxError) {
    // POO-1044 [R3]: a chain with no native coin is not a transient failure, so it does not get the
    // retry that every other failure gets. Re-planning would ask the same classifier the same
    // question and reach the same verdict, so offering it would be theatre. What the user can
    // actually do is buy crypto, which is the second of the two escapes UF-10 attaches to a BLOCKED
    // verdict. The first, moving native in from another network, is the funding rail itself and is
    // not reachable from a chain that cannot originate a transaction.
    const blocked = planTxError.kind === "gasBlocked";
    return (
      <TransactionStatus phase="error" title={t("flow.error.title")} body={errorBody}>
        {blocked ? (
          <div className="flex w-full flex-col gap-2">
            {/* This epic writes no on-ramp code: the CTA hands off to the launched /deposit
                surface, exactly as the cost breakdown's peer option does (POO-1040 [R3]). */}
            <Link
              href={BUY_CRYPTO_HREF}
              className="flex w-full items-center justify-center rounded-md bg-primary px-6 py-3 text-center font-medium text-base text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("provisioning.costs.buyCrypto.cta")}
            </Link>
            <Button variant="ghost" className="w-full" onClick={onCancel}>
              {t("provisioning.plan.cancel")}
            </Button>
          </div>
        ) : (
          <TransactionErrorActions onRetry={onCancel} error={planTxError} />
        )}
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
