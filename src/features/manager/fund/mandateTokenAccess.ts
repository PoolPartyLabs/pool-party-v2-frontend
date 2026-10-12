/**
 * @id PP-MGR-LIB-079 (POO-2332)
 * @name mandateTokenAccess
 * @implements-rules-version v1 (POO-2332 rules v1)
 * @analytics-events none. The builder shell (PP-MGR-SCR-002) sends `builder_mandate_token_mode_changed`
 *   with the params {@link tokenModeEvent} returns.
 *
 * The view models for the Token access mode, the 100-slot basket and the token caps. Pure functions
 * over the draft: the Tokens step and the Limits step read them, so the screens hold no rule of
 * their own and a unit test covers each rule without rendering a component.
 *
 * The domain rules (the mode, the start caps, `cap_zero`, the slot ceiling) live in
 * `mandateDraft.ts`. This module only answers "what does the screen show".
 */
import type { MandateCatalog } from "./mandateCatalog";
import {
  CAP_STEP_PCT,
  capRows,
  effectiveCap,
  HUB_NETWORK,
  type MandateCap,
  type MandateDraft,
  type MandateTokenRef,
  type NetworkId,
  setCap,
  slotCeiling,
  slotsUsed,
  tokenKey,
  tokenModeOf,
} from "./mandateDraft";

/** What the footer "Network slots" shows (R3, R4, R7). */
export interface SlotsView {
  used: number;
  /** The most slots the draft may fill: 100 in the mock builder, 16 in real data mode (R2, R14). */
  ceiling: number;
  remaining: number;
  /** R7: no free slot. Never true in All tokens mode, which has no slot cap (R4). */
  full: boolean;
  /** R4: All tokens mode. The footer shows "No limit" and the cap does not apply. */
  unlimited: boolean;
  /** R7: false when the basket is full, so "Add all" is shown and off. */
  addAllEnabled: boolean;
}

export function slotsView(draft: MandateDraft): SlotsView {
  const used = slotsUsed(draft);
  const ceiling = slotCeiling(draft);
  const unlimited = tokenModeOf(draft) === "all";
  const remaining = Math.max(0, ceiling - used);
  const full = !unlimited && remaining === 0;
  return { used, ceiling, remaining, full, unlimited, addAllEnabled: !full };
}

/** R6: what the Tokens step shows in place of the card grid. */
export type TokensViewState =
  | { kind: "ready"; showSkeletons: false; searchEnabled: true; filtersEnabled: true }
  | { kind: "loading"; showSkeletons: true; searchEnabled: true; filtersEnabled: true }
  | {
      kind: "error";
      showSkeletons: false;
      canRetry: true;
      searchEnabled: true;
      filtersEnabled: true;
    }
  /** Real data mode keeps its own status panel (R14). */
  | { kind: "real" };

export function tokensViewState(input: {
  loading: boolean;
  error: boolean;
  dataMode: "real" | undefined;
}): TokensViewState {
  if (input.dataMode === "real") return { kind: "real" };
  if (input.error)
    return {
      kind: "error",
      showSkeletons: false,
      canRetry: true,
      searchEnabled: true,
      filtersEnabled: true,
    };
  if (input.loading)
    return { kind: "loading", showSkeletons: true, searchEnabled: true, filtersEnabled: true };
  return { kind: "ready", showSkeletons: false, searchEnabled: true, filtersEnabled: true };
}

/** R4: why a locked row sits in "Your tokens". The hub deposit token is the deposit token. */
export type LockedRowCaption =
  | { kind: "depositToken" }
  | { kind: "requiredBy"; network: NetworkId };

export function lockedRowCaption(token: Pick<MandateTokenRef, "network">): LockedRowCaption {
  return token.network === HUB_NETWORK
    ? { kind: "depositToken" }
    : { kind: "requiredBy", network: token.network };
}

/** R7: the first rows of a long list, and how many stay hidden behind "and N more". */
export function collapseRows<T>(rows: readonly T[], limit: number): { shown: T[]; hidden: number } {
  return { shown: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) };
}

/** R9: what the "All tokens" row in Selected mode shows. */
export type AllTokensSummary =
  | { kind: "empty" }
  | { kind: "uniform"; cap: MandateCap }
  | { kind: "mixed" };

function sameCap(a: MandateCap, b: MandateCap): boolean {
  return a.noCap === b.noCap && (a.noCap || a.pct === b.pct);
}

export function allTokensSummary(draft: MandateDraft, catalog: MandateCatalog): AllTokensSummary {
  const rows = capRows(draft, catalog).tokens;
  const caps: MandateCap[] = [];
  for (const row of rows) {
    const cap = effectiveCap(draft, "tokens", tokenKey(row));
    if (cap) caps.push(cap);
  }
  const head = caps[0];
  if (!head) return { kind: "empty" };
  return caps.every((cap) => sameCap(cap, head))
    ? { kind: "uniform", cap: head }
    : { kind: "mixed" };
}

/** R9: write one cap on every token row of the list. Locked rows have no cap (R8). */
export function setAllTokenCaps(
  draft: MandateDraft,
  catalog: MandateCatalog,
  cap: MandateCap,
): MandateDraft {
  let next = draft;
  for (const row of capRows(draft, catalog).tokens)
    next = setCap(next, "tokens", tokenKey(row), cap);
  return next;
}

/** R11: the values the slider offers, 0 to 100 in 5% steps. */
export function capSteps(): number[] {
  const steps: number[] = [];
  for (let pct = 0; pct <= 100; pct += CAP_STEP_PCT) steps.push(pct);
  return steps;
}

/**
 * R13: when the blocked control is lit and when it is dark. Two blinks are two "on" phases, each
 * `periodMs` long, with a dark phase of the same length after it. The control ends dark.
 */
export function blinkSchedule(times: number, periodMs: number): { at: number; on: boolean }[] {
  const phases: { at: number; on: boolean }[] = [];
  for (let i = 0; i < times; i += 1) {
    phases.push({ at: 2 * i * periodMs, on: true });
    phases.push({ at: (2 * i + 1) * periodMs, on: false });
  }
  return phases;
}

/**
 * R15: the params of `builder_mandate_token_mode_changed`, or null when the mode did not change.
 * The shell calls this with the draft before and after a reducer, so no step needs an analytics prop.
 */
export function tokenModeEvent(
  before: MandateDraft,
  after: MandateDraft,
): { token_mode: "selected" | "all" } | null {
  const next = tokenModeOf(after);
  return tokenModeOf(before) === next ? null : { token_mode: next };
}
