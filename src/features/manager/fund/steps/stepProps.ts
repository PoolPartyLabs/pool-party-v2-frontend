/**
 * @id PP-MGR-SCR-002
 * @name stepProps
 * @implements-rules-version v1
 * @implements-rules-version v1 (POO-2332 rules v1)
 * @analytics-events none, the step bodies report blocked intents through `onBlocked` and the shell emits
 *
 * The one contract between the fund builder shell (`FundStrategyBuilderScreen`) and its five Mandate
 * step bodies (POO-2119, S2 to S6). A step receives the draft and the catalog, writes through
 * `update` (a reducer that may refuse with `{ blocked }`), renders the inline notice for `block` when
 * it is its own, and reports its own blocked intents through `onBlocked` so the shell owns every
 * `builder_mandate_blocked` emission. POO-2332 adds one optional report, `onTokenModeChange`, so the
 * shell also owns `builder_mandate_token_mode_changed`. Nothing else crosses this boundary.
 */

import type { MandateCatalog } from "../mandateCatalog";
import type { MandateDraft, MandateTokenMode, StepBlock } from "../mandateDraft";

/** Props every Mandate step body takes, and nothing more. */
export interface MandateStepProps {
  /** The working draft. */
  draft: MandateDraft;
  /** The catalog the draft was built against (availability, deposit tokens, token lists). */
  catalog: MandateCatalog;
  /** Apply a reducer; a `{ blocked }` result leaves the draft unchanged and surfaces as `block`. */
  update: (fn: (draft: MandateDraft) => MandateDraft | { blocked: StepBlock }) => void;
  /** The block the shell is currently showing, if any; a step renders it only when `block.step` is its own key. */
  block: StepBlock | null;
  /** Report a blocked intent raised inside the step (a disabled row clicked, an add refused). */
  onBlocked: (block: StepBlock) => void;
  /**
   * POO-2332 R13: goes up by one each time the shell reports a refusal. The Limits step reads it, so
   * a second press on Next with the same block scrolls and blinks the row again.
   */
  blockSeq?: number;
  /**
   * POO-2332 R15: report a token access mode change that the step already wrote through `update`.
   * Only the Tokens step calls it. The shell sends `builder_mandate_token_mode_changed`.
   */
  onTokenModeChange?: (mode: MandateTokenMode) => void;
}
