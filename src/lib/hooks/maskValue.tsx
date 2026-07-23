/**
 * @id PP-CORE-HOK-013
 * @name maskValue
 * @implements-rules-version v1
 *
 * Per-surface "hide values" state (the hide-values eye). A surface wraps its content in a provider
 * and any {@link MaskableValue} inside reads whether to mask. Two providers by surface policy:
 *  - {@link EphemeralMaskProvider} (the MANAGER): covered by default every load (no persistence, so
 *    it re-covers on reload), used once PER SECTION so each section has its own eye.
 *  - {@link PersistedMaskProvider} (the user-facing PORTFOLIO / HOME): open by default and remembers
 *    the user's choice (a non-sensitive UI pref via usePersistentState, never the values themselves).
 *
 * Only the boolean preference is ever stored; the values stay at the render layer (MaskableValue),
 * so nothing sensitive is persisted.
 */
"use client";

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { usePersistentState } from "./usePersistentState";

interface MaskValue {
  /** Whether values in this scope are currently hidden. */
  masked: boolean;
  /** Flip the masked state. */
  toggle: () => void;
}

const MaskValueContext = createContext<MaskValue | null>(null);

/**
 * Shared persist key for the user-facing (investor) hide-values eye. Home and Portfolio use the SAME
 * key so the choice syncs across those pages: hiding on one page hides on the other (it re-hydrates
 * from this key on navigation, and the `storage` event syncs live across tabs). POO-322.
 */
export const INVESTOR_HIDE_VALUES_KEY = "pp.hideValues";

/** Ephemeral mask scope (manager): covered by default, never persisted, so it re-covers every load. */
export function EphemeralMaskProvider({
  children,
  defaultMasked = true,
}: {
  children: ReactNode;
  defaultMasked?: boolean;
}) {
  const [masked, setMasked] = useState(defaultMasked);
  const value = useMemo<MaskValue>(
    () => ({ masked, toggle: () => setMasked((m) => !m) }),
    [masked],
  );
  return <MaskValueContext.Provider value={value}>{children}</MaskValueContext.Provider>;
}

/** Persisted mask scope (portfolio/home): open by default, remembers the user's choice. */
export function PersistedMaskProvider({
  children,
  persistKey,
  defaultMasked = false,
}: {
  children: ReactNode;
  persistKey: string;
  defaultMasked?: boolean;
}) {
  const [masked, setMasked] = usePersistentState<boolean>(persistKey, defaultMasked);
  const value = useMemo<MaskValue>(
    () => ({ masked, toggle: () => setMasked((m) => !m) }),
    [masked, setMasked],
  );
  return <MaskValueContext.Provider value={value}>{children}</MaskValueContext.Provider>;
}

/** Read the nearest mask state. Defaults to visible when no provider is present. */
export function useMaskValue(): MaskValue {
  return useContext(MaskValueContext) ?? { masked: false, toggle: () => undefined };
}
