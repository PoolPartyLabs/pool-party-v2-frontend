/**
 * @id PP-MGR-HOK-014
 * @name usePanelDraft
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none emitted here: every outcome leaves through `onEvent` as a
 *   {@link PanelDraftEvent} (configured, applied with the fields changed, discarded, leaveBlocked,
 *   blocked with the reducer's reason). The Build screen (PP-MGR-SCR-002) maps them to
 *   `builder_block_configured`, `builder_block_applied`, `builder_block_discarded`,
 *   `builder_block_leave_blocked` and `builder_build_blocked`, as it does for the canvas controller.
 *
 * The draft of the selected block in the configuration panel (handoff P3, P5, P6, P7; decision DP1):
 * per selected block `{ applied, draft, dirty, leaveBlocked }`.
 *
 * - [P3] The panel edits a DRAFT. `applied` is what the plan holds (the canvas keeps showing it);
 *   `draft` is the applied values until a field changes them. `dirty` is the draft differing from
 *   applied, by value: moving a slider away and back is not a change.
 * - [P7, DP1] `use(config)` writes the kind's defaults as the APPLIED config, with a share of 0% for
 *   the block that carries its chain's Allocation, so the status row reads "All changes applied".
 * - `apply()` writes the draft through `useBuildPlan().applyBlockConfig` (one atomic reducer: the
 *   config, the chain's share and, on a spoke, the spoke's share, DP3). A refusal keeps the draft.
 *   `discard()` drops it.
 * - [P6] While dirty, it refuses every selection change and every way out of the step, through a
 *   `SelectionGuard` registered with `useBlockSelection`: the selection stays, `leaveBlocked` turns
 *   on and `leaveAttempt` counts the refusal (the notice comes back into view on each one). The
 *   refused change is kept as the pending RESUME (finding 10) and runs once Apply changes or Discard
 *   changes SETTLED (an effect after the render that shows the new state), so both exits of the
 *   notice complete the navigation that was stopped.
 * - `reset()` drops the draft quietly, for the remove confirm: a block the manager removes takes its
 *   unapplied changes with it, and nothing resumes.
 * - Selecting another block starts that block's draft from its applied values.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NetworkId } from "../../mandateDraft";
import type { RefusedChange, SelectionGuard } from "../blocks/useBlockSelection";
import type {
  AaveBlockConfig,
  BlockKind,
  BuildPlan,
  PlanBlockReason,
  PoolBlockConfig,
} from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import type { UseBuildPlanResult } from "../plan/useBuildPlan";

/** A block's configuration, either shape. */
export type PanelBlockConfig = PoolBlockConfig | AaveBlockConfig;

/** What the panel edits for one block. */
export interface PanelValues {
  /** Null for an empty block (Modes 2 and 3). */
  config: PanelBlockConfig | null;
  /** The chain's share when this block carries its Allocation (P8); null otherwise. */
  sharePct: number | null;
}

/** A field of the panel, as `builder_block_applied` names it. */
export type PanelField = "pool" | "asset" | "range" | "quote" | "slippage" | "allocation";

/** The order `fields` is reported in. */
const FIELD_ORDER: readonly PanelField[] = [
  "pool",
  "asset",
  "range",
  "quote",
  "slippage",
  "allocation",
];

/** Which panel field a config key belongs to. A key a body adds later counts as no field. */
const FIELD_OF_KEY: Readonly<Record<string, PanelField>> = {
  poolId: "pool",
  assetKey: "asset",
  tickLower: "range",
  tickUpper: "range",
  fullRange: "range",
  displayInverted: "quote",
  slippagePct: "slippage",
};

/** What happened in the panel, for the Build screen to map to analytics. */
export type PanelDraftEvent =
  | { type: "configured"; kind: BlockKind; network: NetworkId }
  | { type: "applied"; kind: BlockKind; fields: PanelField[] }
  | { type: "discarded"; kind: BlockKind }
  | { type: "leaveBlocked"; kind: BlockKind }
  | { type: "blocked"; reason: PlanBlockReason };

/** The selected block, as the panel needs it. */
export interface PanelDraftTarget {
  blockId: string;
  kind: BlockKind;
  network: NetworkId;
  /** What the plan holds for it now. */
  applied: PanelValues;
}

export interface UsePanelDraftInput {
  /** The selected position block, or null. */
  target: PanelDraftTarget | null;
  /** `useBlockSelection().registerGuard`. */
  registerGuard(guard: SelectionGuard): () => void;
  /** `useBuildPlan().applyBlockConfig`. */
  applyBlockConfig: UseBuildPlanResult["applyBlockConfig"];
  onEvent(event: PanelDraftEvent): void;
}

export interface UsePanelDraftResult {
  applied: PanelValues | null;
  draft: PanelValues | null;
  /** The draft differs from applied (P5). */
  dirty: boolean;
  /** A change was refused while dirty and the notice shows (P6). */
  leaveBlocked: boolean;
  /** Counts the refusals, so the notice comes back into view on each one. */
  leaveAttempt: number;
  setConfig(config: PanelBlockConfig): void;
  setShare(pct: number): void;
  /** P7, DP1: Use writes the kind's defaults as applied, share 0%. True when the plan took it. */
  use(config: PanelBlockConfig): boolean;
  /** Apply changes. True when the plan took it. */
  apply(): boolean;
  /** Discard changes. */
  discard(): void;
  /** Drop the draft quietly (the remove confirm): no event, nothing resumes. */
  reset(): void;
}

/** Two configs hold the same values (every field is a primitive). */
function sameConfig(a: PanelBlockConfig | null, b: PanelBlockConfig | null): boolean {
  if (a === null || b === null) return a === b;
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/** Two panel values are the same: the config by value, and the share. */
export function samePanelValues(a: PanelValues | null, b: PanelValues | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sharePct === b.sharePct && sameConfig(a.config, b.config);
}

/** The panel fields an Apply changes, in a fixed order. */
export function changedFields(before: PanelValues, after: PanelValues): PanelField[] {
  const changed = new Set<PanelField>();
  const left = (before.config ?? {}) as Record<string, unknown>;
  const right = (after.config ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const field = FIELD_OF_KEY[key];
    if (field && left[key] !== right[key]) changed.add(field);
  }
  if (before.sharePct !== after.sharePct) changed.add("allocation");
  return FIELD_ORDER.filter((field) => changed.has(field));
}

/**
 * What the panel edits for a selected block, read from the applied plan: its config, and its
 * chain's share when it is the chain's first position (only that block has an Allocation, P8).
 * Null for nothing selected, a pill or an id the plan does not hold.
 */
export function panelTarget(plan: BuildPlan, blockId: string | null): PanelDraftTarget | null {
  if (blockId === null) return null;
  const found = findBlock(plan, blockId);
  if (found?.block.family !== "position") return null;
  const first = found.chain.steps.find((step) => step.family === "position");
  return {
    blockId,
    kind: found.block.kind,
    network: found.network,
    applied: {
      config: found.block.config,
      sharePct: first?.id === blockId ? found.chain.sharePct : null,
    },
  };
}

/** The panel's draft of the selected block (P3, P5, P6, P7). */
export function usePanelDraft(input: UsePanelDraftInput): UsePanelDraftResult {
  const { target, registerGuard } = input;
  const blockId = target?.blockId ?? null;

  const [override, setOverride] = useState<{ blockId: string; values: PanelValues } | null>(null);
  const [leave, setLeave] = useState<{ blockId: string; attempt: number } | null>(null);
  const [resumeTick, setResumeTick] = useState(0);

  const applied = target?.applied ?? null;
  const draft = override && override.blockId === blockId ? override.values : applied;
  const dirty = draft !== null && !samePanelValues(draft, applied);
  const leaveBlocked = dirty && leave !== null && leave.blockId === blockId;

  // Handlers and the guard read the latest values: the guard is registered once, and a resume runs
  // after the render that settled the panel.
  const latest = useRef({ input, target, draft, dirty });
  latest.current = { input, target, draft, dirty };
  /** The refused change, kept until Apply changes or Discard changes (P6). */
  const pending = useRef<RefusedChange | null>(null);
  /** The change to run once the settled render committed. */
  const toResume = useRef<RefusedChange | null>(null);

  const emit = useCallback((event: PanelDraftEvent) => latest.current.input.onEvent(event), []);

  // [P6] One guard for the life of the panel: it refuses while the draft differs from applied.
  useEffect(
    () =>
      registerGuard({
        allowChange: () => !latest.current.dirty,
        onRefused: (change) => {
          const current = latest.current.target;
          if (!current) return;
          pending.current = change;
          setLeave((before) => ({
            blockId: current.blockId,
            attempt: (before?.blockId === current.blockId ? before.attempt : 0) + 1,
          }));
          emit({ type: "leaveBlocked", kind: current.kind });
        },
      }),
    [registerGuard, emit],
  );

  // Another block (or none): its draft starts from its applied values, and nothing is pending.
  useEffect(() => {
    pending.current = null;
    setLeave(null);
    setOverride((before) => (before && before.blockId !== blockId ? null : before));
  }, [blockId]);

  // [P6] The blocked navigation runs once the panel settled (finding 10).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tick is the trigger.
  useEffect(() => {
    const change = toResume.current;
    if (!change) return;
    toResume.current = null;
    change.resume();
  }, [resumeTick]);

  /** The draft is the applied values again; the pending change (if any) runs after the render. */
  const settle = useCallback((resume: boolean) => {
    latest.current.dirty = false;
    setOverride(null);
    setLeave(null);
    const change = pending.current;
    pending.current = null;
    if (resume && change) {
      toResume.current = change;
      setResumeTick((tick) => tick + 1);
    }
  }, []);

  const edit = useCallback((next: (values: PanelValues) => PanelValues) => {
    const { target: current, draft: values } = latest.current;
    if (!current || !values) return;
    const edited = next(values);
    setOverride({ blockId: current.blockId, values: edited });
    // Back to the applied values by hand: nothing is blocked any more, and nothing will resume.
    if (samePanelValues(edited, current.applied)) {
      pending.current = null;
      setLeave(null);
    }
  }, []);

  const setConfig = useCallback(
    (config: PanelBlockConfig) => edit((values) => ({ ...values, config })),
    [edit],
  );

  const setShare = useCallback(
    (pct: number) =>
      edit((values) => (values.sharePct === null ? values : { ...values, sharePct: pct })),
    [edit],
  );

  const use = useCallback(
    (config: PanelBlockConfig): boolean => {
      const { target: current, input: io } = latest.current;
      if (!current) return false;
      const share = current.applied.sharePct === null ? undefined : 0;
      const outcome = io.applyBlockConfig(current.blockId, config, share);
      if (!outcome.ok) {
        emit({ type: "blocked", reason: outcome.blocked.reason });
        return false;
      }
      settle(false);
      emit({ type: "configured", kind: current.kind, network: current.network });
      return true;
    },
    [emit, settle],
  );

  const apply = useCallback((): boolean => {
    const { target: current, draft: values, dirty: changed, input: io } = latest.current;
    if (!current || !values || !changed || values.config === null) return false;
    const fields = changedFields(current.applied, values);
    const outcome = io.applyBlockConfig(
      current.blockId,
      values.config,
      values.sharePct === null ? undefined : values.sharePct,
    );
    if (!outcome.ok) {
      emit({ type: "blocked", reason: outcome.blocked.reason });
      return false;
    }
    settle(true);
    emit({ type: "applied", kind: current.kind, fields });
    return true;
  }, [emit, settle]);

  const discard = useCallback(() => {
    const { target: current, dirty: changed } = latest.current;
    if (!current || !changed) return;
    settle(true);
    emit({ type: "discarded", kind: current.kind });
  }, [emit, settle]);

  const reset = useCallback(() => {
    pending.current = null;
    toResume.current = null;
    latest.current.dirty = false;
    setOverride(null);
    setLeave(null);
  }, []);

  return {
    applied,
    draft,
    dirty,
    leaveBlocked,
    leaveAttempt: leaveBlocked && leave ? leave.attempt : 0,
    setConfig,
    setShare,
    use,
    apply,
    discard,
    reset,
  };
}
