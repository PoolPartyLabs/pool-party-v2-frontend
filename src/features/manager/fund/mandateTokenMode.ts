/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenMode
 * @implements-rules-version v1 (POO-2332 rules v1)
 * @analytics-events none, a pure module. It builds the `builder_mandate_token_mode_changed` params,
 *   and the builder shell (PP-MGR-SCR-002) sends the event.
 *
 * The token access mode and the cap read models of POO-2332, as data. The Tokens step (S5) and the
 * Limits step (S6) render what this module computes. The rules that the draft itself must obey (the
 * slot ceiling, the start values, the `cap_zero` refusal) live in PP-MGR-LIB-019, because
 * `validateStep` and the reducers there read them.
 *
 * Every function is pure and immutable, like the reducers in PP-MGR-LIB-019. Real data mode
 * (POO-2133) keeps today's behavior: a mode change is a no-op there and nothing holds Next (R14).
 */
import type { MandateCatalog } from "./mandateCatalog";
import {
  capRows,
  clampCapPct,
  EVERY_TOKEN_ROW_ID,
  effectiveCap,
  firstZeroCap,
  HUB_NETWORK,
  MAX_MANDATE_SLOTS,
  type MandateCap,
  type MandateDraft,
  type MandateStepKey,
  type MandateTokenMode,
  type MandateTokenRef,
  maxTokenSlots,
  setCap,
  slotsUsed,
  tokenKey,
  tokenModeOf,
} from "./mandateDraft";

/** R13: how many times the Limits step blinks the row that holds Next. */
export const CAP_ZERO_BLINKS = 2;

/** R1/R5: set the token access mode. The token list and the caps stay as they are. */
export function withTokenMode(draft: MandateDraft, mode: MandateTokenMode): MandateDraft {
  if (draft.dataMode === "real") return draft;
  if (tokenModeOf(draft) === mode && draft.tokenMode === mode) return draft;
  return { ...draft, tokenMode: mode };
}

/** R3/R4/R7: the "Network slots" footer of the Tokens step. */
export type SlotFooter =
  | { kind: "unlimited"; max: number }
  | { kind: "count"; used: number; max: number; full: boolean };

/** R3/R4/R7: what the slot footer shows. All mode has no limit, so it shows no count. */
export function slotFooter(draft: MandateDraft): SlotFooter {
  if (tokenModeOf(draft) === "all") return { kind: "unlimited", max: MAX_MANDATE_SLOTS };
  const used = slotsUsed(draft);
  const max = maxTokenSlots(draft);
  return { kind: "count", used, max, full: used >= max };
}

/** R7: whether `count` more token entries fit. A card with two networks needs two free slots. */
export function canAddEntries(draft: MandateDraft, count: number): boolean {
  return slotsUsed(draft) + count <= maxTokenSlots(draft);
}

/** R4: one row of "Your tokens · All". */
export type AllModeTokenRow =
  | { kind: "deposit"; token: MandateTokenRef }
  | { kind: "required"; token: MandateTokenRef }
  | { kind: "everyOther" };

/**
 * R4: the All-mode "Your tokens" rows. The hub deposit token, then the deposit token each other
 * network requires, then "Every other token". The tokens the manager chose stay in the draft (R5)
 * but have no row here, because "Every other token" covers them.
 */
export function allModeTokenRows(draft: MandateDraft): AllModeTokenRow[] {
  const locked = draft.tokens.filter((token) => token.locked);
  const rows: AllModeTokenRow[] = [];
  for (const token of locked) {
    if (token.network === HUB_NETWORK) rows.push({ kind: "deposit", token });
  }
  for (const token of locked) {
    if (token.network !== HUB_NETWORK) rows.push({ kind: "required", token });
  }
  rows.push({ kind: "everyOther" });
  return rows;
}

/** R6: the state of the token list. */
export type TokenListState = "loading" | "error" | "ready";

/** R6: whether the catalog is still loading, failed, or ready. */
export function tokenListState(catalog: MandateCatalog): TokenListState {
  if (catalog.loading) return "loading";
  if (catalog.error) return "error";
  return "ready";
}

/** R10: the token cap rows of the Limits step. All mode has the one "Every token" row. */
export function limitTokenRowIds(draft: MandateDraft, catalog: MandateCatalog): string[] {
  if (tokenModeOf(draft) === "all") return [EVERY_TOKEN_ROW_ID];
  return capRows(draft, catalog).tokens.map(tokenKey);
}

/**
 * R9: the value of the Selected-mode "All tokens" row. The shared cap when every token row has the
 * same cap, "mixed" when they differ, and null when there is no token row.
 */
export function bulkTokenCap(
  draft: MandateDraft,
  catalog: MandateCatalog,
): MandateCap | "mixed" | null {
  const caps = capRows(draft, catalog).tokens.map(
    (token) => effectiveCap(draft, "tokens", tokenKey(token)) ?? { noCap: false, pct: 0 },
  );
  const [first, ...rest] = caps;
  if (!first) return null;
  const same = rest.every((cap) => (first.noCap ? cap.noCap : !cap.noCap && cap.pct === first.pct));
  return same ? { noCap: first.noCap, pct: first.pct } : "mixed";
}

/** R9/R11: write one cap, snapped to 5% steps, on every token row. */
export function withAllTokenCaps(
  draft: MandateDraft,
  catalog: MandateCatalog,
  cap: MandateCap,
): MandateDraft {
  return capRows(draft, catalog).tokens.reduce(
    (next, token) => setCap(next, "tokens", tokenKey(token), cap),
    draft,
  );
}

/** R10/R11: write the All-mode "Every token" cap, snapped to 5% steps. */
export function withEveryTokenCap(draft: MandateDraft, cap: MandateCap): MandateDraft {
  return {
    ...draft,
    caps: { ...draft.caps, everyToken: { noCap: cap.noCap, pct: clampCapPct(cap.pct) } },
  };
}

/** R12: the group whose 0% cap holds Next. It picks the reason label on the Next button. */
export type CapHold = "network" | "protocol" | "token";

/**
 * R12: why Next is held on this step, or null. Only Limits holds Next, and only on an enabled 0%
 * cap. The shell still sends the click to `validateStep`, which refuses it with `cap_zero` (R13).
 */
export function nextHold(
  draft: MandateDraft,
  catalog: MandateCatalog,
  step: MandateStepKey,
): CapHold | null {
  if (step !== "limits") return null;
  const zero = firstZeroCap(draft, catalog);
  if (!zero) return null;
  if (zero.scope === "networks") return "network";
  if (zero.scope === "protocols") return "protocol";
  return "token";
}

/** R15: the params of `builder_mandate_token_mode_changed`. */
export function tokenModeChangedParams(mode: MandateTokenMode): { token_mode: MandateTokenMode } {
  return { token_mode: mode };
}
