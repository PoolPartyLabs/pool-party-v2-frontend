/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1030, POO-1033, POO-1034, POO-1131, POO-1927)
 * @name provisioning contract types
 * @implements-rules-version v7 (POO-1927 rules v1) · v6 (POO-1131 / POO-1129 rules v3)
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
 * v7 (POO-1927, epic POO-1793 Privy on-ramp): {@link ProvisioningStep.poweredBy} stops being typed
 * `"paybis" | null` and carries {@link OnRampAttribution}, so it can name the rail that actually
 * served. A field that cannot express its own answer is a field that is wrong again the next time a
 * rail changes, and this one credited Paybis on every fiat leg including ones Privy brokers through
 * Stripe or MoonPay. Widening, not replacing: `"paybis"` stays expressible, so every existing plan,
 * fixture and builder is still valid. Mirror this into the POO-413 contract comment.
 *
 * v6 (POO-1131, epic POO-1129 Paybis on-ramp): the fiat step type `"buy-usdc"` becomes `"buy"`,
 * carrying its delivered asset in `toToken` / `toChainId` like every other step, so [R1]'s ETH and
 * USDC branches share one step shape rather than baking the asset into the type name. A step may also
 * carry {@link ProvisioningOrder}, the fiat counterpart of {@link ProvisioningLeg}. Additive and
 * optional; deliberately NO `requestId` and NO `quoteId` on the plan ([R8]): both are minted at
 * execution time (a 5-minute signature window + a quote TTL), so a plan built minutes earlier must not
 * embed one.
 *
 * v5 (POO-1034, hackathon POO-1022): a step may carry {@link ProvisioningLeg}, the execution-grade
 * detail of the route leg behind it (token ADDRESSES, base-unit amounts, the route class, the quoted
 * gas). The display fields describe the leg to a human; the leg describes it to a machine, and the
 * rail (POO-1036) and the recovery journal (POO-1038) both need the machine version. Additive and
 * optional: a mock plan carries no legs and is still a valid v5 plan.
 *
 * v4 (POO-1033, hackathon POO-1022): {@link ProvisioningNeedInput} gains {@link ChainBalancesUsd}
 * per chain and the scalar `nativeBalanceUsd` / `usdcBalanceUsd` pair becomes optional. A wallet is
 * not one balance on one chain; modelling it that way is what made "can this be funded by bridging"
 * unanswerable for every operation that spends no USDC. Additive: a scalar-shaped input still
 * type-checks and still computes the same verdict.
 *
 * v3 (POO-1030, hackathon POO-1022): the Universal Funding engine executes real Uniswap Chained
 * Actions, and a step therefore has to carry where it lives inside the SERVER-HELD plan, not just
 * what to show the user. Six fields are added to {@link ProvisioningStep} — `planId`, `stepIndex`,
 * `method`, `payload`, `chainId`, `etaSeconds` — all OPTIONAL and purely additive: every existing
 * field keeps its exact meaning, so the mock planner, the view mapper and the plan card are
 * unchanged, and a v2-shaped plan is still a valid v3 plan. Mirror these into POO-413 too.
 */

import type { OnRampRail } from "@/lib/onramp/onRampProvider";
import type { UniswapRouting, UniswapStepMethod } from "@/lib/uniswap/schemas";

/**
 * Which rail served a fiat purchase, for DISPLAY ATTRIBUTION only (POO-1927 [R3]).
 *
 * Spelled as `Exclude<OnRampRail, "none">` rather than as a second literal union so it cannot drift
 * from {@link OnRampRail}, the one decision table both halves of the app already resolve the rail
 * from (`PP-CORE-LIB-105`). A field that cannot express the rail actually serving is a field that is
 * wrong again the next time a rail changes, which is how this one came to credit Paybis for a charge
 * Privy brokers through Stripe or MoonPay.
 *
 * `"none"` is excluded because it means fiat is not offered at all, and a plan with no fiat rail has
 * no `buy` step to attribute. The import is type-only, so nothing about the flag registry reaches a
 * consumer of this contract at runtime, and `onRampProvider.ts` is separately pinned client-loadable
 * by `src/lib/onramp/serverBoundary.test.ts`.
 */
export type OnRampAttribution = Exclude<OnRampRail, "none">;

/**
 * How a chain's native coin is addressed, by the Trading API, by the funding inventory and by the
 * planner alike.
 *
 * It lives on the CONTRACT rather than beside the planner because both sides of the boundary compare
 * against it: `buildPlan` (server-only) to build a native leg, and the execution rail (client) to know
 * a leg needs no ERC-20 approval. A second copy of a magic address is how the two drift apart.
 */
export const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * The kind of a provisioning step. The plan always ends with an `"op"` display anchor.
 *
 * `"buy"` (v6, was `"buy-usdc"`) is a fiat on-ramp STEP the rail executes; the asset it delivers is
 * data (`toToken` / `toChainId`), not part of the type name, which is what lets [R1]'s gas-first ETH
 * buy and its USDC buy share one shape. Do not confuse it with `FundingRouteKind`'s `"buy"`
 * (`fundingRoutes.ts`), which names a funding ROUTE the picker offers, not a plan step: different
 * types, both real, kept separate on purpose (POO-1089 naming collision).
 */
export type ProvisioningStepType =
  | "buy"
  | "bridge"
  | "bridge-gas"
  | "swap-gas"
  | "swap-token"
  | "op";

/**
 * The route kinds the planner (POO-1034) can emit. The `op` anchor and the fiat `buy` are not legs.
 *
 * `"bridge-gas"` is a bridge like `"bridge"` is, but it carries the chain's NATIVE coin rather than
 * the operation's asset, and it exists to make the target chain transactable at all (POO-1075). It
 * is kept a distinct kind rather than folded into `"bridge"` because three things treat it
 * differently: it never needs an ERC-20 approval, it is not funding and so must not count toward the
 * requirement, and it carries an ordering constraint the funding legs do not ([R4]).
 */
export type ProvisioningLegKind = "swap-token" | "bridge" | "swap-gas" | "bridge-gas";

/**
 * Whether a leg kind crosses chains. BOTH bridge kinds do; neither swap kind ever does.
 *
 * It exists because `bridge-gas` was added by widening the union, and widening a union only makes
 * the compiler speak up at sites typed as an exhaustive `Record` or `switch`. Six sites instead
 * compared the runtime string (`leg.kind === "bridge"`), which `tsc` cannot see, and every one of
 * them silently mishandled the new kind: the cost model charged it a fictional slippage line, the
 * recovery reconciler marked it settled without checking it arrived, the plan card failed to render
 * its row, and the rail wrote a settlement it had not verified.
 *
 * So: never compare a leg kind to `"bridge"` directly. Ask this, or ask the leg itself whether its
 * `tokenOut.chainId` differs from its `chainId`, which is the same question about a concrete leg.
 */
export function isBridgeLegKind(kind: ProvisioningLegKind): boolean {
  return kind === "bridge" || kind === "bridge-gas";
}

/** One end of a leg, identified precisely enough to quote, approve and broadcast against. */
export interface ProvisioningLegToken {
  /** Contract address. {@link NATIVE_TOKEN_ADDRESS} (`0x0…0`) for the chain's native coin. */
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
}

/**
 * The executable half of a provisioning step (v5, POO-1034).
 *
 * {@link ProvisioningStep}'s display fields carry SYMBOLS and USD, which is what a person needs.
 * Executing needs addresses, base units and a route class, and so does the recovery journal
 * (`02_BRIDGE_ARCHITECTURE.md` §3.3), which records intent per leg before a broadcast.
 *
 * **Deliberately carries no quote object and no calldata.** Every leg is RE-quoted at execution time
 * from the balance the previous leg actually produced ([R8]), so a stored quote is at best dead
 * weight and at worst something a future author broadcasts. §3.3 pins the same rule for the journal.
 */
export interface ProvisioningLeg {
  /** Position in the route, which is execution order. */
  index: number;
  kind: ProvisioningLegKind;
  /** The chain this leg BROADCASTS on. For a bridge that is its origin, not its destination. */
  chainId: number;
  tokenIn: ProvisioningLegToken;
  /** For a bridge leg, `tokenOut.chainId` is the destination chain. */
  tokenOut: ProvisioningLegToken;
  /** Base units in, decimal STRING. Exact for the first leg of a route; an estimate after that. */
  amountIn: string;
  /** Base units out AS QUOTED, decimal string. Always an estimate: prices and fills move. */
  amountOutQuoted: string;
  /**
   * The floor the leg must deliver, base units, decimal string. AMM legs shave the slippage
   * allowance off {@link amountOutQuoted}; a bridge leg does NOT, because Across quotes it and
   * slippage does not govern it (`02_BRIDGE_ARCHITECTURE.md` §1.4). Also the arrival test for a
   * bridge (§3.6): destination balance delta ≥ this.
   */
  minAmountOut: string;
  /** How Uniswap classified the route. `CLASSIC` same-chain, `BRIDGE` cross-chain same-token. */
  routing: UniswapRouting;
  /** This leg's own gas, USD, FROM THE QUOTE ([R5]). Zero when the API returned no figure. */
  gasUsd: number;
  /** AMM price impact, percent, when the quote reported one. Absent on a bridge leg. */
  priceImpactPct?: number;
  /** Bridge legs: `quote.estimatedFillTimeMs`, in seconds. Never an invented constant. */
  etaSeconds?: number;
  /**
   * TRUE when {@link amountIn} came from the PREVIOUS leg's quoted output rather than from a balance
   * that already exists ([R8]). Such a leg must be re-sized at execution time from the real
   * post-settlement balance: a bridge never delivers exactly its quoted amount, and a quote expires
   * long before one settles anyway.
   */
  requoteAtExecution: boolean;
}

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
  /** i18n KEY (never raw copy) — the FE resolves it across all 12 locales. */
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
  /**
   * Which rail serves this step's fiat purchase, present on the `buy` step and nowhere else
   * (POO-1927 [R3]).
   *
   * Its presence is what marks a leg as attributable at all; its VALUE says which rail. Derived
   * from the flags by whoever builds the plan, never a literal: see {@link OnRampAttribution}.
   */
  poweredBy?: OnRampAttribution | null;

  // --- v3, POO-1030: the step's coordinates inside the server-held Uniswap plan ------------------
  // PP-INTEGRATION-POINT: populated by the real planner (POO-1034) from `POST /plan`, and consumed
  // by the execution rail (POO-1036/POO-1037/POO-1038) to execute and to advance the plan with
  // `PATCH /plan/:planId`. Absent on a mock plan and on any same-chain `/swap` step, which is why
  // every one of them is optional rather than a breaking required field.

  /**
   * The Uniswap chained-plan id this step belongs to. **Never populated today.**
   *
   * This field was designed around Chained Actions, where `planId` would be the idempotency key: the
   * server-held plan would be the authority on what had already happened, and a `PATCH` for an
   * already-advanced step would be a no-op rather than a second execution.
   *
   * POO-1093: that never shipped, and this comment used to describe it as though it had. `CHAINED`
   * routing never returned live, so `POST /plan`, `GET /plan/:planId` and `PATCH /plan/:planId` were
   * never built. `src/lib/uniswap/actions.ts` calls only `quote`, `check_approval`, `swap` and
   * `swappable_tokens`. A reviewer trusting the old wording would have concluded the retry path was
   * already protected, which is exactly the mistake that let the double-broadcast defect sit.
   *
   * What actually guards a retry is the CLIENT journal: `broadcast()` in `buildPlanSteps.ts` reads
   * `journal.legStatus(index)` and refuses to send again for a leg already on chain. That is a
   * weaker guarantee than a server-side plan (it is per-browser), and `POO-1100` tracks mirroring it
   * server-side. See `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.
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

  // --- v5, POO-1034: the executable half of the step ---------------------------------------------
  /**
   * The route leg this step executes (v5). Present on every step the real planner emits except the
   * trailing `op` anchor, which is a display marker and not a leg. Absent on a mock plan.
   */
  leg?: ProvisioningLeg;

  // --- v6, POO-1131: the fiat half of a `buy` step -----------------------------------------------
  /**
   * The on-ramp order this step places (v6). The fiat counterpart of {@link leg}: `leg` describes an
   * on-chain leg to the rail, `order` describes a fiat purchase to the Paybis widget. Present only on
   * a `"buy"` step. Unlike {@link leg}, the mock plan DOES carry a plausible `order`, because an
   * order holds no execution-grade material (no `requestId`, no `quoteId`, see
   * {@link ProvisioningOrder}) and mock realism wants the widget pre-fill to look real; `leg` stays
   * absent on mock plans.
   */
  order?: ProvisioningOrder;
}

/**
 * The fiat half of a `"buy"` step (v6, POO-1131): what to pre-fill the Paybis widget with.
 *
 * **Deliberately carries no `requestId` and no `quoteId` ([R8]).** A `requestId` carries a 5-minute
 * signature-replay window and a quote a TTL, both minted at EXECUTION time, so a plan assembled
 * minutes earlier must not embed one, exactly as {@link ProvisioningLeg} holds no quote. The amount
 * here only PRE-FILLS: the user can change it inside the widget, so the authoritative figure is the
 * observed post-settlement balance delta ([R4]), never this number.
 */
export interface ProvisioningOrder {
  /** Paybis crypto currency code, e.g. `"USDC-BASE"` / `"ETH-BASE"` (Paybis sells on Base only). */
  currencyCode: string;
  /** Fiat amount to pre-fill, decimal STRING (no float), in {@link fiatCurrency}. */
  fiatAmount: string;
  /** ISO-4217 fiat code, e.g. `"USD"`. */
  fiatCurrency: string;
  /**
   * v7, POO-1573 [R1]: how to build the ETH-BASE leg's RECEIVED-FIXED target. Present only on an
   * `"ETH-BASE"` order; a `"USDC-BASE"` order is already received-fixed against its own
   * {@link fiatAmount} (USDC is ~1:1 with USD). See {@link OnRampEthTarget}.
   */
  ethTarget?: OnRampEthTarget;
}

/**
 * The recipe for an `ETH-BASE` order's received-fixed target (v7, POO-1573 [R1]/[R3]).
 *
 * A recipe rather than an amount, for the same reason this type carries no `quoteId` ([R8]): the ETH
 * figure needs an ETH PRICE, a price is perishable, and a plan executes for minutes. So the sizer
 * emits what it has and the MINT solves `gasFloorEth + fundingUsd / ethUsd` seconds before the widget
 * opens, with a price read server-side (`src/lib/onramp/ethTarget.ts`).
 *
 * The two halves are in DIFFERENT UNITS on purpose, and that is the fix: the standalone gas floor is
 * natively an ETH quantity, and pricing it through the planner's balance ratio (`native.usd /
 * native.amount`) yields exactly 0 for a wallet holding no ETH, i.e. the only wallet the gas-first
 * leg ever serves. Keeping it in ETH removes the dependency instead of patching it.
 *
 * [R2]: every USD term (`PAYBIS_MIN_USD`, the classifier's gas) has already been applied to
 * {@link fundingUsd}. Nothing downstream re-denominates a USD figure. POO-1641 removed one of the
 * terms that used to be on this list, the caller's 1% fee gross-up, because we do not charge it.
 */
export interface OnRampEthTarget {
  /**
   * The ETH-denominated gas component, decimal STRING (up to 18dp, so never a float). `"0"` in-flow,
   * where the classifier's gas figure is USD and therefore lives in {@link fundingUsd}.
   */
  gasFloorEth: string;
  /** The USD half to convert at mint, decimal STRING, already floored (POO-1641 removed the
   * gross-up: there is no Pool Party fee to cover, so nothing is added on top of the floor). */
  fundingUsd: string;
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

/**
 * The user-chosen gas top-up. `presetUsd: null` = a custom amount.
 *
 * POO-1084 [F1-R4] widened the preset allowlist to include `5`: the `$10` floor is the PAYBIS FIAT
 * minimum, and gas paid by swapping USDC the wallet already holds is not a fiat purchase, so it does
 * not inherit that floor. Which presets are OFFERED is decided per funding source by `gasPresets()`;
 * this union is only the set of values that can legally appear.
 */
export interface GasChoice {
  presetUsd: 5 | 10 | 25 | null;
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
 * What the wallet holds on ONE chain, in USD (v4, POO-1033). The split is not cosmetic: the native
 * coin is the only asset that can pay for a transaction on its own chain, and no other chain's
 * native coin can substitute for it. Everything else is inventory that a swap or a bridge can move.
 */
export interface ChainBalancesUsd {
  /** USD value of this chain's NATIVE coin (ETH / POL). Pays gas here, and nowhere else. */
  nativeUsd: number;
  /**
   * USD value of the routable non-native tokens held here (USDC and anything Uniswap can route,
   * per POO-1031's inventory). This is what a swap turns into gas, or a bridge moves to the op's
   * chain.
   */
  tokenUsd: number;
}

/**
 * Input to the FE requirement calculator ({@link computeProvisioningNeed}). All balances are passed
 * as USD numbers — the gate (POO-418) converts raw native/USDC balances to USD before calling, so the
 * calculator stays pure number-math with no viem/bigint dependency.
 */
export interface ProvisioningNeedInput {
  /**
   * The wallet, chain by chain (v4, POO-1033). This is the authority when present: it is the only
   * shape that can say WHERE the money is, which is what decides whether a shortfall is a buy, a
   * local swap, or a bridge.
   *
   * PP-INTEGRATION-POINT: assembled by the live gate (POO-1042) from the funding inventory
   * (POO-1031, `fetchWalletHoldings` ∩ `/swappable_tokens`). Absent, the calculator falls back to
   * the legacy scalar pair below.
   */
  balancesByChain?: Readonly<Record<number, ChainBalancesUsd>>;
  /**
   * LEGACY (pre-POO-1033), superseded by {@link balancesByChain}: USD value of the native coin, with
   * no chain attached. Optional so a migrated caller does not have to invent a scalar it no longer
   * believes in.
   */
  nativeBalanceUsd?: number;
  /** LEGACY (pre-POO-1033), superseded by {@link balancesByChain}: USD value of USDC held. */
  usdcBalanceUsd?: number;
  /** Chain the wallet is connected to. Only the legacy shape needs it to place its scalars. */
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
  /** `max(0, requiredGasUsd - native held on the target chain)`. */
  gasShortfallUsd: number;
  needsUsdc: boolean;
  /** `max(0, opRequiredUsdc - routable token value held anywhere)`: what has to be BOUGHT. */
  usdcShortfallUsd: number;
  /**
   * The requirement (USDC or gas) cannot be met on the target chain but can be met from another
   * one, so the plan has to move value across chains (v4, POO-1033 R2 — no longer conditional on
   * the op spending USDC).
   */
  needsBridge: boolean;
  targetChainId: number;
  reason: ProvisioningReason[];
  variant: ProvisioningVariant;
}
