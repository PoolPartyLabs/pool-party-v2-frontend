/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1030)
 * @name provisioning contract types
 * @implements-rules-version v3
 * @hackathon POO-1022 (Universal Funding)
 *
 * The canonical FE↔BE contract for pre-flight provisioning (epic POO-411). When an on-chain op
 * (invest / withdraw / collect / move-range / compound / close) is missing a requirement (native
 * gas, enough USDC, or funds on the wrong network), the BE planner (POO-413) returns an ordered,
 * concrete {@link ProvisioningPlan}; the FE renders it verbatim and the rail (POO-414) executes it.
 *
 * The FE mock planner (POO-420) and the real BE planner implement THESE EXACT types, so the FE flips
 * mock→real at the `// PP-INTEGRATION-POINT` seam with no shape change. This file is pinned as the
 * source of truth on POO-413; keep it identical to that comment.
 *
 * Money convention: token-native amounts are decimal STRINGS ({@link ProvisioningStep.amountToken})
 * to avoid float drift; USD figures are display-grade `number`s (estimates/quotes), matching the
 * existing `gasEstimateUsd: z.number()` in the schemas. The authoritative on-chain values are the
 * token-native strings + the BE quote, never the FE's USD arithmetic.
 *
 * POO-523 R2: the input and the plan carry an optional `slippagePct` (the settings gear's Max
 * slippage, percent, investor default 2) so the planner sizes swap buffers with it and the rail
 * (POO-414) executes with it. Mirror this field into the POO-413 contract comment.
 *
 * v3 (POO-1030, hackathon POO-1022): the Universal Funding engine executes real Uniswap Chained
 * Actions, and a step therefore has to carry where it lives inside the SERVER-HELD plan, not just
 * what to show the user. Six fields are added to {@link ProvisioningStep} — `planId`, `stepIndex`,
 * `method`, `payload`, `chainId`, `etaSeconds` — all OPTIONAL and purely additive: every existing
 * field keeps its exact meaning, so the mock planner, the view mapper and the plan card are
 * unchanged, and a v2-shaped plan is still a valid v3 plan. Mirror these into POO-413 too.
 */

import type { UniswapStepMethod } from "@/lib/uniswap/schemas";

/** The kind of a provisioning step. The plan always ends with an `"op"` display anchor. */
export type ProvisioningStepType = "buy-usdc" | "bridge" | "swap-gas" | "swap-token" | "op";

/** What is unmet — drives copy and the gas-modal vs wizard routing. */
export type ProvisioningReason = "gas" | "usdc" | "network";

/** Routing variant: `none` → sign · `gas-only` → buy-gas modal · `multi` → provisioning wizard. */
export type ProvisioningVariant = "none" | "gas-only" | "multi";

/**
 * Per-step status the rail (POO-414) emits while executing. Identical to the FE `WalletStepStatus`
 * consumed by {@link WalletSteps} (PP-CORE-MOD-006) so the FE renders it verbatim.
 */
export type ProvisioningStepStatus = "idle" | "active" | "done" | "error" | "skipped";

/** One ordered step. Its `key` maps 1:1 to a `WalletSignStep.key` / `FlowStep.key`. */
export interface ProvisioningStep {
  type: ProvisioningStepType;
  /** Stable id; maps to the WalletSteps step + the rail's per-step status. */
  key: string;
  /** i18n KEY (never raw copy) — the FE resolves it across all 11 locales. */
  labelKey: string;
  /** Source asset, e.g. `"USD"` (fiat), `"USDC"`, or a token symbol. */
  fromToken?: string;
  /** Destination asset, e.g. `"USDC"`, `"ETH"` (native), or a pool token symbol. */
  toToken?: string;
  fromChainId?: number;
  toChainId?: number;
  /** USD value moved at this step (display-grade). */
  amountUsd: number;
  /** Token-native amount as a decimal STRING (no float). */
  amountToken?: string;
  /** Provider attribution, e.g. `"paybis"` on the buy step. */
  poweredBy?: "paybis" | null;

  // --- v3, POO-1030: the step's coordinates inside the server-held Uniswap plan ------------------
  // PP-INTEGRATION-POINT: populated by the real planner (POO-1034) from `POST /plan`, and consumed
  // by the execution rail (POO-1036/POO-1037/POO-1038) to execute and to advance the plan with
  // `PATCH /plan/:planId`. Absent on a mock plan and on any same-chain `/swap` step, which is why
  // every one of them is optional rather than a breaking required field.

  /**
   * The Uniswap chained-plan id this step belongs to, **and the idempotency key for executing it**.
   *
   * A bridge takes minutes and can fail ambiguously (sent, receipt unknown), while the rail's
   * `retry()` re-invokes the failed step verbatim — which without a key is how a user bridges twice.
   * The server-held plan, addressed by this id, is the authority on what has already happened: before
   * any retry the rail re-reads `GET /plan/:planId` and resumes from the server's `currentStepIndex`,
   * never from the client's local belief, and a `PATCH` for an already-advanced step is a no-op
   * rather than a second execution. See `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.1.
   */
  planId?: string;
  /**
   * This step's index inside the plan's `steps[]`, i.e. the `stepIndex` to send back on
   * `PATCH /plan/:planId` with the proof. NOT the 1-based badge the user sees (the view mapper
   * derives that from render order) and NOT necessarily the position in {@link ProvisioningPlan.steps},
   * which also carries the trailing `op` anchor that Uniswap knows nothing about.
   */
  stepIndex?: number;
  /**
   * How the step is executed: `"SEND_TX"` broadcasts (proof = tx hash), `"SIGN_MSG"` signs EIP-712
   * typed data (proof = signature, costs no gas), `"SEND_CALLS"` is EIP-5792 batching, which is out
   * of scope for v1 and must fail legibly rather than be silently skipped.
   *
   * Typed off the Zod enum that validates the wire (`stepMethodSchema`), so the contract and the
   * validator cannot drift apart. Type-only import: erased at compile time, so this file stays
   * dependency-free at runtime and client-importable (ADR 0003 / POO-1024).
   */
  method?: UniswapStepMethod;
  /**
   * The method-specific payload (a transaction request, typed data, or a call bundle). Deliberately
   * `unknown`: the API nests it differently per method, so the rail (POO-1036) narrows it there,
   * against the method, at the moment of use. `unknown` forces that narrowing; `any` would let a
   * mis-shaped payload reach a broadcast unchecked.
   */
  payload?: unknown;
  /**
   * The chain this step EXECUTES on, which for a bridge leg is its origin. Additive, not a rename:
   * {@link fromChainId} / {@link toChainId} keep describing the value's route (and the plan card
   * still reads `toChainId` for the destination network name). This is what the rail asserts the
   * wallet against before broadcasting, so a multi-chain plan switches networks per step.
   */
  chainId?: number;
  /**
   * Expected time to settle, in seconds, when the API gives one. Bridge legs take MINUTES, which the
   * UI has to say out loud: a step that looks stuck for three minutes with no ETA reads as a failure
   * and gets a tab closed mid-route.
   */
  etaSeconds?: number;
}

/** The cost breakdown the FE shows at the top of the Plan ("You pay" = {@link totalPayUsd}). */
export interface ProvisioningQuote {
  /** The bare gap the op needs. */
  shortfallUsd: number;
  /** Slippage + the provisioning txs' own gas. */
  bufferUsd: number;
  /** Aggregate on-ramp / bridge / swap fees. */
  feesUsd: number;
  /** `= shortfallUsd + bufferUsd + feesUsd`. */
  totalPayUsd: number;
  /** ISO-8601 timestamp; the FE re-quotes after {@link ttlMs}. */
  quotedAt: string;
  /** Quote validity window in ms. */
  ttlMs: number;
}

/** The user-chosen gas top-up (from the buy-gas modal). `presetUsd: null` = a custom amount. */
export interface GasChoice {
  presetUsd: 10 | 25 | null;
  amountUsd: number;
}

/** The assembled plan the FE renders and the rail executes. */
export interface ProvisioningPlan {
  /** `false` → the op proceeds with no extra modal. */
  needed: boolean;
  /** What is missing (drives copy + routing). */
  reason: ProvisioningReason[];
  /** `none` → sign · `gas-only` → buy-gas modal · `multi` → wizard. */
  variant: ProvisioningVariant;
  /** Ordered, only-what's-needed; the LAST item is always `{ type: "op" }`. */
  steps: ProvisioningStep[];
  quote: ProvisioningQuote;
  /** Present iff a gas step exists. */
  gas?: GasChoice;
  /** The Max slippage the plan was quoted with, in percent (echoes the input; POO-523 R2). */
  slippagePct?: number;
}

/**
 * Input to the FE requirement calculator ({@link computeProvisioningNeed}). All balances are passed
 * as USD numbers — the gate (POO-418) converts raw native/USDC balances to USD before calling, so the
 * calculator stays pure number-math with no viem/bigint dependency.
 */
export interface ProvisioningNeedInput {
  /** USD value of the native coin held on {@link currentChainId}. */
  nativeBalanceUsd: number;
  /** USD value of USDC held (treated as on {@link currentChainId}). */
  usdcBalanceUsd: number;
  /** Chain where the user's funds currently are. */
  currentChainId: number;
  /** The op's target network. */
  targetChainId: number;
  /** USD the op itself consumes (0 for collect / withdraw / close, which spend no USDC). */
  opRequiredUsdc: number;
  /** Estimated gas for the op, in USD. */
  gasEstimateUsd: number;
  /** Optional user-chosen gas top-up target (from the buy-gas modal); raises the required gas. */
  gasChoiceUsd?: number;
  /**
   * Max slippage from the settings gear, in percent (POO-523 R2). The planner sizes its swap
   * buffers with it and echoes it on the plan; absent, the investor default (2) applies.
   */
  slippagePct?: number;
}

/** The calculator's verdict: what is missing, by how much, and which UI branch to take. */
export interface ProvisioningNeed {
  /** `false` → nothing missing; the op signs unchanged. */
  needed: boolean;
  needsGas: boolean;
  /** `max(0, requiredGasUsd - nativeBalanceUsd)`. */
  gasShortfallUsd: number;
  needsUsdc: boolean;
  /** `max(0, opRequiredUsdc - usdcBalanceUsd)`. */
  usdcShortfallUsd: number;
  /** The op's funds are not on its target network. */
  needsBridge: boolean;
  targetChainId: number;
  reason: ProvisioningReason[];
  variant: ProvisioningVariant;
}
