/**
 * @id PP-CORE-LIB-018
 * @name provisioningView
 * @implements-rules-version v1
 *
 * Pure mapper from a {@link ProvisioningPlan} to the wizard's Plan-state view model (PP-CORE-MOD-011,
 * POO-409). Each step becomes a numbered row (badge = 1-based display index, NOT `step.key`) with a
 * title `labelKey`, a caption key, an optional amount, and flags for the special rows: the op anchor
 * (renders the caller's `opLabel`) and the swap-gas row (renders the inline `GasAmountSelector`).
 *
 * Amount display follows Figma: shown only when meaningful — hidden on the `bridge` row (routing, no
 * figure) and on any step whose USD value is 0 (e.g. the op anchor for collect / withdraw / close).
 * No "You pay" total is produced (fees stay abstracted, decided 2026-06-30). No React, no i18n calls
 * (returns keys + interpolation values; the component resolves `t`).
 */
import type { ProvisioningPlan, ProvisioningStepType } from "@/lib/provisioning";

/** Mock display map of supported chains → human network name (for the bridge label). */
const NETWORK_NAME: Record<number, string> = { 8453: "Base", 42161: "Arbitrum", 137: "Polygon" };

/** Caption i18n key per step type. */
const CAPTION_KEY: Partial<Record<ProvisioningStepType, string>> = {
  "buy-usdc": "provisioning.captions.buyUsdc",
  bridge: "provisioning.captions.bridge",
  "swap-gas": "provisioning.captions.swapGas",
  op: "provisioning.captions.op",
};

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
  /** Network name for the bridge row's `{network}` interpolation. */
  networkName?: string;
}

/** The Plan-state view model. */
export interface PlanView {
  /** Title i18n key (`titleGasOnly` for the gas-only variant, else `title`). */
  titleKey: string;
  rows: PlanRow[];
}

/** Map a provisioning plan to the wizard's Plan view. */
export function buildPlanView(plan: ProvisioningPlan): PlanView {
  const titleKey =
    plan.variant === "gas-only" ? "provisioning.plan.titleGasOnly" : "provisioning.plan.title";

  const rows: PlanRow[] = plan.steps.map((step, i) => {
    const isBridge = step.type === "bridge";
    const showAmount = step.amountUsd > 0 && !isBridge;
    return {
      key: step.key,
      type: step.type,
      index: i + 1,
      labelKey: step.labelKey,
      captionKey: CAPTION_KEY[step.type],
      amountUsd: showAmount ? step.amountUsd : undefined,
      poweredByPaybis: step.poweredBy === "paybis",
      isOp: step.type === "op",
      isGas: step.type === "swap-gas",
      networkName: isBridge && step.toChainId ? NETWORK_NAME[step.toChainId] : undefined,
    };
  });

  return { titleKey, rows };
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
