/**
 * @id PP-STR-CMP-023 (POO-1039, POO-1155)
 * @name funding selection helpers
 * @implements-rules-version v5 (POO-1812 rules v1: the seed reads the slippage it absorbs) · v4 (POO-1499 rules v1) · v3 (POO-1155 / POO-1129 rules v3) · v1 (POO-1039 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The pure half of {@link FundingSourceSelector}: identity, selectability, ordering and the running
 * total. Split out for the same reason `gasSelection.ts` is: the arithmetic a CTA gates on should be
 * exhaustively testable without mounting a component.
 *
 * ## POO-1155: same-chain reachability and the native-coin signing reserve
 *
 * Two corrections the "Choose tokens" screen shipped without. {@link reachesChain} now short-circuits
 * a same-chain holding BEFORE consulting the routability list, because Uniswap `listSwappableTokens`
 * returns bridge DESTINATIONS and excludes the source chain, so a holding on the operation's OWN chain
 * (the one that needs no bridge at all) was being greyed out. And the native coin is treated as a
 * wallet reserve for signing ({@link belowGasFloor} / {@link committedUsd}): at or below the floor it
 * cannot be selected, and above it only the excess counts, because you cannot spend the gas you sign
 * with. All three readers of the floor (here, {@link committedUsd} and `reserveNativeFloor` on the
 * server) treat the AT-floor balance the same way, so a row can never be selectable and worth nothing.
 *
 * ## Money
 *
 * USD figures on a {@link FundingSource} are display-grade numbers, and a running total made of them
 * is exactly where float drift becomes visible: `100 + 1.27 + 0.1` is `101.36999999999999` in
 * IEEE-754, and a total that reads a cent under the requirement while the CTA says it is covered is
 * indistinguishable from a bug in the price. So the sum is accumulated as INTEGER micro-dollars, the
 * same unit the cost model uses, and only rounded on the way out.
 *
 * Two roundings are deliberately asymmetric, because rounding is not neutral when a person is being
 * told how much money is missing:
 *
 *   - a REMAINING shortfall rounds UP, so a sub-cent gap never reads `$0.00 still to go` beside a
 *     CTA that refuses to open;
 *   - a SURPLUS rounds DOWN, so we never show the user a cent of headroom they do not have.
 *
 * The authoritative amounts are still the base-unit strings on each source. Nothing here is used to
 * size a transaction; it drives a progress line and a disabled attribute.
 */

// Type-only, and therefore erased at compile time: `fundingInventory.ts` is `server-only` and this
// module is imported by a `"use client"` component. Never turn this into a value import (ADR 0003).
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasVerdict } from "@/lib/provisioning";
// POO-1155: `NATIVE_RESERVE_ETH` is reused here as a WALLET RESERVE FOR SIGNING — the native balance
// left untouched so the user can still sign the operation. This is NOT the standalone [R1] gas TRIGGER
// (which decides when a buy also buys gas): it never sizes a purchase and never reaches
// `classifyGasFeasibility`. `nativeReserve.ts` documents this second, legitimate consumer at its
// definition.
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";

/** Micro-dollars per USD. Integer accumulation unit, so sub-cent figures survive being summed. */
const MICROS = 1_000_000;

/**
 * A USD figure as integer micro-dollars. A NaN, infinite or negative reading contributes nothing.
 *
 * Exported as the ONE rounding kernel for funding money: `fundingTarget.ts` imports this (and
 * {@link ceilToUsd}) rather than redefining them, for the same reason it aliases
 * `SEED_BUFFER_RATE`: two implementations of one conversion is how a row and a meter start
 * disagreeing about the same cent.
 */
export function toMicros(usd: number | undefined): number {
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? Math.round(usd * MICROS) : 0;
}

/** Micro-dollars to USD, rounded to the nearest cent. */
function toUsd(micros: number): number {
  return Math.round(micros / 10_000) / 100;
}

/**
 * Micro-dollars to USD, rounded UP to the cent. Used for a shortfall: never understate it.
 * Exported for `fundingTarget.ts`; see {@link toMicros} for why the kernel lives once.
 */
export function ceilToUsd(micros: number): number {
  return Math.ceil(micros / 10_000) / 100;
}

/** Micro-dollars to USD, rounded DOWN to the cent. Used for a surplus: never overstate it. */
function floorToUsd(micros: number): number {
  return Math.floor(micros / 10_000) / 100;
}

/**
 * The stable identity of a funding source: its chain and its contract address, lowercased.
 *
 * Address case is not identity (EIP-55 checksums differ per source), and the same token on two
 * chains is two different pieces of money. Mirrors the `chainId:address` key the cost model groups
 * by, so a selection and a cost row name the same thing.
 */
export function fundingSourceKey(source: Pick<FundingSource, "chainId" | "address">): string {
  return `${source.chainId}:${source.address.toLowerCase()}`;
}

/**
 * Can a chain with this gas verdict be spent from? [R3]
 *
 * BLOCKED cannot: no transaction can originate on a chain the wallet cannot pay gas on, so selecting
 * it would build a plan whose first broadcast fails. TOP_UP can, because the planner prepends the gas
 * swap that fixes it (POO-1034 [R3]).
 *
 * An ABSENT verdict reads as selectable, not as blocked. A chain we failed to classify is not a chain
 * we know is broken, and the fail-safe posture this epic pins for a degraded read (UF-20 [R6]) is
 * that it must never hide a user who is genuinely funded. `buildPlan` is the authoritative second
 * gate: it refuses to plan from a BLOCKED chain regardless of what the UI allowed.
 */
export function isSelectableVerdict(verdict: GasVerdict | undefined): boolean {
  return verdict !== "BLOCKED";
}

/**
 * Can this holding reach the operation's chain? (POO-1042 [R8])
 *
 * `reachableChainIds` has been on the inventory since POO-1031 and nothing consulted it, because the
 * SELECTOR does not know which chain the operation runs on. The gate host does, so the check belongs
 * at that layer, and it belongs BEFORE the pick: a token Uniswap routes nowhere near the target
 * produces a 404 at quote time, after the user chose it and read a running total that counted it.
 *
 * POO-1155: SAME-CHAIN wins before the list is even consulted. `reachableChainIds` is derived from
 * Uniswap `listSwappableTokens`, which returns bridge DESTINATIONS and EXCLUDES the token's own chain
 * (`fundingInventory.ts`), verified live on dev (`USDC on 42161 -> [137, 8453]`). So a holding on the
 * operation's OWN chain arrives with the target ABSENT from its reachable set, and testing membership
 * greyed out the one holding that needs no bridge at all. Same-chain is always reachable — it executes
 * with no bridge whatsoever — regardless of what the destination list says.
 *
 * With same-chain handled, an empty set can only be a CROSS-CHAIN holding whose routability lookup
 * degraded, and that is not offered: there the missing fact is the whole question.
 */
export function reachesChain(
  source: Pick<FundingSource, "chainId" | "reachableChainIds">,
  targetChainId: number,
): boolean {
  if (source.chainId === targetChainId) return true;
  const reachable = source.reachableChainIds ?? [];
  if (reachable.length === 0) return false;
  return reachable.includes(targetChainId);
}

/**
 * The native balance of a source, in whole coin units (ETH / POL), as a display-grade number
 * (POO-1155).
 *
 * Read from the base-unit string the inventory carries. This drives a disabled attribute and a
 * progress line, never a transaction, so float division is fine: the authoritative amount stays the
 * base-unit string, and `buildPlan` re-derives the reserve in base units on the server.
 */
function nativeBalance(source: Pick<FundingSource, "amount" | "decimals">): number {
  const raw = Number(source.amount);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw / 10 ** source.decimals;
}

/**
 * Is this the native coin, held below the signing reserve? (POO-1155)
 *
 * A native balance at or under `NATIVE_RESERVE_ETH` is what the wallet needs just to sign the
 * operation, so spending it would strand the user mid-route ("you cannot spend the gas you sign
 * with"). Such a row is not selectable, on ANY chain — it is greyed and EXPLAINED rather than dropped,
 * the same way a BLOCKED or unreachable row is. Never applies to a non-native token: only the native
 * coin pays for signing.
 *
 * The AT-floor case is refused (`<=`, not `<`) so the three places that read this floor agree on the
 * boundary. {@link committedUsd} commits nothing at `balance <= floor` and `reserveNativeFloor`
 * (`planActions.ts`) caps the spendable amount to zero there, so a strict `<` here would leave an
 * exactly-at-floor native SELECTABLE while contributing `$0.00` to the running total and zero base
 * units to the plan: a row that ticks and changes nothing, which reads as a broken control rather than
 * as a reserve. One comparison, one meaning.
 *
 * This is the {@link NATIVE_RESERVE_ETH} wallet-reserve use, not its standalone [R1] gas trigger: it
 * gates SELECTION, never a gas purchase.
 */
export function belowGasFloor(
  source: Pick<FundingSource, "isNative" | "amount" | "decimals">,
): boolean {
  return source.isNative === true && nativeBalance(source) <= NATIVE_RESERVE_ETH;
}

/**
 * The USD a source commits toward coverage when selected (POO-1155).
 *
 * A non-native holding commits its whole value. The native coin commits only the EXCESS above the
 * signing reserve, proportionally: `usd * (balance - floor) / balance`, so `0.0055 ETH` with a
 * `0.001` floor commits roughly `0.0045` worth, never the whole balance. At or below the floor it
 * commits nothing (it is not selectable either). A broken USD reading commits nothing rather than
 * `NaN`, which would poison the running total.
 */
export function committedUsd(
  source: Pick<FundingSource, "isNative" | "amount" | "decimals" | "usd">,
): number {
  if (!(typeof source.usd === "number" && Number.isFinite(source.usd) && source.usd > 0)) return 0;
  if (!source.isNative) return source.usd;
  const balance = nativeBalance(source);
  if (balance <= NATIVE_RESERVE_ETH) return 0;
  return source.usd * ((balance - NATIVE_RESERVE_ETH) / balance);
}

/**
 * The holdings that can actually be spent towards an operation on `targetChainId`.
 *
 * Three tests, in one place (POO-1086 [F3-R4], POO-1155): the chain has to be able to pay its own gas
 * ({@link isSelectableVerdict}), the holding has to be able to get there ({@link reachesChain}), and a
 * native coin has to be above the signing reserve ({@link belowGasFloor}). Extracted because three
 * things ask the same question and must not drift: the picker's "Convert everything", the running
 * total, and `resolveFundingRoutes`. A "select all" that picks a row the CTA then refuses is worse
 * than no button at all.
 *
 * Order is preserved: the inventory arrives most-valuable-first, and selection order is route order.
 */
export function spendableSources<
  T extends Pick<
    FundingSource,
    "chainId" | "reachableChainIds" | "isNative" | "amount" | "decimals"
  >,
>(
  sources: readonly T[],
  gasByChainId: Readonly<Record<number, { verdict: GasVerdict }>>,
  targetChainId?: number,
): T[] {
  return sources.filter(
    (source) =>
      isSelectableVerdict(gasByChainId[source.chainId]?.verdict) &&
      !belowGasFloor(source) &&
      (targetChainId === undefined || reachesChain(source, targetChainId)),
  );
}

/** What {@link fillToTarget} would pick, and what picking it commits. */
export interface FundingFill {
  /** The source keys to select, biggest first, which is also route order [R4]. */
  keys: string[];
  /** The USD those keys COMMIT, which is what the shortcut prints [R16]. */
  usd: number;
}

/**
 * What `Convert what's needed` selects: biggest holding first, stopping the moment the target is
 * covered (POO-1502 [R15]).
 *
 * The button used to be `Convert everything`, and the rename is the behaviour change. That name is
 * false the moment holdings exceed the target, and the behaviour behind it converted money the
 * operation had no use for: every conversion is a real swap with a real fee, so selecting a $500
 * holding AND two smaller ones to cover $215.25 costs the user two swaps they did not need.
 *
 * Three properties worth stating, because each is a decision rather than an implementation detail:
 *
 * - It fills from {@link spendableSources}, the SAME predicate that decides which rows the list
 *   renders ([R11]), so the shortcut can never pick a row the user cannot see.
 * - It accumulates {@link committedUsd}, never `source.usd`. A native coin contributes only its
 *   excess over the signing reserve, so a fill can never spend the gas the wallet needs to sign.
 * - A fill that CANNOT reach the target still takes everything it can, rather than returning empty.
 *   The on-ramp buys the remainder (POO-1155), so a short fill is the most useful thing the button
 *   can do; a button that did nothing because it could not finish would just look broken.
 *
 * {@link FundingFill.usd} is the sum of what is actually picked, which can OVERSHOOT the target.
 * [R16] writes the amount as `min(spendable, sourceTarget)`, and that formula is only right when the
 * holdings happen to cover the target exactly; its own sentence, "the amount is what clicking it
 * will select", is the part that generalises. Printing the target instead would promise a precision
 * whole-source selection (POO-1082 D1) does not deliver.
 */
export function fillToTarget(
  sources: readonly FundingSource[],
  gasByChainId: Readonly<Record<number, { verdict: GasVerdict }>>,
  requiredUsd: number,
  targetChainId?: number,
): FundingFill {
  const target = toMicros(requiredUsd);
  const spendable = spendableSources(sources, gasByChainId, targetChainId)
    .map((source) => ({ key: fundingSourceKey(source), micros: toMicros(committedUsd(source)) }))
    .filter((entry) => entry.micros > 0)
    // Descending by what it COMMITS. `sort` is stable in every engine this ships to, so two equal
    // holdings keep the inventory's order rather than swapping under the user between renders.
    .sort((a, b) => b.micros - a.micros);

  const keys: string[] = [];
  let picked = 0;
  for (const entry of spendable) {
    if (picked >= target) break;
    keys.push(entry.key);
    picked += entry.micros;
  }

  return { keys, usd: toUsd(picked) };
}

/**
 * Proportional headroom over the bare shortfall when seeding the picker's requirement ([R7]).
 *
 * 5% covers the three things that can only be priced after a route exists: the investor default max
 * slippage (2%), Uniswap's own fee (at most 1% on the pairs this rail routes) and Across's bridge
 * fee (a fraction of a percent). Over-asking is the deliberate direction, because [R7]'s hard
 * constraint is that the CTA must never flip from enabled to disabled underneath the user, and it
 * costs nothing: any headroom the quoted plan does not consume stays in the wallet.
 */
export const SEED_BUFFER_RATE = 0.05;

/**
 * POO-1812 `FU-006`, recorded 2026-09-04 and deliberately not resolved here.
 *
 * Murilo still considers this floor TOO HIGH. It is kept at 5% in this change because the rule being
 * introduced is about making the buffer see slippage at all, and lowering the floor in the same
 * change would retune a live CTA gate on two variables at once, exactly the reasoning POO-1499 [R49]
 * gave for not taking it to 3%.
 *
 * The review is on measured data, not on argument. `funding_buffer_consumed` (POO-1811) reports the
 * `buffer_headroom_bps` distribution against the rate that produced each budget, and POO-1813's
 * `funding_buy_settled` reports `delivered_usd` against `prefill_usd`. Once the first weeks of
 * purchases on the new rail are in, those two answer whether 5% is over-asking and by how much.
 * Lowering it is a rules-version change with a compliance amendment (`CR-CORE-014`), never a
 * constant edit. Tracked as `FU-006`.
 */

/**
 * Headroom kept ON TOP of the buyer's own slippage tolerance ([R1]).
 *
 * One point, and NOT a fee: nothing in this file models what any venue charges, and POO-1641 deleted
 * the last constant that tried to. It is here because the tolerance is a ceiling on ONE of the ways
 * a run can end up needing more than it was sized for, and the others are only knowable after the
 * route is priced. A seed that granted exactly the tolerance and nothing else would land on the
 * requirement with no margin at all, which is a CTA that opens and then cannot be honoured. One
 * point is the smallest step that leaves a margin, and any of it the quoted plan does not consume
 * stays in the buyer's wallet.
 */
export const SLIPPAGE_HEADROOM_RATE = 0.01;

/**
 * The ceiling on the computed rate ([R1]).
 *
 * The slippage control is hand-typeable, so without a cap a buyer who types 50 would be asked to
 * source 51% more than the operation costs. That is not protection, it is a refusal wearing a
 * buffer's clothes: the CTA would stay shut on a wallet that can comfortably fund the trade. 15%
 * clears every slippage the product recommends and stops there.
 */
export const SEED_BUFFER_MAX_RATE = 0.15;

/**
 * The buffer rate for one run, given the slippage that run will actually allow ([R1]).
 *
 * `min(15%, max(5%, slippage% + 1%))`, Murilo's rule of 2026-09-04.
 *
 * ## Why the seed has to see slippage at all
 *
 * It did not, and that was the defect: `seedRequiredUsd` took `(shortfall, gas)` and never read a
 * slippage figure, while slippage is what most consumes the buffer, the gear that raises it is
 * reachable from step 2, and `raiseSlippageAndRetry` raises it MID-RUN. So the number whose whole
 * job is to absorb a market move was blind to how much of a move the run had been told to accept.
 *
 * ## Whole percentage points, and why the rounding lives here ([R3])
 *
 * The rate is DISCLOSED as an integer percent and HELD as integer basis points, and neither is exact
 * off a raw float: 5% plus one point is `0.060000000000000005`, which converts to `699.9999999999999`
 * basis points, a value 34 of the 201 settings the slippage control accepts would produce. Quantising
 * once, here, is what makes the number the buyer reads, the number the picker sizes against and the
 * number the analytics row carries the same number. The clamp runs first, so the floor and the cap
 * (whole points already) survive it untouched.
 */
export function seedBufferRate(slippagePct?: number): number {
  // [R5]: a broken or absent reading is the FLOOR, never a computed value. The rate gates a CTA, and
  // `NaN` propagating into that comparison would silently open it.
  if (slippagePct === undefined || !Number.isFinite(slippagePct) || slippagePct < 0) {
    return SEED_BUFFER_RATE;
  }
  const clamped = Math.min(
    SEED_BUFFER_MAX_RATE,
    Math.max(SEED_BUFFER_RATE, slippagePct / 100 + SLIPPAGE_HEADROOM_RATE),
  );
  return Math.round(clamped * 100) / 100;
}

/**
 * What to ask the picker to cover BEFORE a route has been quoted ([R7]).
 *
 * The circularity this resolves: the honest requirement is the plan's own `totalPayUsd`, which is
 * only known after `buildPlan` prices a route, which depends on which sources were picked. So the
 * picker is seeded conservatively here, and the QUOTED plan is re-checked against the selection
 * before the user commits (`ProvisioningPanel`) — the seed opens the CTA, the quote is the final
 * word.
 *
 * Rounds UP to the cent, for the same reason the running total rounds a shortfall up: a sub-cent
 * gap must never read as covered. A broken reading contributes nothing rather than NaN, which would
 * propagate into the CTA's comparison and silently open it.
 *
 * ## POO-1499 [R49]: the buffer now covers the gas too
 *
 * This used to be `(shortfall x rate) + gas`, which left the gas component unbuffered. Both halves
 * cross a market between selection and settlement, so both are exposed to the move the buffer exists
 * to absorb, and only one of them was protected. The rate itself is deliberately UNCHANGED at 5%
 * (murilo 2026-08-10): the spec asked for 3%, but this number was sized against [R7]'s constraint
 * that the CTA must never flip from enabled to disabled underneath the user, and lowering it in the
 * same change that re-bases it would retune a live gate on two variables at once.
 *
 * The effect is small in dollars and real in behaviour: on a $100 shortfall with $5 of quoted gas it
 * moves from `$110.00` to `$110.25`, and what that figure decides is WHEN the CTA opens.
 */
export function seedRequiredUsd(shortfallUsd: number, gasUsd = 0, slippagePct?: number): number {
  const shortfall = toMicros(shortfallUsd);
  const gas = toMicros(gasUsd);
  // POO-1812 [R1]/[R5]: absent, the rate is the floor, so this is byte-identical to the pre-1812
  // behaviour and every caller that has not opted in is unchanged.
  const rate = seedBufferRate(slippagePct);
  return ceilToUsd(Math.round((shortfall + gas) * (1 + rate)));
}

/**
 * Toggle a source in the selection, preserving pick order [R4].
 *
 * Selection order IS route order: `buildPlan` consumes the sources in the order it receives them, so
 * appending (rather than re-sorting into, say, USD order) is what makes the list the user reads the
 * list that executes. Non-mutating: the caller's array is React state.
 */
export function toggleFundingSource(selected: readonly string[], key: string): string[] {
  return selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
}

/** The running total against the requirement [R1], and the coverage test the CTA gates on [R5]. */
export interface FundingProgress {
  /** USD of the selected sources, to the cent. */
  selectedUsd: number;
  /** What the operation needs, fees and buffer included, to the cent. */
  requiredUsd: number;
  /** `max(0, required - selected)`, rounded UP: zero only when the requirement is truly covered. */
  remainingUsd: number;
  /** `max(0, selected - required)`, rounded DOWN: never claims headroom the wallet does not hold. */
  surplusUsd: number;
  /** The selection covers the requirement. The exact-cover case is covered [R5]. */
  covered: boolean;
}

/**
 * The running total for a selection [R1].
 *
 * Robust to a selection that has outlived its inventory: a key naming no current source contributes
 * nothing (holdings are re-read, and a spent or moved token simply disappears), and a duplicate key
 * counts once. A source whose USD value is not a usable figure contributes nothing rather than NaN,
 * which would poison the total and silently open the CTA.
 *
 * A zero or malformed requirement reads as covered: there is nothing to cover. The component still
 * requires at least one selected source before it will confirm, so this cannot submit an empty plan.
 */
export function fundingProgress(
  sources: readonly FundingSource[],
  selected: readonly string[],
  requiredUsd: number,
): FundingProgress {
  // POO-1155: what each source COMMITS, not its raw value — the native coin contributes only the
  // excess above the signing reserve, so a selected native never overstates coverage by the gas the
  // user still needs to hold.
  const usdByKey = new Map(
    sources.map((source) => [fundingSourceKey(source), committedUsd(source)]),
  );
  const counted = new Set<string>();

  let selectedMicros = 0;
  for (const key of selected) {
    if (counted.has(key)) continue;
    counted.add(key);
    selectedMicros += toMicros(usdByKey.get(key));
  }

  const requiredMicros = toMicros(requiredUsd);
  return {
    selectedUsd: toUsd(selectedMicros),
    requiredUsd: toUsd(requiredMicros),
    remainingUsd: ceilToUsd(Math.max(0, requiredMicros - selectedMicros)),
    surplusUsd: floorToUsd(Math.max(0, selectedMicros - requiredMicros)),
    covered: selectedMicros >= requiredMicros,
  };
}
