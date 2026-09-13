/**
 * @id PP-CORE-LIB-016 (POO-1024, POO-1042, POO-1044, POO-1092, POO-1095, POO-1135, POO-1155, POO-1927)
 * @name provisioning plan server actions
 * @implements-rules-version v8 (POO-1927 rules v1) · v7 (POO-1155 / POO-1129 rules v3) · v6 (POO-1135 / POO-1129 rules v3) · v5 (POO-1095 rules v1) · v4 (POO-1092 rules v1) · v3 (POO-1044 rules v1) · v2 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The server side of the provisioning planner, and the only place plan computation may touch a
 * secret or the network.
 *
 * Why this file exists. `src/lib/provisioning/index.ts` is imported by `"use client"` components, so
 * everything reachable from it ships to the browser. The real planner (POO-1034) calls the Uniswap
 * Trading API with `UNISWAP_API_KEY`, which is server-only (ADR 0003). Putting the planner directly
 * in `planner.ts` would either break the Next build on the `server-only` import, or, if the key were
 * ever given a `NEXT_PUBLIC_` prefix, silently ship a credential to every browser. Neither
 * `typecheck`, `lint`, `test` nor `i18n:check` catches that; only `pnpm build` does, plus the
 * import-graph guard in `serverBoundary.test.ts`.
 *
 * A `"use server"` module is a boundary rather than an edge: Next compiles it to an RPC stub on the
 * client, so a client component may import it freely and the implementation never reaches the bundle.
 *
 * Following the house action contract (`investActions.ts`): an action never throws across the RSC
 * boundary. It returns `{ ok: true, … } | { ok: false, code, message }`, so a failure code lands
 * where callers can act on it instead of surfacing as an opaque rejection.
 *
 * ## POO-1042: the planner is wired
 *
 * `computePlanAction` used to return a hard `PROVISIONING_PLANNER_UNAVAILABLE`, because
 * `ProvisioningNeedInput` is USD-only: it carries no token addresses and no base-unit amounts, so it
 * cannot drive a real quote. What was missing was the assembly in front of it, and that is what
 * POO-1042 adds — the live inventory plus the per-chain gas verdicts, and the user's own selection
 * order.
 *
 * **The client sends KEYS, never money.** A selection arrives as `chainId:address` strings and is
 * resolved against an inventory this action reads server-side, from the SIWE wallet. So no amount,
 * no USD figure and no wallet address a caller supplied can reach `buildPlan`: the fields simply do
 * not exist on the wire. That is stronger than validating them, because there is no check to loosen
 * later.
 *
 * ## POO-1092 / POO-1095: the requirement is accounted for in ONE place
 *
 * The USDC the wallet already holds ON the target chain must reduce what has to be routed there, and
 * `buildPlan` already does exactly that: a selected same-chain USDC source earmarks its balance with a
 * ZERO-leg route and draws down `remaining` (`buildPlan.ts` §"already the operation's asset"). This
 * action used to ALSO net that balance out of the requirement up front, so the same holding was
 * counted twice — the requirement dropped by it AND the earmark spent it against what was left. The
 * plan then under-delivered by the held balance and reported `needed: false` on an operation that ran
 * short and reverted (POO-1092). The fix keeps the earmark as the single accounting: this action
 * sends the FULL requirement and lets the engine cap `delivered` at `remaining`. That also matches the
 * picker, which already gates the CTA on covering the full `opRequiredUsdc` whenever the wallet holds
 * enough in total (`ProvisioningPanel` seeds `seedRequiredUsd(need.usdcShortfallUsd || opRequiredUsdc)`).
 *
 * With the netting gone, the CoinGecko-priced float that sized it (`source.usd`) is deleted outright,
 * so POO-1095's "size the requirement from base units at parity, not a price feed" is satisfied by
 * DELETION rather than by re-doing the arithmetic. What remains of POO-1095 is the parity conversion
 * itself: {@link toUsdcBaseUnits} now CEILs, so a requirement with sub-micro-dollar precision is never
 * sized a base unit short and an operation with a hard on-chain minimum cannot land under it after an
 * irreversible bridge.
 */
"use server";

import { parseUnits } from "viem";
import { getSessionWallet } from "@/lib/auth/session";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { isFeatureEnabled } from "@/lib/features";
import { resolveOnRampProvider } from "@/lib/onramp/onRampProvider";
// POO-1155: reused here as a WALLET RESERVE FOR SIGNING when a native coin is a funding SOURCE — the
// floor left untouched so the wallet can still sign the operation ("you cannot spend the gas you sign
// with"). This is NOT the standalone [R1] gas TRIGGER and never enters `buildPlan`'s quote-driven gas
// sizing: it only caps how much of a SELECTED native the funding swap may consume. See the marshalling
// in `computePlanAction` and the second-consumer note in `config.ts`.
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";
import { type BuildTxFailure, buildTxFailure } from "@/lib/tx/actionResult";
import { buildPlan } from "./buildPlan";
import type { ProvisioningGateContext } from "./gateContext";
import { buildProvisioningGateContext } from "./gateContext";
import type { ProvisioningNeedInput, ProvisioningPlan } from "./types";

/**
 * The plan action's result. POO-1251: the failure branch now IS `BuildTxFailure` rather than a
 * private copy of its three fields, so the correlation id the house contract carries reaches the
 * error dialog from this path too instead of being dropped at the type.
 */
export type ProvisioningPlanResult = { ok: true; plan: ProvisioningPlan } | BuildTxFailure;

/** The context action's result, same contract. */
export type ProvisioningContextResult =
  | { ok: true; context: ProvisioningGateContext }
  | BuildTxFailure;

/** USDC has 6 decimals everywhere this app operates, and is priced 1:1 with the dollar. */
const USDC_DECIMALS = 6;

/** Not signed in. Matches the shipped `SESSION_MISSING` contract in `investActions.ts`. */
const sessionMissing = {
  ok: false,
  code: "SESSION_MISSING",
  message: "Wallet session not established",
} as const;

/**
 * Everything the pre-flight gate needs to know about the signed-in wallet, for an operation on
 * `targetChainId`.
 *
 * The wallet is the session's, never the caller's — the parameter does not exist, so there is no
 * path to someone else's holdings for a future change to open. A degraded read is reported as a
 * typed failure and the gate treats it as "do not gate" ([R6]).
 */
export async function getProvisioningContextAction(
  targetChainId: number,
): Promise<ProvisioningContextResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  try {
    const context = await buildProvisioningGateContext(wallet, targetChainId);
    if (!context) {
      return {
        ok: false,
        code: "PROVISIONING_BALANCES_UNAVAILABLE",
        message: "The wallet's balances could not be read.",
      };
    }
    return { ok: true, context };
  } catch (error) {
    // POO-1251: the house mapper rather than a hand-rolled SYSTEM_INTERNAL, so a residual throw keeps
    // its machine code instead of becoming `String(error)`, and carries a correlation id if it
    // happens to be an `ApiError`. Deliberately NOT claimed as the common case: the only `apiFetch`
    // reachable from this try-block is inside `buildProvisioningGateContext`, which is catch-all
    // fail-open and returns `null` rather than throwing, and `buildPlan` catches
    // `UpstreamUnavailableError` and returns a typed failure. So what lands here is the residue, and
    // the mapper is the right shape for it precisely because nothing here can promise what it is.
    return buildTxFailure(error);
  }
}

/**
 * A USD requirement as USDC base units, rounded UP ([R2] of POO-1095).
 *
 * USDC is priced at parity everywhere this app operates, so a dollar figure IS its base-unit figure
 * times 1e6. This sizes what must LAND on the target chain, so it CEILs: flooring can size the
 * requirement a base unit short, and an operation with a hard on-chain minimum then lands under it
 * after swap and bridge fees have already been paid and a bridge has already settled irreversibly.
 * Over-asking by at most one base unit ($0.000001) is the safe direction — any surplus stays in the
 * wallet — and `buildPlan` caps what each source delivers at the requirement regardless.
 */
function toUsdcBaseUnits(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return "0";
  return BigInt(Math.ceil(amountUsd * 10 ** USDC_DECIMALS)).toString();
}

/**
 * A funding source with the native-coin signing reserve held back (POO-1155).
 *
 * When the user selects the native coin (ETH / POL) as a funding source, `NATIVE_RESERVE_ETH` of it
 * must stay in the wallet so the operation can still be signed: a swap that consumes the WHOLE native
 * balance lands the user with zero gas and strands the route it just paid to build. So the amount the
 * engine may spend is capped at `balance - floor` (never below zero); the FULL balance is still visible
 * to the gas classifier and the gas-bridge donor through `inventory`, because gas is quote-driven and
 * this reserve is a spend cap on the FUNDING leg, never a gas-cost estimate. A non-native source is
 * returned unchanged. The clone is deliberate: mutating the shared context source would also shrink the
 * gas donor's view of the same holding.
 *
 * `amount` is a base-unit integer string ({@link toBaseUnits}); the floor is converted at the token's
 * own decimals with `toFixed` so it never reaches `parseUnits` as scientific notation.
 *
 * `usd` is capped IN STEP with `amount`, and that is not cosmetic. `buildPlan` prices every spend off
 * the source it came from — `amountUsd` takes the `usd / amount` ratio of the holding (`buildPlan.ts`
 * §"priced off the holding it came from") — so a clone that keeps the FULL balance's `usd` beside a
 * capped `amount` tells the engine the reserved native is worth more per wei than it is, and the whole
 * plan (the leg's `amountInUsd`, `totalPayUsd`, the figure the confirm card shows) inherits the
 * inflation. Scaling the ratio is float, deliberately: a USD figure is display-grade throughout this
 * rail (the money convention in `computeNeed.ts`), the authoritative amount stays the base-unit string,
 * and this mirrors what `committedUsd` (`fundingSelection.ts`) already does with the same quantity on
 * the client, so the coverage total the user read and the value the engine prices agree. A
 * non-usable USD reading (NaN, infinite, non-positive) becomes `0` rather than propagating NaN into
 * the engine's arithmetic.
 */
function reserveNativeFloor(source: FundingSource): FundingSource {
  if (!source.isNative) return source;
  const floor = parseUnits(NATIVE_RESERVE_ETH.toFixed(source.decimals), source.decimals);
  const balance = BigInt(source.amount);
  const spendable = balance > floor ? balance - floor : BigInt(0);
  const usable = Number.isFinite(source.usd) && source.usd > 0;
  const usd =
    usable && balance > BigInt(0) ? (source.usd * Number(spendable)) / Number(balance) : 0;
  return { ...source, amount: spendable.toString(), usd };
}

/**
 * Compute a provisioning plan server-side.
 *
 * `selection` is the user's picks in PICK ORDER, which `buildPlan` treats as route order ([R4] of
 * POO-1034): the plan the user reviewed is the plan that executes, so this must not sort. An empty
 * selection is legitimate, not an error: a gas-only operation on a chain that must buy its own gas
 * produces a one-step plan with no funding source at all.
 *
 * Sources that cannot route to the operation's chain are dropped here as well as in the UI ([R8]).
 * The UI filter is what stops a user picking one; this is what stops a stale selection, or anything
 * that bypassed the UI, reaching a quote that would 404.
 *
 * ## `gasChoiceUsd`: POO-1044 [R6] reversed, by making it a floor (POO-1085 [F2-R1]/[F2-R2])
 *
 * This parameter did not exist, and POO-1044 [R6] argued at length that it should not: the top-up is
 * sized by the gas classifier from a live quote (the chain's shortfall, plus headroom, plus the
 * top-up transaction's own cost), and the shipped selector's `[$10, $200]` bounds are the PAYBIS
 * FIAT MINIMUM, which a token swap does not have. Honouring `$10` literally would spend ten dollars
 * of a user's holding buying native on a chain that needs six cents of it. That reasoning was right
 * and still is.
 *
 * The v2 design (POO-1082 D2) puts the control back on the step that carries gas, so both have to
 * hold. They do, because they answer different questions: the classifier says what the route COSTS,
 * the user says how much native they want to be left holding. So this is a **floor-respecting
 * ceiling raise** — `max(classifier, choice)` — and a choice below the classifier's figure is
 * ignored rather than honoured, because that leg would revert on-chain after the user signed. See
 * `raiseTopUpToUsd`.
 *
 * It is a NUMBER in USD, not the `GasChoice` object: `presetUsd` is a UI concern and means nothing
 * on this side of the boundary.
 */
export async function computePlanAction(
  input: ProvisioningNeedInput,
  selection?: readonly string[],
  gasChoiceUsd?: number,
): Promise<ProvisioningPlanResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  try {
    const context = await buildProvisioningGateContext(wallet, input.targetChainId);
    if (!context) {
      return {
        ok: false,
        code: "PROVISIONING_BALANCES_UNAVAILABLE",
        message: "The wallet's balances could not be read.",
      };
    }

    const byKey = new Map(
      context.sources.map((source) => [
        `${source.chainId}:${source.address.toLowerCase()}`,
        source,
      ]),
    );
    const picked: FundingSource[] = [];
    const seen = new Set<string>();
    for (const key of selection ?? []) {
      const source = byKey.get(key);
      // A key naming no current source is a selection that outlived its inventory (the holding was
      // spent or moved). Dropping it is right: re-deriving the plan from fresh balances is what
      // makes it safe to re-run at all. `seen` dedups by KEY because the reserved clone below is a
      // fresh object, so a reference check would let a repeated key through.
      if (!source || seen.has(key)) continue;
      // POO-1155: a source on the operation's OWN chain reaches it with NO bridge, so it is kept even
      // though `reachableChainIds` (bridge DESTINATIONS) omits its own chain in production. Mirrors
      // `reachesChain` (`fundingSelection.ts`); without this the same-chain USDC the user picked was
      // dropped here and the plan ignored the balance they were already standing on.
      const reaches =
        source.chainId === context.targetChainId ||
        source.reachableChainIds.includes(context.targetChainId);
      if (!reaches) continue;
      seen.add(key);
      picked.push(reserveNativeFloor(source));
    }

    // What must LAND on the operation's chain: the operation's FULL USDC requirement. USDC the wallet
    // already holds on the target chain is NOT netted out here — a selected same-chain USDC source is
    // earmarked by `buildPlan` with a zero-leg route and drawn down against `remaining` there, which
    // is the single place the held balance is accounted for. Netting it here as well double-counted it
    // and produced a plan that under-delivered and reported `needed: false` (POO-1092). `gasChoice`
    // does not enter here either — a gas top-up is sized by the gas classifier and emitted as its own
    // leg, not as part of the funding requirement.
    const requiredUsd = input.opRequiredUsdc;

    // POO-1927 [R3]: resolved once, forwarded below. See the field's own note on `buildPlan`'s call.
    const onRampRail = resolveOnRampProvider();

    return await buildPlan({
      targetChainId: context.targetChainId,
      requiredAmount: toUsdcBaseUnits(requiredUsd),
      requiredUsd,
      sources: picked,
      // What the user elected to SPEND is `picked`; gas is not a spend choice. A wallet holding USDC
      // and ETH on Base, funding an Arbitrum strategy from the USDC, still has ETH to send over for
      // Arbitrum's gas, and should not have to select it to make that happen (POO-1075 [R1]). Same
      // inventory the gas TOP-UP classifier already draws from.
      // Both lists: the routable inventory, plus every native holding unfiltered. The gas donor
      // must not be gated by the picker's sub-$1 dust rule, which is about what can be SPENT
      // (POO-1076). Dedup is not needed, the donor lookup takes the first match.
      inventory: [...(context.nativeHoldings ?? []), ...context.sources],
      gasByChain: context.gasByChain,
      ...(input.slippagePct === undefined ? {} : { slippagePct: input.slippagePct }),
      ...(gasChoiceUsd === undefined ? {} : { gasChoiceUsd }),
      // POO-1135: the ONE authority on whether a `buy` leg may exist. The picker reads the SAME flag
      // for `resolveFundingRoutes.onRampEnabled`, so a plan with a buy leg and the route that offers it
      // can never disagree. Off today (the crypto-only cut); Phase 6 (POO-1137) flips it per environment.
      onRampEnabled: isFeatureEnabled("fiatOnRamp"),
      /**
       * POO-1927 [R3]: WHICH rail serves that leg, for the step's display attribution.
       *
       * Threaded here rather than read inside the engine for the reason the line above is: the
       * engine stays a pure function of its request. `resolveOnRampProvider` is the server-safe half
       * of the one decision table both halves of the app resolve the rail from (`PP-CORE-LIB-105`),
       * so this cannot answer differently from the hook the panel reads for the same flags.
       *
       * `"none"` means fiat is not offered at all, which is the same condition that makes
       * `onRampEnabled` false above and emits no buy step, so it is dropped rather than forwarded:
       * `poweredBy` names a rail that served a purchase, and there is no purchase to attribute.
       */
      ...(onRampRail === "none" ? {} : { onRampRail }),
    });
  } catch (error) {
    // POO-1251: the house mapper rather than a hand-rolled SYSTEM_INTERNAL, so a residual throw keeps
    // its machine code instead of becoming `String(error)`, and carries a correlation id if it
    // happens to be an `ApiError`. Deliberately NOT claimed as the common case: the only `apiFetch`
    // reachable from this try-block is inside `buildProvisioningGateContext`, which is catch-all
    // fail-open and returns `null` rather than throwing, and `buildPlan` catches
    // `UpstreamUnavailableError` and returns a typed failure. So what lands here is the residue, and
    // the mapper is the right shape for it precisely because nothing here can promise what it is.
    return buildTxFailure(error);
  }
}
