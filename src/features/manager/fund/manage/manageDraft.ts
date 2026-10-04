/**
 * @id PP-MGR-LIB-053
 * @name manageDraft
 * @implements-rules-version v1 (POO-2227)
 * @analytics-events none (pure draft state)
 */
import type { PoolRange } from "../build/panel/poolRangeMath";
export interface ManageDraft {
  identity: string;
  original: PoolRange;
  range: PoolRange;
  action: "move" | "future" | null;
  slippageBps: number;
}
export type ManageDraftAction =
  | { type: "range"; range: PoolRange }
  | { type: "choose"; action: "move" | "future" }
  | { type: "slippage"; bps: number }
  | { type: "back" }
  | { type: "discard" }
  | { type: "reset"; range: PoolRange };
export function createManageDraft(identity: string, range: PoolRange): ManageDraft {
  return { identity, original: range, range, action: null, slippageBps: 200 };
}
export function rangeChanged(draft: ManageDraft): boolean {
  return (
    draft.range.tickLower !== draft.original.tickLower ||
    draft.range.tickUpper !== draft.original.tickUpper
  );
}
export function manageDraftReducer(state: ManageDraft, action: ManageDraftAction): ManageDraft {
  switch (action.type) {
    case "range": {
      const next = { ...state, range: action.range };
      return { ...next, action: rangeChanged(next) ? state.action : null };
    }
    case "choose":
      return rangeChanged(state) ? { ...state, action: action.action } : state;
    case "slippage":
      return Number.isInteger(action.bps) && action.bps >= 10 && action.bps <= 500
        ? { ...state, slippageBps: action.bps }
        : state;
    case "back":
      return { ...state, action: null };
    case "discard":
      return createManageDraft(state.identity, state.original);
    case "reset":
      return createManageDraft(state.identity, action.range);
  }
}
export function rangeFingerprint(draft: ManageDraft): string {
  return `${draft.identity}:${draft.range.tickLower}:${draft.range.tickUpper}:${draft.slippageBps}`;
}
export function validManageRange(range: PoolRange, spacing: number): boolean {
  return (
    Number.isInteger(spacing) &&
    spacing > 0 &&
    Number.isInteger(range.tickLower) &&
    Number.isInteger(range.tickUpper) &&
    range.tickLower >= -887272 &&
    range.tickUpper <= 887272 &&
    range.tickUpper - range.tickLower >= spacing * 2 &&
    range.tickLower % spacing === 0 &&
    range.tickUpper % spacing === 0
  );
}
