/**
 * @id PP-CORE-LIB-018
 * @name provisioningView
 * @implements-rules-version v2 (POO-1041 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Pure mapper from a {@link ProvisioningPlan} to the wizard's Plan-state view model (PP-CORE-MOD-011,
 * POO-409). Each step becomes a numbered row (badge = 1-based display index, NOT `step.key`) with a
 * title `labelKey`, a caption key, an optional amount, and flags for the special rows: the op anchor
 * (renders the caller's `opLabel`) and the swap-gas row (renders the inline `GasAmountSelector`).
 *
 * No "You pay" total is produced (fees stay abstracted, decided 2026-06-30). No React, no i18n calls:
 * every row carries KEYS plus the values to interpolate into them, and the component resolves `t`
 * (POO-1041 [R5]).
 *
 * ## v2, POO-1041: the same rows describe what will REALLY run
 *
 * A mock plan is a list of display steps. A real plan is a route, and the two differ in ways the user
 * signs for:
 *
 * - **The rail expands a step into two.** Every ERC-20 leg needs its allowance granted first, so
 *   `buildPlanSteps` (POO-1036) emits an approval step the plan itself does not contain. Passing
 *   {@link PlanViewOptions.railSteps} folds those rows in, so the card lists what the wallet will
 *   actually be asked for instead of a shorter, prettier fiction. It also means `plan.steps[i]` and
 *   rail step `i` are different steps, which is why status and hashes here are matched by KEY and
 *   never by position ([R6]).
 * - **The route has real figures.** A bridge row carries the quote's own ETA ([R2]) and, once a real
 *   quote priced the leg, its USD amount. The mock-era rule that a bridge row shows no amount
 *   survives only where it is still true: a fixture plan has no leg, so there is no figure to show.
 * - **A broadcast leg is verifiable.** Once a hash exists the row carries it plus the API network of
 *   the chain it was broadcast on, which is all {@link ExplorerTxLink} needs. No hash, or a chain
 *   this app does not support, means NO link rather than an explorer home page ([R4]).
 *
 * Network names come from `src/lib/chains/config.ts` ([R3]). The local literal map this file used to
 * hold is gone: it was one of several copies in the repository, and the drift it invites is silent
 * (a chain added to the config renders with a hole where its name should be).
 */
import { apiNetworkForChain, chainDisplayName } from "@/lib/chains/config";
import type {
  ProvisioningPlan,
  ProvisioningStep,
  ProvisioningStepStatus,
  ProvisioningStepType,
} from "@/lib/provisioning";
import type { PlanRailStep } from "../../lib/buildPlanSteps";

/** Caption i18n key per step type. */
const CAPTION_KEY: Partial<Record<ProvisioningStepType, string>> = {
  "buy-usdc": "provisioning.captions.buyUsdc",
  bridge: "provisioning.captions.bridge",
  "swap-gas": "provisioning.captions.swapGas",
  op: "provisioning.captions.op",
};

/** The allowance row's title, reusing the wallet stepper's shipped copy rather than a second key. */
const APPROVE_LABEL_KEY = "sign.steps.approve";

/** One row of the Plan card. */
export interface PlanRow {
  key: string;
  type: ProvisioningStepType;
  /** 1-based badge number shown to the user. */
  index: number;
  /** Title i18n key (the op row ignores this and renders the caller's `opLabel`). */
  labelKey: string;
  /** Caption i18n key, if any. */
  captionKey?: string;
  /** USD amount to show, or `undefined` to omit the amount slot. */
  amountUsd?: number;
  /** Whether to render the "Powered by Paybis" inline badge in the caption. */
  poweredByPaybis: boolean;
  /** The trailing op anchor — renders `opLabel` + the op amount. */
  isOp: boolean;
  /** The gas step — renders the inline `GasAmountSelector`. */
  isGas: boolean;
  /** A rail-only allowance row, which the plan itself does not contain ([R6]). */
  isApproval: boolean;
  /** Network name for the `{network}` interpolation, from the chain config ([R3]). */
  networkName?: string;
  /** Token symbol for the `{token}` interpolation (`Swap to USDC`, `Approve WETH`). */
  tokenSymbol?: string;
  /** Execution status from the rail; `idle` until the rail says otherwise ([R1]). */
  status: ProvisioningStepStatus;
  /** The broadcast hash, once this step has one ([R2]). */
  txHash?: string;
  /** API network slug of the chain {@link txHash} was broadcast on; absent → no link ([R4]). */
  explorerNetwork?: string;
  /** Bridge rows only: how long the leg says it will take ([R2]). */
  eta?: BridgeEtaCopy;
}

/** The Plan-state view model. */
export interface PlanView {
  /** Title i18n key (`titleGasOnly` for the gas-only variant, else `title`). */
  titleKey: string;
  rows: PlanRow[];
}

/** What the rail knows that the plan does not. All of it optional: mock mode passes none of it. */
export interface PlanViewOptions {
  /**
   * The steps that will actually run, in execution order ({@link planRailSteps}). Folds the rail's
   * approval rows in; absent, the plan's own steps drive the rows exactly as before.
   */
  railSteps?: readonly PlanRailStep[];
  /** Per-step execution status, keyed by step key ([R1], [R6]). */
  statusByKey?: Readonly<Record<string, ProvisioningStepStatus | undefined>>;
  /** Per-step broadcast hash, keyed by step key ([R2], [R6]). */
  txHashByKey?: Readonly<Record<string, string | undefined>>;
}

/** Map a provisioning plan to the wizard's Plan view. */
export function buildPlanView(plan: ProvisioningPlan, options: PlanViewOptions = {}): PlanView {
  const titleKey =
    plan.variant === "gas-only" ? "provisioning.plan.titleGasOnly" : "provisioning.plan.title";

  // The rail's approval steps, indexed by the plan step each one precedes. Built once: a plan is
  // short, but a lookup per row keeps the walk below linear and the ordering obvious.
  const approvals = new Map<string, Extract<PlanRailStep, { kind: "approve" }>>();
  for (const railStep of options.railSteps ?? []) {
    if (railStep.kind === "approve") approvals.set(railStep.planStep.key, railStep);
  }

  const rows: PlanRow[] = [];
  for (const step of plan.steps) {
    const approval = approvals.get(step.key);
    if (approval) rows.push(approvalRow(approval, rows.length + 1, options));
    rows.push(stepRow(step, rows.length + 1, options));
  }

  return { titleKey, rows };
}

/** The allowance the rail grants before a leg. It moves nothing, so it is priced at nothing. */
function approvalRow(
  railStep: Extract<PlanRailStep, { kind: "approve" }>,
  index: number,
  options: PlanViewOptions,
): PlanRow {
  const { leg } = railStep;
  return {
    key: railStep.key,
    // The plan step it belongs to, so a caller can still group the pair. The `isApproval` flag is
    // what decides behaviour: a `swap-gas` approval must NOT render the inline gas selector.
    type: railStep.planStep.type,
    index,
    labelKey: APPROVE_LABEL_KEY,
    captionKey: "provisioning.captions.approve",
    poweredByPaybis: false,
    isOp: false,
    isGas: false,
    isApproval: true,
    tokenSymbol: leg.tokenIn.symbol,
    ...execution(railStep.key, leg.chainId, options),
  };
}

/** One of the plan's own steps. */
function stepRow(step: ProvisioningStep, index: number, options: PlanViewOptions): PlanRow {
  const isBridge = step.type === "bridge";
  const leg = step.leg;
  // Amount display follows Figma: shown only when meaningful — hidden on a step whose USD value is 0
  // (the op anchor for collect / withdraw / close), and on a bridge row that no real quote priced.
  // A real leg means a real figure, so [R2] shows it.
  const showAmount = step.amountUsd > 0 && (!isBridge || leg !== undefined);
  return {
    key: step.key,
    type: step.type,
    index,
    labelKey: step.labelKey,
    captionKey: CAPTION_KEY[step.type],
    ...(showAmount ? { amountUsd: step.amountUsd } : {}),
    poweredByPaybis: step.poweredBy === "paybis",
    isOp: step.type === "op",
    isGas: step.type === "swap-gas",
    isApproval: false,
    // The DESTINATION for a bridge ("Move to Arbitrum"); `leg.chainId` would be its origin.
    ...(isBridge ? nameOf(chainDisplayName(step.toChainId)) : {}),
    // `Swap to {token}` names what the user ends up holding.
    ...(step.toToken === undefined ? {} : { tokenSymbol: step.toToken }),
    ...(isBridge ? { eta: bridgeEtaCopy(leg?.etaSeconds ?? step.etaSeconds) } : {}),
    ...execution(step.key, leg?.chainId ?? step.chainId ?? step.fromChainId, options),
  };
}

/** `{ networkName }` when there is one, nothing when there is not (never `networkName: undefined`). */
function nameOf(networkName: string | undefined): { networkName?: string } {
  return networkName === undefined ? {} : { networkName };
}

/**
 * The rail's view of a step: where it got to, and whether it can be verified on-chain yet.
 *
 * The explorer network is resolved ONLY alongside a hash. Without one there is nothing to link to,
 * so naming a network would be state the row cannot use, and the additivity of the v3 contract
 * fields (POO-1030 [R2]) would break for every mock plan that happens to carry a `chainId`.
 */
function execution(
  key: string,
  chainId: number | undefined,
  options: PlanViewOptions,
): { status: ProvisioningStepStatus; txHash?: string; explorerNetwork?: string } {
  const status = options.statusByKey?.[key] ?? "idle";
  const txHash = options.txHashByKey?.[key];
  if (!txHash) return { status };
  const explorerNetwork = chainId === undefined ? undefined : apiNetworkForChain(chainId);
  return {
    status,
    txHash,
    ...(explorerNetwork === undefined ? {} : { explorerNetwork }),
  };
}

/** A resolved copy key plus its interpolation values. No `t` call, per this module's contract. */
export interface BridgeEtaCopy {
  key: string;
  values?: Record<string, number>;
}

/**
 * How long the bridge leg says it will take (POO-1037 [R2]).
 *
 * The figure is the quote's own `estimatedFillTimeMs` (carried as {@link ProvisioningLeg.etaSeconds}),
 * never an invented constant: a step that looks stuck for three minutes with no ETA reads as a
 * failure and gets a tab closed mid-route. When the quote gave no estimate we say so rather than
 * guessing, because a promise of "about 30 seconds" that we cannot keep is worse than no number.
 */
export function bridgeEtaCopy(etaSeconds: number | undefined): BridgeEtaCopy {
  if (etaSeconds === undefined || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return { key: "provisioning.bridge.etaUnknown" };
  }
  // Under 90s reads naturally in seconds; above it, "about 2 minutes" beats "about 118 seconds".
  if (etaSeconds < 90) {
    return {
      key: "provisioning.bridge.etaSeconds",
      values: { seconds: Math.max(1, Math.round(etaSeconds)) },
    };
  }
  return {
    key: "provisioning.bridge.etaMinutes",
    values: { minutes: Math.max(1, Math.round(etaSeconds / 60)) },
  };
}
