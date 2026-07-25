/**
 * @id PP-STR-CMP-023 (POO-1039)
 * @name funding selection helpers
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The pure half of {@link FundingSourceSelector}: identity, selectability, ordering and the running
 * total. Split out for the same reason `gasSelection.ts` is: the arithmetic a CTA gates on should be
 * exhaustively testable without mounting a component.
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

/** Micro-dollars per USD. Integer accumulation unit, so sub-cent figures survive being summed. */
const MICROS = 1_000_000;

/** A USD figure as integer micro-dollars. A NaN, infinite or negative reading contributes nothing. */
function toMicros(usd: number | undefined): number {
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? Math.round(usd * MICROS) : 0;
}

/** Micro-dollars to USD, rounded to the nearest cent. */
function toUsd(micros: number): number {
  return Math.round(micros / 10_000) / 100;
}

/** Micro-dollars to USD, rounded UP to the cent. Used for a shortfall: never understate it. */
function ceilToUsd(micros: number): number {
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
 * An empty set means the routability lookup degraded, not that the money is stranded. Same-chain is
 * still offered in that case: it executes with no bridge at all, so the one fact we would have
 * needed the lookup for does not apply, and hiding a funded row on missing information is exactly
 * the failure [R6] forbids. Cross-chain is not offered, because there the missing fact is the whole
 * question.
 */
export function reachesChain(
  source: Pick<FundingSource, "chainId" | "reachableChainIds">,
  targetChainId: number,
): boolean {
  const reachable = source.reachableChainIds ?? [];
  if (reachable.length === 0) return source.chainId === targetChainId;
  return reachable.includes(targetChainId);
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
 */
export function seedRequiredUsd(shortfallUsd: number, gasUsd = 0): number {
  const shortfall = toMicros(shortfallUsd);
  const gas = toMicros(gasUsd);
  return ceilToUsd(Math.round(shortfall * (1 + SEED_BUFFER_RATE)) + gas);
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
  const usdByKey = new Map(sources.map((source) => [fundingSourceKey(source), source.usd]));
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
