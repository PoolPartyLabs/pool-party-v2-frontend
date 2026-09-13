/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1034, POO-1166, POO-1641)
 * @name mock-mode provisioning plan fixture
 * @implements-rules-version v4 (POO-1641 rules v1) · v3 (POO-1166 / POO-1129 rules v3) · v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * **Retired as "the planner" by POO-1034.** The real one is `../buildPlan.ts`, which prices every
 * leg against the live Uniswap Trading API. This file kept its behaviour but lost its job title: it
 * is now a deterministic FIXTURE, and it lives under `fixtures/` so nobody mistakes it for the
 * engine again.
 *
 * It still exists, and still backs the mock branch of {@link computePlan}, for one structural
 * reason: `buildPlan` is `server-only` (it reaches the key-bearing Uniswap layer, ADR 0003) while
 * `planner.ts` is reachable from `"use client"` components through the module barrel. Pointing the
 * mock branch at `buildPlan` would either break the client bundle (`serverBoundary.test.ts`, and
 * `pnpm build` after it) or route mock mode through `computePlanAction`, which needs a SIWE session
 * and a real `UNISWAP_API_KEY` — and mock mode is the repo default precisely so that design and
 * component work runs offline, key-free and deterministic. A fixture is what mock mode wants.
 *
 * Given op context + wallet state (USD) it assembles the ordered {@link ProvisioningPlan} —
 * buy → bridge → swap-gas → op, only the steps that are needed — with a plausible
 * {@link ProvisioningQuote}, in the SAME shape `buildPlan` returns. It emits no
 * {@link ProvisioningStep.leg}: a fixture has no real route behind it, and inventing addresses and
 * base-unit amounts would be a plan that looks executable and is not.
 *
 * PP-MOCK: amounts, fees, and buffers here are plausible placeholders (bridge ~$0.40,
 * swap ~0.25%, `input.slippagePct` (default 2%) slippage buffer, $0.15/on-chain-step gas). Real mode
 * reads all of them off live quotes instead. POO-523 R2: the gear's Max slippage rides the input,
 * sizes the buffer, and echoes on the plan for the rail (POO-414).
 *
 * POO-1641 removed the ONE exception that list used to carry. This fixture also rendered an on-ramp
 * FEE line, `max($0.99, order x 1%)`, and it was not a placeholder like the others: it read the real
 * `ONRAMP_FEE_RATE` and claimed parity with the real planner. That fee does not exist. It is a
 * partner-side configuration already embedded in the price Paybis quotes (Rafael, 2026-08-16), and
 * nothing in `pool-party-api` collects it.
 *
 * Deleting it here matters more than deleting it from the planner, because **every design and QA
 * review of `ProvisioningCostBreakdown` happens in mock mode**: for as long as this line existed,
 * anyone who approved "the fee looks right" was approving a number that never appeared in real mode
 * either. The remaining fee terms (bridge, gas swap) are ordinary fixture placeholders again.
 */
import { stableSymbol } from "@/lib/chains/config";
import {
  computeProvisioningNeed,
  GAS_DEFAULT_USD,
  ONRAMP_CHAIN_ID,
  sizeOnRampUsd,
  spendableTokenUsd,
} from "../computeNeed";
import type {
  GasChoice,
  ProvisioningNeedInput,
  ProvisioningPlan,
  ProvisioningQuote,
  ProvisioningStep,
} from "../types";

/** Mock quote validity window. */
const QUOTE_TTL_MS = 60_000;
/**
 * Investor default Max slippage, percent (POO-523). Keep in sync with `DEFAULT_SLIPPAGE_PCT` in
 * `src/features/strategies/lib/slippage.ts` (not imported: lib/ must not depend on features/).
 */
const DEFAULT_SLIPPAGE_PCT = 2;

/** i18n keys for each step label (resolved by the FE across all 12 locales). */
const LABEL_KEYS = {
  buy: "provisioning.steps.buy",
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
  // POO-1641: the buffer and the floor size the purchase, and nothing else. The fee term that used to
  // ride along here is gone from both this fixture and the real planner, so the two still agree.
  const onRampUsd = needBuyUsdc ? sizeOnRampUsd(totalToBuyUsd) : 0;

  const steps: ProvisioningStep[] = [];

  if (needBuyUsdc) {
    steps.push({
      type: "buy",
      key: "buy",
      labelKey: LABEL_KEYS.buy,
      fromToken: "USD",
      toToken: "USDC",
      toChainId: ONRAMP_CHAIN_ID,
      amountUsd: onRampUsd,
      amountToken: onRampUsd.toFixed(2),
      poweredBy: "paybis",
      // PP-MOCK: the fiat counterpart of a leg (v6). Paybis sells on Base only, so a mock buy is
      // always `USDC-BASE`; the fiat amount pre-fills the widget and the user can change it ([R4]).
      order: {
        currencyCode: "USDC-BASE",
        fiatAmount: onRampUsd.toFixed(2),
        fiatCurrency: "USD",
      },
    });
  }

  if (need.needsBridge) {
    const bridgedUsd = round2(input.opRequiredUsdc + (need.needsGas ? gasAmountUsd : 0));
    steps.push({
      type: "bridge",
      key: "bridge",
      labelKey: LABEL_KEYS.bridge,
      fromToken: "USDC",
      // POO-1916 [R2]: the far side is the TARGET chain's own stable, the same thing the real
      // planner now emits. A "USDC" literal here made the fixture disagree with the engine on
      // Robinhood Chain (USDG), and the mock is what the panel renders in mock mode.
      toToken: stableSymbol(input.targetChainId),
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
    // POO-1641: the buy's SIZE no longer reaches the quote at all. `needBuyUsdc` and `onRampUsd` were
    // passed for one reason, the on-ramp fee line, and a fee that does not exist cannot be computed
    // from an order amount. The quote is the shortfall, the buffer and the on-chain fees now.
    quote: buildQuote({ need, quotedAt, gasAmountUsd, slippagePct }),
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
  slippagePct: number;
}): ProvisioningQuote {
  const { need, quotedAt, gasAmountUsd, slippagePct } = args;

  const shortfallUsd = round2(need.usdcShortfallUsd + need.gasShortfallUsd);

  const onChainSteps = (need.needsBridge ? 1 : 0) + (need.needsGas ? 1 : 0);
  const provisioningGasUsd = round2(onChainSteps * 0.15);
  // POO-523 R2: the slippage buffer follows the gear's Max slippage (was a hardcoded 2%).
  const bufferUsd = round2(shortfallUsd * (slippagePct / 100) + provisioningGasUsd);

  // POO-1641: there is NO on-ramp fee line. It used to be `max($0.99, order x 1%)` here, sourced from
  // a rate this app does not charge, and it is deleted rather than zeroed so it cannot come back as a
  // constant somebody edits. Paybis's own cut is still not modelled in mock mode and never was: in
  // real mode it arrives on the received-fixed quote (POO-1153), which is the only honest source for
  // it. A buy-only plan therefore ends at `feesUsd === 0`, and `ProvisioningCostBreakdown` renders no
  // fee row at all, which is the truth this screen should have been showing all along.
  const bridgeFee = need.needsBridge ? 0.4 : 0;
  const swapFee = need.needsGas ? round2(Math.max(0.2, gasAmountUsd * 0.0025)) : 0;
  const feesUsd = round2(bridgeFee + swapFee);

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
