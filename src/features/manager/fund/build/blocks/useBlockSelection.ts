/**
 * @id PP-MGR-HOK-009
 * @name useBlockSelection
 * @implements-rules-version v1 (POO-2155 rules v1; the resume of POO-2187 rules v1)
 * @analytics-events none, a state hook. A selection is not a funnel step; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event of the canvas.
 *
 * Which block of the Build canvas is selected (handoff v1.2 I5): one id or null, never two.
 *
 * Every change passes a GUARD (panel heads-up HU3). The configuration panel (POO-2187) applies its
 * fields only on "Apply changes"; while it holds changes it did not apply, it refuses a selection
 * change (a click on another block, on a share label, on the canvas background) and refuses leaving
 * the step, and shows its notice. So:
 *
 * - `select(next)` asks every registered guard `allowChange(next)`. One refusal keeps the selection,
 *   calls that guard's `onRefused` (its notice) and returns false. Selecting the id already selected
 *   asks nobody.
 * - `guardLeave(proceed)` asks every guard about leaving (`allowChange(null)`) and runs `proceed`
 *   only when all allow. Every way out of the Build step goes through it (S7 wires Back, Save & exit
 *   and the stepper; the controller wires the Edit mandate links).
 * - [P6, finding 10] A refusal hands the refusing guard the change it stopped, as
 *   `{ resume() }`: for `select(next)` it is `select(next)` again, which asks the guards again; for
 *   `guardLeave(proceed)` it is `proceed` itself. The panel keeps it and runs it once Apply changes
 *   or Discard changes settled, so both exits of its notice complete the blocked navigation.
 *
 * Every function keeps its identity across renders, and reads the CURRENT selection through a ref,
 * so a handler built in one render never acts on a stale id.
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/** A change a guard refused, handed to it so it can perform the change later (P6). */
export interface RefusedChange {
  /** Perform the refused change: the selection change again, or the way out of the step. */
  resume(): void;
}

/** A party that can veto a selection change: the configuration panel (POO-2187). */
export interface SelectionGuard {
  /** Whether the selection may become `next` (null: cleared, or leaving the step). */
  allowChange(next: string | null): boolean;
  /** Called when this guard refused: show the notice, and keep `change` to resume it later. */
  onRefused?(change: RefusedChange): void;
}

export interface UseBlockSelectionResult {
  selectedId: string | null;
  /** Select a block (or clear with null). False when a guard refused: the selection is unchanged. */
  select(id: string | null): boolean;
  /** Register a guard; returns the function that unregisters it. */
  registerGuard(guard: SelectionGuard): () => void;
  /** Run `proceed` (a way out of the Build step) only when every guard allows leaving. */
  guardLeave(proceed: () => void): void;
}

/** Ask every guard; tell each refusing one, with the change it stopped. True when all allow. */
function askGuards(
  guards: ReadonlySet<SelectionGuard>,
  next: string | null,
  change: RefusedChange,
): boolean {
  const refused = [...guards].filter((guard) => !guard.allowChange(next));
  for (const guard of refused) guard.onRefused?.(change);
  return refused.length === 0;
}

/** The Build canvas selection, with its guard. */
export function useBlockSelection(initial: string | null = null): UseBlockSelectionResult {
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const selectedRef = useRef(selectedId);
  const guards = useRef(new Set<SelectionGuard>());
  // `select` hands itself to a refusing guard as the resume; a ref, because it is built once.
  const selectRef = useRef<(id: string | null) => boolean>(() => false);

  const select = useCallback((id: string | null): boolean => {
    if (id === selectedRef.current) return true;
    const change: RefusedChange = { resume: () => void selectRef.current(id) };
    if (!askGuards(guards.current, id, change)) return false;
    selectedRef.current = id;
    setSelectedId(id);
    return true;
  }, []);
  selectRef.current = select;

  const registerGuard = useCallback((guard: SelectionGuard) => {
    guards.current.add(guard);
    return () => {
      guards.current.delete(guard);
    };
  }, []);

  const guardLeave = useCallback((proceed: () => void) => {
    if (askGuards(guards.current, null, { resume: proceed })) proceed();
  }, []);

  return useMemo(
    () => ({ selectedId, select, registerGuard, guardLeave }),
    [selectedId, select, registerGuard, guardLeave],
  );
}
