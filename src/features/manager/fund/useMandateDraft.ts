/**
 * @id PP-MGR-HOK-006
 * @name useMandateDraft
 * @implements-rules-version v2 (POO-2121 rules v1, POO-2142 rules v2, POO-2151 rules v1)
 * @analytics-events none, this hook owns draft STATE rather than instrumentation. It surfaces
 *   `lastBlock` and the save outcome, and the builder shell (PP-MGR-SCR-002) turns those into
 *   `builder_mandate_blocked` and the save/abandon events. A hook that emitted them itself would
 *   fire once per consumer and could not name the step the user was on.
 *
 * React access to one mandate draft (R9). The working draft lives in memory across the five steps;
 * storage is touched only by {@link useMandateDraft} callers' explicit `save()`, never on mount and
 * never on `update`, so navigating back and forth cannot half-persist a mandate and an unsaved
 * draft is exactly as lost as the handoff says it is.
 *
 * The one rule worth stating twice: when a reducer refuses, the DRAFT DOES NOT CHANGE. `update`
 * keeps the previous object identity and records the refusal in `lastBlock`, which is what lets a
 * step render its inline notice and scroll to the offending row while the selection on screen still
 * matches the selection in state.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isMockMode } from "@/lib/services";
import { planFingerprint } from "./build/plan/planStorage";
import type { MandateCatalog } from "./mandateCatalog";
import {
  createEmptyDraft,
  draftNameError,
  isBlocked,
  type MandateDraft,
  type StepBlock,
  selectionFingerprint,
} from "./mandateDraft";
import { deleteDraft, getDraft, newDraftId, upsertDraft } from "./mandateDraftStore";
import { useV2MandateCatalog } from "./useV2MandateCatalog";
import { toV2MandateSelection } from "./v2Mandate";

/** Why a save did not happen. "storage" is the only one the name rule does not cover. */
export type MandateSaveError = "empty" | "length" | "storage";

/** The outcome of a save, which the Name-your-draft dialog renders inline (R7). */
export type MandateSaveResult = { ok: true } | { ok: false; error: MandateSaveError };

/** What the builder shell and the five steps read. */
export interface UseMandateDraftResult {
  draft: MandateDraft;
  catalog: MandateCatalog;
  /** Apply a reducer. A `{ blocked }` result leaves the draft alone and sets `lastBlock`. */
  update: (fn: (draft: MandateDraft) => MandateDraft | { blocked: StepBlock }) => void;
  /**
   * Persist the draft, naming it when a name is passed (the first Save and exit).
   *
   * `options.complete` stamps `completedAt` on the copy being WRITTEN, so the mandate is marked
   * finished only by a write that landed. See {@link UseMandateDraftResult} notes in the file header.
   */
  save: (name?: string, options?: { complete?: boolean }) => Promise<MandateSaveResult>;
  /** Forget the stored copy. The working draft stays in memory. */
  remove: () => void;
  /** False until the first client read of storage has happened. */
  hydrated: boolean;
  lastBlock: StepBlock | null;
  clearBlock: () => void;
  /** Whether the draft differs from the last persisted copy, which drives the leave-page prompt. */
  isDirty: boolean;
}

/**
 * Everything a save has to carry: the five selections, the name, the completion stamp and the Build
 * plan (POO-2151, coordinator default D17). The plan is HERE and not in `selectionFingerprint`, so a
 * plan edit arms the leave prompt without ever invalidating a completed mandate. `lastPhase` is
 * bookkeeping, like `lastStep`, and stays out.
 */
function unsavedFingerprint(draft: MandateDraft): string {
  return `${draft.name ?? ""}|${draft.completedAt ?? ""}|${selectionFingerprint(draft)}|${planFingerprint(draft.plan)}`;
}

/**
 * Read and edit one mandate draft.
 *
 * @param draftId An existing draft to resume. An unknown id yields a pristine draft under that id,
 *   rather than an error screen: the Console link may point at a draft deleted in another tab, and
 *   "start here" is a better answer than a dead end.
 */
export function useMandateDraft(draftId?: string): UseMandateDraftResult {
  // One catalog per mount, built from no flag (R17 v2, POO-2142: Robinhood Chain is always offered).
  // Steps compare catalog rows by identity in memos, so a fresh object on every render would
  // invalidate all of them.
  const catalog = useV2MandateCatalog();

  // The pristine draft is built once, and it doubles as the dirty-check baseline before the first
  // save: `isDirty` then means "anything was selected", which is the condition the shell's
  // beforeunload prompt needs.
  const [pristine] = useState<MandateDraft>(() =>
    isMockMode
      ? createEmptyDraft(new Date().toISOString(), draftId ?? newDraftId())
      : {
          ...createEmptyDraft(new Date().toISOString(), draftId ?? newDraftId()),
          dataMode: "real",
          catalogVersion: "v2-catalog-v1",
          protocols: ["uniswap-v3-swap"],
          positionProtocolsByChain: {},
          aaveV3Reserves: [],
          spokeCapPercent: null,
        },
  );
  const [draft, setDraft] = useState<MandateDraft>(pristine);
  const [saved, setSaved] = useState<MandateDraft | null>(null);
  const [lastBlock, setLastBlock] = useState<StepBlock | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // `update` reads the current draft through a ref rather than through a functional setState, so
  // the reducer runs exactly once per call. A reducer can refuse, and recording that refusal from
  // inside a state updater would be a side effect React is free to run twice.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // PP-INTEGRATION-POINT: the one client read of the draft store. When drafts move to the backend
  // API (wiring issue POO-2132) this becomes the fetch, and `hydrated` keeps its meaning.
  useEffect(() => {
    const stored = draftId ? getDraft(draftId) : null;
    if (stored) {
      setDraft(stored);
      setSaved(stored);
    }
    setHydrated(true);
  }, [draftId]);

  const update = useCallback(
    (fn: (current: MandateDraft) => MandateDraft | { blocked: StepBlock }) => {
      const result = fn(draftRef.current);
      if (isBlocked(result)) {
        setLastBlock(result.blocked);
        return;
      }
      setLastBlock(null);
      draftRef.current = result;
      setDraft(result);
    },
    [],
  );

  const clearBlock = useCallback(() => setLastBlock(null), []);

  const save = useCallback(
    async (name?: string, options?: { complete?: boolean }): Promise<MandateSaveResult> => {
      if (name !== undefined) {
        const error = draftNameError(name);
        if (error) return { ok: false, error };
      }
      const current = draftRef.current;
      if (!isMockMode && options?.complete) {
        try {
          toV2MandateSelection(current, catalog);
        } catch {
          return { ok: false, error: "storage" };
        }
      }
      const now = new Date().toISOString();
      const next: MandateDraft = {
        ...current,
        ...(!isMockMode && options?.complete
          ? { v2Selection: toV2MandateSelection(current, catalog) }
          : {}),
        name: name !== undefined ? name.trim() : current.name,
        savedAt: now,
        // The completion stamp rides on THIS write and is committed to state only when the write
        // landed. A `completedAt` set before the save survives a failed one, and the draft then
        // claims a mandate nothing recorded: no `builder_mandate_completed` fired for it, yet the
        // next Save & exit persists it as finished and a `?phase=build` link opens its Build landing.
        // The first stamp wins, so re-saving a completed mandate does not move its completion time.
        completedAt: options?.complete ? (current.completedAt ?? now) : current.completedAt,
      };
      const stored = upsertDraft(next);
      if (!stored) return { ok: false, error: "storage" };
      draftRef.current = stored;
      setDraft(stored);
      setSaved(stored);
      return { ok: true };
    },
    [catalog],
  );

  const remove = useCallback(() => {
    deleteDraft(draftRef.current.id);
    setSaved(null);
  }, []);

  /**
   * Whether there is unsaved WORK, which is what the leave-page prompt asks about.
   *
   * Not a diff of the whole draft. `lastStep`, `passedSteps`, `poolUniverseCount` and `updatedAt` are
   * bookkeeping: a Next, a Back, a deep link into a step already passed and the Pools step publishing
   * its universe count all change the object without the manager choosing anything, and counting them
   * armed "Your mandate is not saved. Leave anyway?" on a saved draft nobody had touched. A prompt
   * that fires when nothing is at stake is a prompt people learn to click through.
   *
   * The name and the completion stamp are in scope on top of the five selections: both are state a
   * save has to carry, and a rename that never reached storage is exactly as lost as a token.
   */
  const isDirty = useMemo(
    () => unsavedFingerprint(draft) !== unsavedFingerprint(saved ?? pristine),
    [draft, saved, pristine],
  );

  return { draft, catalog, update, save, remove, hydrated, lastBlock, clearBlock, isDirty };
}
