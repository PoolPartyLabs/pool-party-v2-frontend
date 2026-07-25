/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name provisioning module barrel
 * @implements-rules-version v1
 *
 * Pre-flight provisioning (epic POO-411): the FE detects unmet op requirements, provisions exactly
 * what is missing (buy USDC → bridge → swap to gas), and resumes the original op. This barrel exposes
 * the contract types, the pure calculator, and the planner seam. Mock-first; flips to the BE planner
 * (POO-413) / rail (POO-414) at the `// PP-INTEGRATION-POINT` in {@link computePlan}.
 */

export {
  clampGasUsd,
  computeProvisioningNeed,
  GAS_CUSTOM_MAX_USD,
  GAS_CUSTOM_MIN_USD,
  GAS_DEFAULT_USD,
  GAS_PRESETS_USD,
  PAYBIS_MIN_USD,
  sizeOnRampUsd,
} from "./computeNeed";
export type {
  GasCandidateChain,
  GasEscape,
  GasEscapeKind,
  GasFeasibility,
  GasSourceToken,
  GasTopUpPlan,
  GasVerdict,
  RouteGasQuote,
} from "./gasFeasibility";
export {
  classifyGasFeasibility,
  GAS_ESCAPE_LABEL_KEYS,
  GAS_HEADROOM_MIN_USD,
  GAS_HEADROOM_RATE,
  GAS_VERDICT_REASON_KEYS,
  quoteGasUsd,
  withGasHeadroom,
} from "./gasFeasibility";
export { mockComputePlan, SCENARIOS } from "./mockPlanner";
export { computePlan } from "./planner";
export type {
  GasChoice,
  ProvisioningNeed,
  ProvisioningNeedInput,
  ProvisioningPlan,
  ProvisioningQuote,
  ProvisioningReason,
  ProvisioningStep,
  ProvisioningStepStatus,
  ProvisioningStepType,
  ProvisioningVariant,
} from "./types";
