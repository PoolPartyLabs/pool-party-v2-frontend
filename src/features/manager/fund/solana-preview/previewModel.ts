/**
 * @id PP-MGR-LIB-059
 * @name solanaPreviewModel
 * @implements-rules-version v2 (POO-2281); v1 (POO-2291 catalog consumption)
 * @analytics-events none, pure local drawing state; the preview screen owns events.
 */
import { SOLANA_LOCAL_PROTOCOLS, type SolanaLocalProtocol } from "./solanaCatalog";

export const PREVIEW_PROTOCOLS = SOLANA_LOCAL_PROTOCOLS;
/** Holding is a custody block, separate from the four venue/protocol choices. */
export type PreviewProtocol = SolanaLocalProtocol | "holding";
export const PREVIEW_BLOCKS: readonly PreviewProtocol[] = [...PREVIEW_PROTOCOLS, "holding"];
export type PreviewPair = "SOL / USDC" | "USDC / SOL";
export interface PreviewBlock {
  id: string;
  protocol: PreviewProtocol;
  allocationBps: number;
  pair: PreviewPair;
}
export interface PreviewEdit {
  allocation: string;
  pair: PreviewPair;
}
export type PreviewError = "allocation_invalid" | "allocation_total";
export interface PreviewState {
  blocks: PreviewBlock[];
  selectedId: string | null;
  edit: PreviewEdit | null;
  nextId: number;
  changed: boolean;
  error: PreviewError | null;
}
export type PreviewAction =
  | { type: "add"; protocol: PreviewProtocol }
  | { type: "select"; id: string | null }
  | { type: "edit"; value: Partial<PreviewEdit> }
  | { type: "apply" }
  | { type: "discard" }
  | { type: "remove"; id: string };
export function createPreviewState(): PreviewState {
  return { blocks: [], selectedId: null, edit: null, nextId: 1, changed: false, error: null };
}
/** Whole percentages only (R7). No market values or floating-point amount math. */
export function parseAllocation(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const percent = Number(text);
  return percent <= 100 ? percent * 100 : null;
}
export function allocationText(bps: number): string {
  return String(bps / 100);
}
export function totalAllocationBps(state: PreviewState): number {
  return state.blocks.reduce((total, block) => total + block.allocationBps, 0);
}
export function isLiquidityBlock(protocol: PreviewProtocol): boolean {
  return protocol === "raydium" || protocol === "orca";
}
function editFor(block: PreviewBlock | undefined): PreviewEdit | null {
  return block ? { allocation: allocationText(block.allocationBps), pair: block.pair } : null;
}
export function hasUnappliedChanges(state: PreviewState): boolean {
  const block = state.blocks.find((item) => item.id === state.selectedId);
  return Boolean(
    block &&
      state.edit &&
      (parseAllocation(state.edit.allocation) !== block.allocationBps ||
        state.edit.pair !== block.pair),
  );
}
export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case "add": {
      const block: PreviewBlock = {
        id: `preview-${state.nextId}`,
        protocol: action.protocol,
        allocationBps: 0,
        pair: "SOL / USDC",
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        selectedId: block.id,
        edit: editFor(block),
        nextId: state.nextId + 1,
        changed: true,
        error: null,
      };
    }
    case "select": {
      const block = state.blocks.find((item) => item.id === action.id);
      return { ...state, selectedId: block?.id ?? null, edit: editFor(block), error: null };
    }
    case "edit":
      return state.edit
        ? { ...state, edit: { ...state.edit, ...action.value }, error: null }
        : state;
    case "apply": {
      const selected = state.blocks.find((item) => item.id === state.selectedId);
      if (!selected || !state.edit) return state;
      const allocationBps = parseAllocation(state.edit.allocation);
      if (allocationBps === null) return { ...state, error: "allocation_invalid" };
      if (totalAllocationBps(state) - selected.allocationBps + allocationBps > 10000)
        return { ...state, error: "allocation_total" };
      const block = { ...selected, allocationBps, pair: state.edit.pair };
      return {
        ...state,
        blocks: state.blocks.map((item) => (item.id === block.id ? block : item)),
        edit: editFor(block),
        changed: state.changed || hasUnappliedChanges(state),
        error: null,
      };
    }
    case "discard":
      return {
        ...state,
        edit: editFor(state.blocks.find((item) => item.id === state.selectedId)),
        error: null,
      };
    case "remove": {
      if (!state.blocks.some((item) => item.id === action.id)) return state;
      const selectedRemoved = state.selectedId === action.id;
      return {
        ...state,
        blocks: state.blocks.filter((item) => item.id !== action.id),
        selectedId: selectedRemoved ? null : state.selectedId,
        edit: selectedRemoved ? null : state.edit,
        changed: true,
        error: null,
      };
    }
  }
}
