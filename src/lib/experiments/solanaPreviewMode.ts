/**
 * @id PP-CORE-LIB-124
 * @name solanaPreviewMode
 * @implements-rules-version v1 (POO-2281)
 * @analytics-events none, an unmounted preference model.
 */
import type { ContractFamily } from "@/lib/hooks/useContractFamily";
import { hasExperimentCapability } from "./access";

/** In-memory preference only. It never writes the existing EVM draft/family storage keys. */
export interface SolanaPreviewState {
  mode: "standard" | "v2-solana";
  accountKey: string | null;
  pressCount: number;
  firstPressAt: number | null;
}
export interface SolanaPreviewContext {
  family: ContractFamily;
  /** Session/account generation key for reset only, never evidence of authorization. */
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
  state: SolanaPreviewState,
  context: SolanaPreviewContext,
): SolanaPreviewState {
  if (
    context.family !== "v2" ||
    !context.accountKey ||
    !hasExperimentCapability(context.access, "preview", context.now)
  ) {
    return createSolanaPreviewState();
  }
  if (state.accountKey !== context.accountKey) {
    return { ...createSolanaPreviewState(), accountKey: context.accountKey };
  }
  return state;
}

/** One explicit press of the already-selected V2 segment, called only by a future guarded host. */
export function pressSolanaPreview(
  state: SolanaPreviewState,
  context: SolanaPreviewContext,
): SolanaPreviewState {
  const current = syncSolanaPreview(state, context);
  if (!current.accountKey || current.mode === "v2-solana") return current;
  if (context.dirty) {
    return { ...current, pressCount: 0, firstPressAt: null };
  }
  const continuing =
    current.firstPressAt !== null &&
    context.now >= current.firstPressAt &&
    context.now - current.firstPressAt <= SOLANA_PREVIEW_GESTURE_WINDOW_MS;
  const pressCount = continuing ? current.pressCount + 1 : 1;
  return {
    ...current,
    mode: pressCount === 3 ? "v2-solana" : "standard",
    pressCount: pressCount === 3 ? 0 : pressCount,
    firstPressAt: pressCount === 3 ? null : continuing ? current.firstPressAt : context.now,
  };
}
