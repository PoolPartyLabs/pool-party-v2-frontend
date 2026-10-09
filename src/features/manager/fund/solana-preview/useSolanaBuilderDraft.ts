/**
 * @id PP-MGR-HOK-024
 * @name useSolanaBuilderDraft
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, shared shell owns local save and failure events.
 */
"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { planFingerprint } from "../build/plan/planStorage";
import {
  draftNameError,
  isBlocked,
  type MandateDraft,
  type StepBlock,
  selectionFingerprint,
} from "../mandateDraft";
import type { UseMandateDraftResult } from "../useMandateDraft";
import { buildSolanaBuilderCatalog, createSolanaBuilderDraft } from "./solanaBuilderRuntime";

const fingerprint = (draft: MandateDraft) =>
  `${draft.name ?? ""}|${draft.completedAt ?? ""}|${selectionFingerprint(draft)}|${planFingerprint(draft.plan)}|${JSON.stringify(draft.review ?? null)}`;
/** Session acknowledgement only. No localStorage, wallet, API, upload or launch is mounted. */
export function useSolanaBuilderDraft(): UseMandateDraftResult {
  const catalog = useMemo(buildSolanaBuilderCatalog, []);
  const [pristine] = useState(() =>
    createSolanaBuilderDraft(new Date().toISOString(), `solana-local:${crypto.randomUUID()}`),
  );
  const [draft, setDraft] = useState(pristine);
  const current = useRef(draft);
  current.current = draft;
  const [saved, setSaved] = useState<MandateDraft | null>(null);
  const [lastBlock, setLastBlock] = useState<StepBlock | null>(null);
  const update = useCallback<UseMandateDraftResult["update"]>((fn) => {
    const next = fn(current.current);
    if (isBlocked(next)) {
      setLastBlock(next.blocked);
      return;
    }
    current.current = next;
    setDraft(next);
    setLastBlock(null);
  }, []);
  const save = useCallback<UseMandateDraftResult["save"]>(async (name, options) => {
    if (name !== undefined) {
      const error = draftNameError(name);
      if (error) return { ok: false, error };
    }
    const now = new Date().toISOString();
    const next = {
      ...current.current,
      name: name === undefined ? current.current.name : name.trim(),
      savedAt: now,
      completedAt: options?.complete
        ? (current.current.completedAt ?? now)
        : current.current.completedAt,
    };
    current.current = next;
    setDraft(next);
    setSaved(structuredClone(next));
    return { ok: true };
  }, []);
  return {
    draft,
    catalog,
    update,
    save,
    remove: () => {
      current.current = pristine;
      setDraft(pristine);
      setSaved(null);
    },
    hydrated: true,
    lastBlock,
    clearBlock: () => setLastBlock(null),
    isDirty: fingerprint(draft) !== fingerprint(saved ?? pristine),
  };
}
