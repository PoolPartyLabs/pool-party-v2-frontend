/**
 * @id PP-CORE-LIB-054 (POO-1032, POO-1085)
 * @name gas feasibility classifier
 * @implements-rules-version v2 (POO-1085 rules v1) · v1 (POO-1032 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The chicken-and-egg, modelled explicitly.
 *
 * Before a chain can fund anything, the user must be able to pay for a transaction ON that chain.
 * A funding rail that skips this breaks silently: it offers a chain as a source, builds a plan from
 * it, and the very first broadcast fails because the wallet holds no native coin. So every candidate
 * source chain gets exactly one verdict up front:
 *
 *   OK       native covers the quoted cost of the legs this chain must run, plus headroom. Selectable.
 *   TOP_UP   native is above zero but short. A `swap-gas` step is prepended, converting a slice of a
 *            held token into native, sized from the live quote.
 *   BLOCKED  nothing can originate here. Returned WITH ITS REASON and its two escapes, never hidden.
 *
 * Two design points worth stating, because both are easy to get wrong:
 *
 *   BLOCKED IS SHOWN, NOT DROPPED ([R2]). Hiding the row makes the user's own money look like it
 *   does not exist. The UI (POO-1039) greys it and prints the reason; this function's job is to make
 *   that possible by returning a reason key alongside every verdict.
 *
 *   GAS COMES FROM THE QUOTE ([R4]). Never a constant. This retires two pieces of fiction that are
 *   still in the tree: `gasEstimateUsd: 0.5` (`src/features/manager/mapManagerStrategyDetail.ts`)
 *   and `NETWORK_FEE_USD = 0.3`, copy-pasted across five modals. `/quote` returns `gasFeeUSD` at
 *   quote time, which is exactly what the provisioning gate needs, because the gate runs BEFORE the
 *   build and the only genuine figure used to exist only after one.
 *
 *   WHAT [R4] FORBIDS IS SIZING GAS, not having a constant in the same postcode. The distinction is
 *   load-bearing rather than pedantic, because a reader who takes it as "no constant may appear near
 *   gas" reaches the wrong answer on a real question and either weakens this rule or refuses
 *   legitimate work. `onramp/config.ts` already carries the test that decides it, and it is a test
 *   about REACH, not about vocabulary: a constant is fine when it never sizes a top-up and never
 *   reaches `classifyGasFeasibility` or `buildPlan`'s GAS path.
 *
 *   POO-1499 adds two constants that pass that test, recorded here so nobody re-derives it:
 *
 *     - `BUY_ROUTE_NATIVE_RESERVE_USD` (`components/provisioning/fundingTarget.ts`, [R52]) is USD of
 *       ETH the buy route HOLDS BACK out of what it just bought, so the wallet can still sign. It is
 *       the `PAYBIS_GAS_FLOOR_ETH` shape, with one honest difference: that floor is denominated in
 *       ETH and this reserve in USD, so this one drifts against the thing it protects as the price
 *       moves. Flagged for POO-1501 rather than waved through.
 *     - the tokens route's figure is `GAS_CUSTOM_MIN_USDC_USD`, the lowest amount the USDC-funded gas
 *       control accepts (`computeNeed.ts`, locked 2026-06-30). It is a UI input bound, and
 *       deliberately NOT the Paybis floor: [R35] attaches that to the `$10 / $25` CARD set, because a
 *       swap out of a holding is not a purchase and no rail imposes a minimum on it.
 *
 *   Neither is read here, and neither sizes anything: they are inputs to how much a route must
 *   SOURCE, upstream of any gas decision. What a step actually spends on gas is still this function's
 *   answer, from the quote, everywhere. And note what does NOT make a constant acceptable: calling it
 *   something other than a cost. A reserve is still chosen by a belief about what gas costs. The
 *   question to ask is always whether it can reach a sizing decision, and here it cannot.
 *
 * Pure ([R6]): no I/O, no React, no viem, no clock. Quotes and balances are injected, so the whole
 * verdict matrix is exhaustively unit-testable offline. Chain display names and native symbols are
 * NOT resolved here: the result carries `chainId` and an i18n key, and the UI resolves both against
 * `src/lib/chains/config.ts` (POO-1041 [R3] — there is no fourth copy of the network list).
 *
 * Money convention, as pinned in `./types`: USD figures are display-grade numbers, token-native
 * amounts are decimal STRINGS. The gas-swap slice is therefore computed in BigInt base units, never
 * as a float, so a balance past `Number.MAX_SAFE_INTEGER` survives intact.
 */
import type { UniswapQuoteResponse } from "@/lib/uniswap/schemas";

/** The verdict for one candidate source chain ([R1]). Exactly one applies. */
export type GasVerdict = "OK" | "TOP_UP" | "BLOCKED";

/**
 * Proportional headroom over the quoted gas ([R5]).
 *
 * A quote is a point-in-time estimate and the transaction lands later, after a base-fee move that
 * nobody controls. 25% absorbs an ordinary spike between quote and inclusion.
 */
export const GAS_HEADROOM_RATE = 0.25;
/**
 * Absolute floor for the headroom, in USD ([R5]).
 *
 * The proportional buffer alone is useless where gas is nearly free: 25% of a $0.01 L2 swap is a
 * quarter of a cent, which leaves the wallet effectively at zero the moment anything costs more
 * than the estimate. $0.05 is roughly one further cheap-L2 transaction, so a plan that completes
 * leaves the user able to take one more step (a retry, a follow-up) instead of stranded one step
 * later. Kept small on purpose: a large floor would force a needless gas swap on a wallet that is
 * genuinely funded.
 */
export const GAS_HEADROOM_MIN_USD = 0.05;

/** i18n keys for each verdict's reason, relative to the `strategies` namespace. */
export const GAS_VERDICT_REASON_KEYS = {
  ok: "provisioning.gasVerdict.ok",
  topUp: "provisioning.gasVerdict.topUp",
  /** BLOCKED: the wallet holds no native coin at all on this chain. */
  noNative: "provisioning.gasVerdict.noNative",
  /** BLOCKED: native is short and nothing held here can be converted to cover it. */
  shortNoSource: "provisioning.gasVerdict.shortNoSource",
} as const;

/** i18n keys for the two escapes a BLOCKED chain offers ([R3]). */
export const GAS_ESCAPE_LABEL_KEYS = {
  "bridge-native": "provisioning.gasVerdict.escape.bridgeNative",
  "buy-crypto": "provisioning.gasVerdict.escape.buyCrypto",
} as const;

/**
 * Quoted gas, in USD, for the legs a plan would run ON one source chain. Every field is optional
 * because a route only runs the legs it needs: a same-chain swap has no bridge, an allowance that
 * already covers the amount has no approval.
 *
 * PP-INTEGRATION-POINT: the planner (POO-1034) fills these from live `POST /quote` responses via
 * {@link quoteGasUsd} and from `POST /check_approval`. Nothing here is ever a constant ([R4]).
 */
export interface RouteGasQuote {
  /** The ERC-20 approval to Permit2, when `/check_approval` returns calldata. */
  approvalUsd?: number;
  /** The funding swap: same-chain, or the source-side leg of a chained plan. */
  swapUsd?: number;
  /** The bridge's origin transaction. Present only on a cross-chain route. */
  bridgeUsd?: number;
  /**
   * The gas-swap's OWN cost, when we have a quote for it. Charged only to a TOP_UP chain, which by
   * definition runs one more transaction than an OK one, and which has to buy enough native to pay
   * for that transaction too.
   */
  topUpSwapUsd?: number;
}

/**
 * A non-native holding on the candidate chain that Uniswap can route into the native coin, i.e. a
 * viable gas source. Supplied by the funding inventory (POO-1031), which has already intersected the
 * wallet's holdings with `/swappable_tokens` and filtered sub-$1 dust.
 *
 * The caller supplies NON-NATIVE tokens only: swapping the native coin for itself is not a top-up.
 */
export interface GasSourceToken {
  symbol: string;
  address: string;
  decimals: number;
  /** Balance in base units, decimal STRING (never a number: precision). */
  balanceRaw: string;
  /** USD value of {@link balanceRaw} (display-grade). */
  balanceUsd: number;
}

/** One chain being considered as a funding source. */
export interface GasCandidateChain {
  chainId: number;
  /** USD value of the native coin held here. A broken read (negative / non-finite) reads as zero. */
  nativeBalanceUsd: number;
  /** Quoted gas for the legs this chain would run. */
  gas: RouteGasQuote;
  /** Non-native, routable holdings on this chain, in any order. */
  sources: readonly GasSourceToken[];
}

/** How a BLOCKED chain can be unblocked ([R3]). */
export type GasEscapeKind = "bridge-native" | "buy-crypto";

export interface GasEscape {
  kind: GasEscapeKind;
  /** i18n key, relative to the `strategies` namespace. */
  labelKey: string;
  /**
   * Only on `"bridge-native"`: the candidate chains that hold native to spare, richest first. Empty
   * when none does, which the UI renders as the unavailable escape rather than as a missing one.
   */
  fromChainIds?: number[];
}

/** The gas swap to prepend on a TOP_UP chain. */
export interface GasTopUpPlan {
  /** The holding a slice is taken from. */
  token: GasSourceToken;
  /** Base units to swap, decimal STRING. Always a slice, never the whole holding. */
  amountRaw: string;
  /** USD value of that slice (display-grade). */
  amountUsd: number;
  /** Native USD the swap must deliver: the shortfall, headroom and the swap's own gas included. */
  buyNativeUsd: number;
}

/** One chain's verdict, with everything the UI and the planner need to act on it. */
export interface GasFeasibility {
  chainId: number;
  verdict: GasVerdict;
  /** Quoted gas for this chain's legs, BEFORE headroom. Zero when nothing could be quoted. */
  quotedGasUsd: number;
  /** What the chain must actually hold: quoted + headroom (+ the top-up swap's own gas). */
  requiredGasUsd: number;
  /** `max(0, requiredGasUsd - nativeBalanceUsd)`. */
  shortfallUsd: number;
  /** `max(0, nativeBalanceUsd - requiredGasUsd)` — what this chain could spare for another one. */
  surplusUsd: number;
  /** i18n key explaining the verdict. Always present, including on BLOCKED ([R2]). */
  reasonKey: string;
  /** Present iff `verdict === "TOP_UP"`. */
  topUp?: GasTopUpPlan;
  /** Present iff `verdict === "BLOCKED"`. Always exactly two ([R3]). */
  escapes?: GasEscape[];
}

/** USD values are display-grade; round to the sixth decimal to keep float noise out of them. */
function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A USD figure we are willing to trust: finite and not negative. Anything else is discarded. */
function readUsd(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * The USD gas figure off a `/quote` response ([R4]), or `undefined` when the API did not give one.
 *
 * The top-level `gasFeeUSD` wins over the nested `gasInfo.gasFeeUSD`: both are documented, and the
 * top-level one is what the Trading API returns for the CLASSIC routes this rail broadcasts.
 * Deliberately does NOT derive USD from the wei `gasFee` field — doing that needs a native price and
 * the vendored Uniswap skill records the result of trying (~$87 shown where the true cost was ~$0.01).
 */
export function quoteGasUsd(quote: UniswapQuoteResponse): number | undefined {
  return readUsd(quote.quote.gasFeeUSD) ?? readUsd(quote.quote.gasInfo?.gasFeeUSD);
}

/**
 * A quoted cost plus its headroom ([R5]). An unquotable cost degrades to the bare floor rather than
 * to zero: we still refuse to promise a wallet with nothing can transact, but we do not invent a
 * number and we do not block a wallet that is genuinely funded (the fail-safe posture UF-20 [R6]
 * pins for a degraded read).
 */
export function withGasHeadroom(quotedUsd: number): number {
  const safe = Number.isFinite(quotedUsd) && quotedUsd > 0 ? quotedUsd : 0;
  return roundUsd(safe + Math.max(safe * GAS_HEADROOM_RATE, GAS_HEADROOM_MIN_USD));
}

/** Sum the legs we could actually price. A malformed leg is dropped, never added as NaN. */
function quotedTotalUsd(gas: RouteGasQuote, includeTopUpSwap: boolean): number {
  const legs = [gas.approvalUsd, gas.swapUsd, gas.bridgeUsd];
  if (includeTopUpSwap) legs.push(gas.topUpSwapUsd);
  return roundUsd(legs.reduce<number>((total, leg) => total + (readUsd(leg) ?? 0), 0));
}

/**
 * Take a slice of `token` worth `needUsd`, as a base-unit decimal string.
 *
 * All of the arithmetic that touches the balance is BigInt: the USD ratio is scaled to integer
 * micro-dollars and the division stays in base units, so a holding past `Number.MAX_SAFE_INTEGER`
 * (any 18-decimal token above ~9 units) is not silently rounded. The division is rounded UP by one
 * base unit when it does not divide evenly, so the slice is never a hair short of the requirement.
 *
 * Returns null when the token cannot fund the requirement on its own, which makes it not a gas
 * source: spending a holding that still leaves the wallet unable to transact costs the user the
 * holding and fixes nothing (UF-22 [R3], never present an impossible plan).
 */
function sliceForUsd(token: GasSourceToken, needUsd: number): GasTopUpPlan | null {
  const balanceUsd = readUsd(token.balanceUsd);
  if (balanceUsd === undefined || balanceUsd <= 0) return null;
  if (!/^\d+$/.test(token.balanceRaw)) return null;

  const balanceRaw = BigInt(token.balanceRaw);
  if (balanceRaw <= BigInt(0)) return null;
  // The whole holding still would not cover it → this chain cannot buy its own gas from this token.
  if (needUsd > balanceUsd) return null;

  const needMicros = BigInt(Math.round(needUsd * 1e6));
  const balanceMicros = BigInt(Math.round(balanceUsd * 1e6));
  if (needMicros <= BigInt(0) || balanceMicros <= BigInt(0)) return null;

  const scaled = balanceRaw * needMicros;
  let amountRaw = scaled / balanceMicros;
  if (amountRaw * balanceMicros < scaled) amountRaw += BigInt(1); // round up, never under-buy
  if (amountRaw <= BigInt(0)) return null; // rounds away to nothing: not a usable source
  if (amountRaw > balanceRaw) amountRaw = balanceRaw;

  return {
    token,
    amountRaw: amountRaw.toString(),
    // The intended USD of the slice. Deriving it back from `amountRaw` would mean dividing two
    // BigInts through a float, which is the precision hazard this function exists to avoid.
    amountUsd: roundUsd(needUsd),
    buyNativeUsd: roundUsd(needUsd),
  };
}

/**
 * Pick the gas source: the largest holding by USD, ties broken by symbol so the choice is
 * deterministic. Largest means the slice is the smallest fraction of a position and rides the
 * deepest liquidity.
 *
 * Deliberately single-token: the inventory (POO-1031 [R5]) filters sub-$1 dust while a gas
 * requirement is cents, so the largest holding dwarfs it in every realistic case. Aggregating
 * several tokens into one gas top-up would add a second swap per plan to solve a case that does not
 * occur; if it ever does, the chain reads BLOCKED, which is honest rather than wrong.
 */
function pickGasSource(
  sources: readonly GasSourceToken[],
  needUsd: number,
): GasTopUpPlan | undefined {
  const ranked = [...sources].sort(
    (a, b) =>
      (readUsd(b.balanceUsd) ?? 0) - (readUsd(a.balanceUsd) ?? 0) ||
      a.symbol.localeCompare(b.symbol),
  );
  for (const token of ranked) {
    const slice = sliceForUsd(token, needUsd);
    if (slice) return slice;
  }
  return undefined;
}

/** Classify one chain, without the cross-chain escape annotation (which needs the whole set). */
function classifyOne(candidate: GasCandidateChain): GasFeasibility {
  // A negative or non-finite balance is a broken read, not a balance. Reading it as zero shows the
  // chain BLOCKED with a reason ([R2]) instead of planning a route that cannot pay for itself.
  const nativeUsd = readUsd(candidate.nativeBalanceUsd) ?? 0;

  const routeQuoted = quotedTotalUsd(candidate.gas, false);
  const routeRequired = withGasHeadroom(routeQuoted);

  const base = {
    chainId: candidate.chainId,
    quotedGasUsd: routeQuoted,
    requiredGasUsd: routeRequired,
    shortfallUsd: roundUsd(Math.max(0, routeRequired - nativeUsd)),
    surplusUsd: roundUsd(Math.max(0, nativeUsd - routeRequired)),
  };

  // Exactly zero native: no transaction can originate here, full stop. Not a sizing problem, so no
  // amount of held token changes it — the wallet cannot even broadcast the swap that would fix it.
  if (nativeUsd <= 0) {
    return { ...base, verdict: "BLOCKED", reasonKey: GAS_VERDICT_REASON_KEYS.noNative };
  }

  if (nativeUsd >= routeRequired) {
    return { ...base, verdict: "OK", reasonKey: GAS_VERDICT_REASON_KEYS.ok };
  }

  // Short. A top-up is one MORE transaction on this chain, so the requirement grows by its own gas
  // before we size the swap. This cannot flip the verdict back to OK: the requirement only rises.
  const topUpQuoted = quotedTotalUsd(candidate.gas, true);
  const topUpRequired = withGasHeadroom(topUpQuoted);
  const topUp = pickGasSource(candidate.sources, roundUsd(topUpRequired - nativeUsd));

  if (!topUp) {
    return { ...base, verdict: "BLOCKED", reasonKey: GAS_VERDICT_REASON_KEYS.shortNoSource };
  }

  return {
    chainId: candidate.chainId,
    verdict: "TOP_UP",
    quotedGasUsd: topUpQuoted,
    requiredGasUsd: topUpRequired,
    shortfallUsd: roundUsd(topUpRequired - nativeUsd),
    surplusUsd: 0,
    reasonKey: GAS_VERDICT_REASON_KEYS.topUp,
    topUp,
  };
}

/**
 * Raise an already-sized gas top-up to a larger USD target (POO-1085 [F2-R2]).
 *
 * ## Why a floor rather than a free choice
 *
 * POO-1044 [R6] removed the gas selector from real mode with a good argument: the classifier sizes
 * the top-up off a live quote, and the shipped `[$10, $200]` bounds are the PAYBIS FIAT minimum,
 * which a token swap does not have. Honouring `$10` literally would spend ten dollars of someone's
 * holding to buy six cents of native coin.
 *
 * The v2 design (POO-1082 D2) puts the control back, so both facts have to hold at once. They do,
 * because they point in opposite directions: the classifier's figure is what the route COSTS, and
 * the user's choice is how much headroom they want to keep afterwards. So the choice may only ever
 * RAISE the slice. A target at or below {@link GasTopUpPlan.buyNativeUsd} is ignored, because
 * honouring it would emit a leg that cannot pay for the transaction it exists to pay for, and that
 * reverts on-chain after the user has already signed.
 *
 * ## Money
 *
 * The slice is re-derived from the one the classifier already computed, by the same ratio, entirely
 * in BigInt over integer micro-dollars: an 18-decimal holding is far past `MAX_SAFE_INTEGER` and a
 * float ratio here would silently round someone's balance. Rounded UP for the same reason
 * {@link sliceForUsd} rounds up.
 *
 * Capped by the holding, and **the cap is reported honestly**: asking for $25 out of a $10 position
 * returns $10, not $25. A figure the swap cannot deliver is exactly the fabricated number POO-799 #1
 * forbids. A malformed slice is returned untouched rather than used to derive a new one.
 */
export function raiseTopUpToUsd(topUp: GasTopUpPlan, targetUsd: number | undefined): GasTopUpPlan {
  const target = readUsd(targetUsd);
  const base = readUsd(topUp.buyNativeUsd);
  // No target, an unusable target, or one the classifier already meets: the floor stands.
  if (target === undefined || base === undefined || base <= 0 || target <= base) return topUp;
  if (!/^\d+$/.test(topUp.amountRaw) || !/^\d+$/.test(topUp.token.balanceRaw)) return topUp;

  const amountRaw = BigInt(topUp.amountRaw);
  const balanceRaw = BigInt(topUp.token.balanceRaw);
  if (amountRaw <= BigInt(0) || balanceRaw <= BigInt(0)) return topUp;

  const targetMicros = BigInt(Math.round(target * 1e6));
  const baseMicros = BigInt(Math.round(base * 1e6));
  if (baseMicros <= BigInt(0)) return topUp;

  const scaled = amountRaw * targetMicros;
  let raised = scaled / baseMicros;
  if (raised * baseMicros < scaled) raised += BigInt(1); // round up, never under-buy

  if (raised >= balanceRaw) {
    // The whole holding, and the USD says so. `balanceUsd` is the classifier's own reading of this
    // position, so no second price source can disagree with it.
    const capped = readUsd(topUp.token.balanceUsd) ?? topUp.amountUsd;
    return {
      ...topUp,
      amountRaw: balanceRaw.toString(),
      amountUsd: roundUsd(capped),
      buyNativeUsd: roundUsd(capped),
    };
  }

  return {
    ...topUp,
    amountRaw: raised.toString(),
    amountUsd: roundUsd(target),
    buyNativeUsd: roundUsd(target),
  };
}

/**
 * Classify every candidate source chain ([R1]), in input order, with none omitted ([R2]).
 *
 * Whole-set rather than per-chain because a BLOCKED chain's first escape is "send native in from a
 * chain that has some", and only the full set knows which chains those are. A chain qualifies as a
 * donor when its own verdict is OK and it has surplus beyond its own requirement: a chain that is
 * only just OK has nothing to give without stranding itself.
 */
export function classifyGasFeasibility(candidates: readonly GasCandidateChain[]): GasFeasibility[] {
  const results = candidates.map(classifyOne);

  const donors = results
    .filter((result) => result.verdict === "OK" && result.surplusUsd > 0)
    .sort((a, b) => b.surplusUsd - a.surplusUsd || a.chainId - b.chainId)
    .map((result) => result.chainId);

  return results.map((result) =>
    result.verdict === "BLOCKED"
      ? {
          ...result,
          escapes: [
            {
              kind: "bridge-native",
              labelKey: GAS_ESCAPE_LABEL_KEYS["bridge-native"],
              // A per-result copy, not the shared array: two blocked chains must not be able to
              // observe each other's mutations through a result this function called pure.
              // Never includes the blocked chain itself: it is not OK, so it is not a donor.
              fromChainIds: [...donors],
            },
            { kind: "buy-crypto", labelKey: GAS_ESCAPE_LABEL_KEYS["buy-crypto"] },
          ],
        }
      : result,
  );
}
