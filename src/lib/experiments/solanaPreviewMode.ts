/**
 * @id PP-CORE-LIB-124
 * @name solanaPreviewMode
 * @implements-rules-version v1 (POO-2281)
 * @analytics-events none, an unmounted preference model.
 */
import type { ContractFamily } from "@/lib/hooks/useContractFamily";

export interface SolanaPreviewState {
  mode: "standard" | "v2-solana";
  accountKey: string | null;
  pressCount: number;
  firstPressAt: number | null;
}
export interface SolanaPreviewContext {
  family: ContractFamily;
  accountKey: string | null;
  access: unknown;
  dirty: boolean;
  now: number;
}

export const SOLANA_PREVIEW_GESTURE_WINDOW_MS = 1_000;

export function createSolanaPreviewState(): SolanaPreviewState {
  return { mode: "standard", accountKey: null, pressCount: 0, firstPressAt: null };
}

export function syncSolanaPreview(
  _state: SolanaPreviewState,
  _context: SolanaPreviewContext,
): SolanaPreviewState {
  return createSolanaPreviewState();
}

export function pressSolanaPreview(
  _state: SolanaPreviewState,
  _context: SolanaPreviewContext,
): SolanaPreviewState {
  return createSolanaPreviewState();
}
