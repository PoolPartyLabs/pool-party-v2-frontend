/**
 * @id PP-MGR-CMP-066
 * @name RemoveBlockConfirm
 * @implements-rules-version v1 (POO-2187 rules v1; POO-2210 rules v1)
 * @analytics-events none, presentational. The confirmed remove reports `builder_block_removed`
 *   (with `cascade_count`) through the canvas controller; the Build screen (PP-MGR-SCR-002) emits it.
 *
 * Shared removal content (handoff P10, decision DP11), shown in the BuildScreen modal since
 * POO-2210. Standalone panel stories may also render this box (radius 12, `surface-raised`, padding 16, gap 8): the
 * title "Remove <block title>?", a sentence saying what happens to its share and to what depends on
 * it, and two pills, "Cancel" (outline) and "Remove block" (outline in `destructive`, as drawn).
 * Remove ALWAYS asks, from the panel and from the Delete key; the canvas batch's Undo toast is gone.
 *
 * {@link removalText} builds the words from `describeRemoval` (PP-MGR-LIB-026), which is computed
 * from the real remove, so the sentence names only what exists: the share part only when the block
 * holds a share ("Its 60% goes back to Idle input."), then the steps that go with it (its
 * Swap · auto, its Collect fees, the Borrow under it and what hangs under that Borrow). An empty
 * block reads "Remove this block?" with no second sentence (proposal of the handoff).
 *
 * On open, focus goes to Cancel: the safe answer is the one under the keyboard.
 */
"use client";

import { useEffect, useRef } from "react";
import { shareNumber } from "../blocks/blockRegistry";
import type { Step } from "../plan/buildPlan";
import type { RemovalDescription } from "../plan/planReducers";
import type { PanelCopy } from "./panelCopy";
import { OUTLINE_PILL, OUTLINE_PILL_DESTRUCTIVE } from "./panelStyles";

/** What the confirm says. */
export interface RemovalText {
  title: string;
  /** Null for an empty block, or a block whose remove takes nothing else and returns no share. */
  sentence: string | null;
}

/** The first letter in upper case, in the locale's own rules ("its" starts a sentence as "Its"). */
function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/**
 * P10: the title and sentence of the confirm, from what the remove really does. `stepTitle` names a
 * position removed with the block (its card title, "Borrow USDC"); `listNames` joins names in the
 * locale's own conjunction.
 */
export function removalText(input: {
  description: RemovalDescription;
  blockTitle: string;
  stepTitle(step: Step): string;
  copy: PanelCopy["confirm"];
  listNames(names: readonly string[]): string;
  locale: string;
}): RemovalText {
  const { description, blockTitle, stepTitle, copy, listNames, locale } = input;
  if (description.empty) return { title: copy.titleEmpty, sentence: null };
  const parts: string[] = [];
  if (description.returnedPct > 0) parts.push(copy.share(shareNumber(description.returnedPct)));
  const names = description.removedWith.map((step) => {
    if (step.family === "flow") {
      if (step.kind === "collectFees") return copy.collectFees;
      return step.auto ? copy.swapAuto : copy.swap;
    }
    return copy.block(stepTitle(step));
  });
  if (names.length > 0) {
    parts.push(capitalize(copy.removedWith(listNames(names), names.length), locale));
  }
  return { title: copy.title(blockTitle), sentence: parts.length > 0 ? parts.join(" ") : null };
}

/** Public props for {@link RemoveBlockConfirm}. */
export interface RemoveBlockConfirmProps {
  /** "Remove WETH / USDC?", or "Remove this block?". */
  title: string;
  /** What else goes, or null. */
  sentence: string | null;
  /** "Cancel". */
  cancelLabel: string;
  /** "Remove block". */
  removeLabel: string;
  onCancel(): void;
  onConfirm(): void;
}

/** The shared remove confirmation content (P10, POO-2210). */
export function RemoveBlockConfirm({
  title,
  sentence,
  cancelLabel,
  removeLabel,
  onCancel,
  onConfirm,
}: RemoveBlockConfirmProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      data-panel-remove-confirm=""
      className="flex flex-col items-start gap-2 rounded-xl bg-surface-raised p-4"
    >
      <p className="font-medium text-foreground text-sm">{title}</p>
      {sentence ? <p className="text-muted-foreground text-xs">{sentence}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={OUTLINE_PILL}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} className={OUTLINE_PILL_DESTRUCTIVE}>
          {removeLabel}
        </button>
      </div>
    </div>
  );
}
