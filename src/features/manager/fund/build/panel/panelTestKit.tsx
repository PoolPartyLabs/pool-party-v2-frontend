/**
 * @id PP-MGR-CMP-061
 * @name panelTestKit
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, test and story support: the harness hands every panel event to the
 *   `onEvent` it is given and emits nothing itself.
 *
 * TEST AND STORY SUPPORT for the configuration panel (POO-2187), as `planTestKit` is for the plan
 * folder. Nothing in the app imports it.
 *
 * - {@link PanelHarness}: the real hooks (`useBuildPlan`, `useBlockSelection`, `usePanelDraft`) and
 *   the real `BlockPanel` in its `BuildPanelSlot`, over an in-memory draft (no storage), so a story
 *   or a test drives the panel exactly as the Build screen mounts it, with the fixture bodies of
 *   `panelFixtures.tsx` by default.
 */
"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MandateCatalog } from "../../mandateCatalog";
import { isBlocked, type MandateDraft } from "../../mandateDraft";
import type { UseMandateDraftResult } from "../../useMandateDraft";
import { useBlockCopy } from "../blocks/blockCopy";
import { TEST_CATALOG } from "../blocks/blockTestKit";
import type { MenuContext } from "../blocks/menuModels";
import { useBlockSelection } from "../blocks/useBlockSelection";
import type { MandateEditStep } from "../blocks/useBuildCanvas";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import type { AllocationCeilingReason } from "../plan/allocationCeiling";
import type { BlockKind, BuildPlan } from "../plan/buildPlan";
import { removeBlockReleasingShare } from "../plan/planReducers";
import { useBuildPlan } from "../plan/useBuildPlan";
import { BlockPanel } from "./BlockPanel";
import type { PanelBodies } from "./panelBodies";
import { FIXTURE_BODIES } from "./panelFixtures";
import { type PanelDraftEvent, panelTarget, usePanelDraft } from "./usePanelDraft";

/** Public props for {@link PanelHarness}. */
export interface PanelHarnessProps {
  /** The mandate, with the plan to start from. */
  draft: MandateDraft;
  plan: BuildPlan;
  catalog?: MandateCatalog;
  /** The block selected on arrival. */
  selectedId?: string | null;
  /** The sentence of a menu open on the canvas (Mode 1). */
  menuSentence?: string | null;
  bodies?: PanelBodies;
  /** The remove confirm starts open (a story). */
  removeConfirmOpen?: boolean;
  /** Once mounted: edit the draft, and optionally try to leave (the notice of P6). */
  scenario?: { share?: number; slippagePct?: number; leave?: boolean };
  onEvent?(event: PanelDraftEvent): void;
  onEditMandate?(step: MandateEditStep): void;
  onLimitHit?(kind: BlockKind, reason: AllocationCeilingReason): void;
  /** Rendered under the panel with the harness's hooks: a button to try leaving, the plan... */
  children?(api: PanelHarnessApi): ReactNode;
}

/** What a test reaches through the harness. */
export interface PanelHarnessApi {
  plan: BuildPlan;
  selectedId: string | null;
  select(id: string | null): boolean;
  guardLeave(proceed: () => void): void;
}

const noop = () => {};

/** The real panel, its draft and its guard, over an in-memory mandate draft. */
export function PanelHarness({
  draft: initial,
  plan: startPlan,
  catalog = TEST_CATALOG,
  selectedId: startSelected = null,
  menuSentence = null,
  bodies = FIXTURE_BODIES,
  removeConfirmOpen: startConfirm = false,
  scenario,
  onEvent = noop,
  onEditMandate = noop,
  onLimitHit = noop,
  children,
}: PanelHarnessProps) {
  const copy = useBlockCopy();
  const [draft, setDraft] = useState<MandateDraft>(() => ({ ...initial, plan: startPlan }));
  const ref = useRef(draft);
  // The draft hook's contract: `fn` runs synchronously on the current draft (useBuildPlan reads it).
  const update = useCallback<UseMandateDraftResult["update"]>((fn) => {
    const next = fn(ref.current);
    if (isBlocked(next)) return;
    ref.current = next;
    setDraft(next);
  }, []);
  const buildPlan = useBuildPlan({ draft, catalog, update });
  const selection = useBlockSelection(startSelected);
  const plan = buildPlan.plan;
  const target = useMemo(
    () => panelTarget(plan, selection.selectedId),
    [plan, selection.selectedId],
  );
  const panel = usePanelDraft({
    target,
    registerGuard: selection.registerGuard,
    applyBlockConfig: buildPlan.applyBlockConfig,
    onEvent,
  });
  const [confirmOpen, setConfirmOpen] = useState(startConfirm);
  const ctx: MenuContext = useMemo(
    () => ({ plan, draft, catalog, violations: buildPlan.violations, copy }),
    [plan, draft, catalog, buildPlan.violations, copy],
  );

  // A story's scenario, once: edit the draft, then try to leave.
  const played = useRef(false);
  useEffect(() => {
    if (played.current || !scenario || !target) return;
    played.current = true;
    if (scenario.share !== undefined) panel.setShare(scenario.share);
    const config = target.applied.config;
    if (scenario.slippagePct !== undefined && config) {
      panel.setConfig({ ...config, slippagePct: scenario.slippagePct });
    }
  }, [scenario, target, panel]);
  const left = useRef(false);
  useEffect(() => {
    if (left.current || !scenario?.leave || !panel.dirty) return;
    left.current = true;
    selection.guardLeave(noop);
  }, [scenario, panel.dirty, selection]);

  return (
    <div className="flex flex-col gap-4">
      <BuildPanelSlot>
        <BlockPanel
          ctx={ctx}
          selectedId={selection.selectedId}
          menuSentence={menuSentence}
          panel={panel}
          removeConfirmOpen={confirmOpen && selection.selectedId !== null}
          onRemoveRequest={() => setConfirmOpen(true)}
          onRemoveCancel={() => setConfirmOpen(false)}
          onRemoveConfirm={() => {
            const id = selection.selectedId;
            setConfirmOpen(false);
            if (!id) return;
            panel.reset();
            if (!selection.select(null)) return;
            buildPlan.apply((current, context) => removeBlockReleasingShare(current, context, id));
          }}
          onEditMandate={(step) => selection.guardLeave(() => onEditMandate(step))}
          onLimitHit={onLimitHit}
          bodies={bodies}
        />
      </BuildPanelSlot>
      {children?.({
        plan,
        selectedId: selection.selectedId,
        select: selection.select,
        guardLeave: selection.guardLeave,
      })}
    </div>
  );
}
