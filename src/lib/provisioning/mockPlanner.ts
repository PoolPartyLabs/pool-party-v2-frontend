/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name mock provisioning planner
 * @implements-rules-version v2
 *
 * Phase-0 deterministic mock of the BE provisioning planner (POO-413). Given op context + wallet
 * state (USD), it assembles the ordered {@link ProvisioningPlan} — buy-usdc → bridge → swap-gas → op,
 * including only the steps that are needed — with a realistic {@link ProvisioningQuote}. It returns
 * the EXACT shape the real planner will, so the FE (gate POO-418, modals POO-331/POO-409) builds
 * against it and flips to real at the `// PP-INTEGRATION-POINT` in {@link computePlan} with no shape
 * change.
 *
 * PP-MOCK: amounts, fees, and buffers here are plausible placeholders (Paybis ~1%, bridge ~$0.40,
 * swap ~0.25%, `input.slippagePct` (default 2%) slippage buffer, $0.15/on-chain-step gas). The real
 * planner replaces them. POO-523 R2: the gear's Max slippage rides the input, sizes the buffer, and
 * echoes on the plan for the rail (POO-414).
 */
import {
  computeProvisioningNeed,
  GAS_DEFAULT_USD,
  ONRAMP_CHAIN_ID,
  sizeOnRampUsd,
  spendableTokenUsd,
} from "./computeNeed";
import type {
  GasChoice,
  ProvisioningNeedInput,
  ProvisioningPlan,
  ProvisioningQuote,
  ProvisioningStep,
} from "./types";

/** Mock quote validity window. */
const QUOTE_TTL_MS = 60_000;
/**
 * Investor default Max slippage, percent (POO-523). Keep in sync with `DEFAULT_SLIPPAGE_PCT` in
 * `src/features/strategies/lib/slippage.ts` (not imported: lib/ must not depend on features/).
 */
const DEFAULT_SLIPPAGE_PCT = 2;

/** i18n keys for each step label (resolved by the FE across all 11 locales). */
const LABEL_KEYS = {
  "buy-usdc": "provisioning.steps.buyUsdc",
  bridge: "provisioning.steps.bridge",
  "swap-gas": "provisioning.steps.swapGas",
  "swap-token": "provisioning.steps.swapToken",
  op: "provisioning.steps.op",
} as const;

/** Minimal native-symbol map for the supported chains (mock display only). */
const NATIVE_SYMBOL: Record<number, string> = { 8453: "ETH", 42161: "ETH", 137: "POL" };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Options for {@link mockComputePlan}: the user's gas choice + an injectable clock for tests. */
export interface MockPlannerOptions {
  gas?: GasChoice;
  /** ISO timestamp to stamp the quote with (tests pass a fixed value for determinism). */
  nowIso?: string;
}

/** Assemble the mock plan from op context + wallet state. */
export function mockComputePlan(
  input: ProvisioningNeedInput,
  options: MockPlannerOptions = {},
): ProvisioningPlan {
  const quotedAt = options.nowIso ?? new Date().toISOString();
  // POO-523 R2: the settings gear's Max slippage rides the input; absent, the investor default.
  const slippagePct = input.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const need = computeProvisioningNeed({ ...input, gasChoiceUsd: options.gas?.amountUsd });

  // Always carry the op as the trailing display anchor.
  const opStep: ProvisioningStep = {
    type: "op",
    key: "op",
    labelKey: LABEL_KEYS.op,
    amountUsd: round2(input.opRequiredUsdc),
  };

  if (!need.needed) {
    return {
      needed: false,
      reason: [],
      variant: "none",
      steps: [opStep],
      quote: zeroQuote(quotedAt),
      slippagePct,
    };
  }

  const gasAmountUsd = need.needsGas ? (options.gas?.amountUsd ?? GAS_DEFAULT_USD) : 0;

  // How much USDC must be bought on-ramp: the op shortfall plus any gas funding the wallet can't cover.
  const availableUsdcForGas = Math.max(0, spendableTokenUsd(input) - input.opRequiredUsdc);
  const gasFundingShortfall = need.needsGas ? Math.max(0, gasAmountUsd - availableUsdcForGas) : 0;
  const totalToBuyUsd = round2(need.usdcShortfallUsd + gasFundingShortfall);
  const needBuyUsdc = totalToBuyUsd > 0;
  const onRampUsd = needBuyUsdc ? sizeOnRampUsd(totalToBuyUsd) : 0;

  const steps: ProvisioningStep[] = [];

  if (needBuyUsdc) {
    steps.push({
      type: "buy-usdc",
      key: "buy-usdc",
      labelKey: LABEL_KEYS["buy-usdc"],
      fromToken: "USD",
      toToken: "USDC",
      toChainId: ONRAMP_CHAIN_ID,
      amountUsd: onRampUsd,
      amountToken: onRampUsd.toFixed(2),
      poweredBy: "paybis",
    });
  }

  if (need.needsBridge) {
    const bridgedUsd = round2(input.opRequiredUsdc + (need.needsGas ? gasAmountUsd : 0));
    steps.push({
      type: "bridge",
      key: "bridge",
      labelKey: LABEL_KEYS.bridge,
      fromToken: "USDC",
      toToken: "USDC",
      fromChainId: needBuyUsdc ? ONRAMP_CHAIN_ID : input.currentChainId,
      toChainId: input.targetChainId,
      amountUsd: bridgedUsd,
      amountToken: bridgedUsd.toFixed(2),
    });
  }

  if (need.needsGas) {
    steps.push({
      type: "swap-gas",
      key: "swap-gas",
      labelKey: LABEL_KEYS["swap-gas"],
      fromToken: "USDC",
      toToken: NATIVE_SYMBOL[input.targetChainId] ?? "ETH",
      fromChainId: input.targetChainId,
      toChainId: input.targetChainId,
      amountUsd: gasAmountUsd,
    });
  }

  steps.push(opStep);

  return {
    needed: true,
    reason: need.reason,
    variant: need.variant,
    steps,
    quote: buildQuote({
      need,
      quotedAt,
      gasAmountUsd,
      needBuyUsdc,
      onRampUsd,
      slippagePct,
    }),
    gas: need.needsGas ? (options.gas ?? { presetUsd: 10, amountUsd: GAS_DEFAULT_USD }) : undefined,
    slippagePct,
  };
}

/** A zeroed quote for the satisfied (no-op) case. */
function zeroQuote(quotedAt: string): ProvisioningQuote {
  return {
    shortfallUsd: 0,
    bufferUsd: 0,
    feesUsd: 0,
    totalPayUsd: 0,
    quotedAt,
    ttlMs: QUOTE_TTL_MS,
  };
}

/** Build the realistic mock quote: `total = shortfall + buffer + fees`. */
// PP-FIXME(POO-416): the gas-funding quote (shortfallUsd / "You pay") and the plan's funded gas top-up diverge (bare gap vs funded amount). Deferred per owner; reconcile when the real planner is wired (POO-413).
function buildQuote(args: {
  need: ReturnType<typeof computeProvisioningNeed>;
  quotedAt: string;
  gasAmountUsd: number;
  needBuyUsdc: boolean;
  onRampUsd: number;
  slippagePct: number;
}): ProvisioningQuote {
  const { need, quotedAt, gasAmountUsd, needBuyUsdc, onRampUsd, slippagePct } = args;

  const shortfallUsd = round2(need.usdcShortfallUsd + need.gasShortfallUsd);

  const onChainSteps = (need.needsBridge ? 1 : 0) + (need.needsGas ? 1 : 0);
  const provisioningGasUsd = round2(onChainSteps * 0.15);
  // POO-523 R2: the slippage buffer follows the gear's Max slippage (was a hardcoded 2%).
  const bufferUsd = round2(shortfallUsd * (slippagePct / 100) + provisioningGasUsd);

  const paybisFee = needBuyUsdc ? round2(Math.max(0.99, onRampUsd * 0.01)) : 0;
  const bridgeFee = need.needsBridge ? 0.4 : 0;
  const swapFee = need.needsGas ? round2(Math.max(0.2, gasAmountUsd * 0.0025)) : 0;
  const feesUsd = round2(paybisFee + bridgeFee + swapFee);

  return {
    shortfallUsd,
    bufferUsd,
    feesUsd,
    totalPayUsd: round2(shortfallUsd + bufferUsd + feesUsd),
    quotedAt,
    ttlMs: QUOTE_TTL_MS,
  };
}

const BASE = 8453;
const ARBITRUM = 42161;

/**
 * The four canonical scenarios (+ satisfied), reused by tests, Storybook, and the gate's mock branch.
 * Inputs are in USD, matching {@link ProvisioningNeedInput}.
 */
export const SCENARIOS = {
  /** Everything present → no provisioning. */
  satisfied: {
    nativeBalanceUsd: 50,
    usdcBalanceUsd: 1_000,
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
  },
  /** Only gas missing; wallet has USDC to swap. */
  gasOnly: {
    nativeBalanceUsd: 0,
    usdcBalanceUsd: 1_000,
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 0,
    gasEstimateUsd: 0.8,
  },
  /** Only gas missing; wallet has no USDC → on-ramp first. */
  gasOnlyNoUsdc: {
    nativeBalanceUsd: 0,
    usdcBalanceUsd: 0,
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 0,
    gasEstimateUsd: 0.5,
  },
  /** Op needs more USDC, same network. */
  usdcOnly: {
    nativeBalanceUsd: 50,
    usdcBalanceUsd: 40,
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
  },
  /** Has USDC but on the wrong network → bridge. */
  usdcBridge: {
    nativeBalanceUsd: 50,
    usdcBalanceUsd: 1_000,
    currentChainId: BASE,
    targetChainId: ARBITRUM,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
  },
  /** Worst case: no USDC, wrong network, no gas. */
  usdcBridgeGas: {
    nativeBalanceUsd: 0,
    usdcBalanceUsd: 0,
    currentChainId: BASE,
    targetChainId: ARBITRUM,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
  },
} satisfies Record<string, ProvisioningNeedInput>;
