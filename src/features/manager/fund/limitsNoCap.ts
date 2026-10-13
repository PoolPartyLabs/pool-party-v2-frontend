/**
 * @id PP-MGR-LIB-097
 * @name limitsNoCap
 * @implements-rules-version v1 (POO-2349 rules v1)
 * @analytics-events none. The row "No cap" sends no event today, so the section box sends none.
 *
 * POO-2349 [R2] / [R3] / [R4]: the "No cap" box at the head of each Limits group, as pure functions
 * over the draft. The Limits step (PP-MGR-CMP-039) holds no rule of its own, and a unit test covers
 * each rule without rendering a component.
 *
 * ## One move, two scales
 *
 * The section box does to every row what the row box does to one row. `toggleNoCap` is the row
 * move (moved here from the step, with no change), and {@link setSectionNoCap} applies it only to
 * the rows that are not yet in the target state. So a clear section box leaves each row exactly
 * where a clear row box leaves it: a row with a stored share returns to it, and in real data mode a
 * row with no stored share returns to unset, never to 0%.
 *
 * ## The three states
 *
 * The box is derived from the rows, never stored: checked when every row has No cap, mixed when
 * only some have it, clear when none has it. An unset row (real data mode) has no No cap. A group
 * with no rows has no box.
 */
import {
  allTokensCapOf,
  clearCap,
  effectiveCap,
  type MandateCap,
  type MandateDraft,
  setAllTokensCap,
  setCap,
} from "./mandateDraft";

/** The three groups on the Limits step that hold one cap record per row. */
export type CapScope = "networks" | "protocols" | "tokens";

/** R3: what the section box shows. "none" means the group has no row and so no box. */
export type SectionNoCapState = "checked" | "mixed" | "clear" | "none";

/**
 * What the "No cap" box of ONE row does, in both directions.
 *
 * Ticking is the easy half: the row keeps whatever share it had, so un-ticking can give it back.
 * Un-ticking is where the three states matter. A row that HAD a share returns to it. A row that had
 * none goes back to UNSET rather than to `{ noCap: false, pct: 0 }`, because 0% is a deliberate
 * answer ("this network may hold nothing") that `validateStep` accepts: writing it here would let
 * Next through on a ceiling nobody chose, one click after the manager said they wanted no ceiling at
 * all. `pct` is 0 exactly when no share was ever stored, which is why that is the test.
 */
export function toggleNoCap(
  draft: MandateDraft,
  scope: CapScope,
  id: string,
  cap: MandateCap | undefined,
): MandateDraft {
  const noCap = cap?.noCap ?? false;
  const pct = cap?.pct ?? 0;
  if (!noCap) return setCap(draft, scope, id, { noCap: true, pct });
  // PP-NOTE: assumption (coordinator default). `pct > 0` also swallows a DELIBERATE 0%: capped at
  // 0%, ticked, then unticked, and the row is unset rather than back at 0%. `{ noCap: true, pct: 0 }`
  // is what both a chosen 0% and an untouched row leave behind, so the draft cannot tell them apart,
  // and this reading is the one that fails closed: Next is refused for a missing cap and the manager
  // sets the slider again. The alternative lets Next through on a ceiling nobody chose. Pinned by
  // "forgets a deliberate 0% cap across a No cap round trip" in `LimitsStep.test.tsx`.
  return pct > 0 ? setCap(draft, scope, id, { noCap: false, pct }) : clearCap(draft, scope, id);
}

/** R3: the state of the section box, from the caps its rows show now. */
export function sectionNoCapState(caps: readonly (MandateCap | undefined)[]): SectionNoCapState {
  if (caps.length === 0) return "none";
  const withNoCap = caps.filter((cap) => cap?.noCap === true).length;
  if (withNoCap === 0) return "clear";
  return withNoCap === caps.length ? "checked" : "mixed";
}

/** R4: the caps the rows of one group show now, in row order. Read from the draft, so a row change moves the box. */
export function sectionCapsOf(
  draft: MandateDraft,
  scope: CapScope,
  ids: readonly string[],
): (MandateCap | undefined)[] {
  return ids.map((id) => effectiveCap(draft, scope, id));
}

/**
 * R2: the section box, pressed. `checked` is the state that the press asks for.
 *
 * Checking gives No cap to each row that does not have it. Clearing gives each row that has it the
 * state of a clear row box (see {@link toggleNoCap}). A row already in the target state is not
 * touched. `realMode` is true in real data mode, where an unset row is a real state.
 */
export function setSectionNoCap(
  draft: MandateDraft,
  scope: CapScope,
  ids: readonly string[],
  checked: boolean,
  realMode: boolean,
): MandateDraft {
  let next = draft;
  for (const id of ids) {
    const cap = effectiveCap(next, scope, id);
    const noCap = cap?.noCap ?? false;
    if (noCap === checked) continue;
    next =
      !checked && realMode
        ? toggleNoCap(next, scope, id, cap)
        : // Mock builder: a ticked box keeps the share, an unticked one gives it back (R8, R11).
          setCap(next, scope, id, { noCap: checked, pct: cap?.pct ?? 0 });
  }
  return next;
}

/** R2 for All tokens mode, where the Per token group has the one "Every token" row. */
export function setEveryTokenNoCap(draft: MandateDraft, checked: boolean): MandateDraft {
  const cap = allTokensCapOf(draft);
  return cap.noCap === checked ? draft : setAllTokensCap(draft, { noCap: checked, pct: cap.pct });
}
