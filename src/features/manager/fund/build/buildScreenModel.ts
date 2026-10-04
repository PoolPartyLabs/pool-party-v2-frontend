/**
 * @id PP-MGR-SCR-002
 * @name buildScreenModel
 * @implements-rules-version v1 (POO-2157 rules v1)
 * @analytics-events none, a pure module: it decides which refusal applies and what to reveal, and
 *   the Build screen ({@link BuildScreen}) emits `builder_build_blocked` with the matching reason
 *   through `buildAnalytics.ts`.
 *
 * The decisions of the Build screen that need no DOM (slice S7, POO-2157), rides on PP-MGR-SCR-002:
 *
 * ## Next: Review (handoff AN4, coordinator default D19)
 *
 * The button is never disabled. A press checks the plan in a fixed order and answers with the FIRST
 * check that fails, so the manager is told one thing to fix, the earliest:
 *
 * 1. the plan is empty (no card anywhere; a spoke with no chain holds no block);
 * 2. a block or a network the mandate no longer holds (D6), or a plan the reducers could never have
 *    produced (a broken sequence, a missing or orphaned Swap · auto, a chain with no card): the
 *    closed union has no closer reason for those, and none is reachable through the canvas;
 *    `validatePlan` lists them only for a stored plan edited by hand;
 * 3. a coming-soon block (C22);
 * 4. an empty block, one nobody configured (G6: every block a manager adds arrives empty);
 * 5. shares that add up to more than the capital above them (C8, INV3);
 * 6. otherwise Review is not available yet: the Review handoff has not arrived.
 *
 * Each refusal carries the block to bring into view (the first one in reading order: the plan's own
 * order, hub first, then the spokes, top to bottom), or null when the fault is not one block.
 *
 * ## Reveal after a change (I9)
 *
 * After an add, an insert or a remove the viewport keeps the new or selected block in view without a
 * jump: it pans the minimum (`revealRect`, S2), and only when something actually appeared or the
 * selection moved. A remove clears the selection, so it reveals nothing.
 */
import type { GraphLayout, Rect } from "./layout/graphTypes";
import type { BuildPlan } from "./plan/buildPlan";
import { chainsWithNetwork, findBlock } from "./plan/planDerive";
import type { PlanViolation, PlanViolationCode } from "./plan/planInvariants";

/** Next: Review's refusals, in the order the checks run (D19). */
export const REVIEW_REFUSALS = [
  "review_empty_plan",
  "review_invalid_block",
  "review_coming_soon_block",
  "review_empty_block",
  "review_over_share",
  "review_unavailable",
] as const;

export type ReviewRefusal = (typeof REVIEW_REFUSALS)[number];

/** The `fundBuilder.canvas.review.*` notice of each refusal: one key each, no key twice. */
export type ReviewNoticeKey =
  | "emptyPlan"
  | "invalidBlock"
  | "comingSoon"
  | "emptyBlock"
  | "overShare"
  | "unavailable";

export const REVIEW_NOTICE_KEY: Readonly<Record<ReviewRefusal, ReviewNoticeKey>> = {
  review_empty_plan: "emptyPlan",
  review_invalid_block: "invalidBlock",
  review_coming_soon_block: "comingSoon",
  review_empty_block: "emptyBlock",
  review_over_share: "overShare",
  review_unavailable: "unavailable",
};

/** What a refusal points at: a card, a chain (its first card) or a spoke's group. */
export type ReviewTarget =
  | { kind: "block"; blockId: string }
  | { kind: "chain"; chainId: string }
  | { kind: "network"; network: string };

export interface ReviewVerdict {
  refusal: ReviewRefusal;
  /** The first offending block, to bring into view; null when the fault is not one block. */
  target: ReviewTarget | null;
}

/**
 * Which check a violation fails. Total over `PlanViolationCode`, so a new invariant code fails to
 * compile here instead of slipping past Next: Review.
 */
const VIOLATION_CHECK: Readonly<
  Record<
    PlanViolationCode,
    "review_invalid_block" | "review_coming_soon_block" | "review_over_share"
  >
> = {
  network_not_in_mandate: "review_invalid_block",
  duplicate_network: "review_invalid_block",
  kind_not_in_mandate: "review_invalid_block",
  kind_not_on_network: "review_invalid_block",
  config_not_in_mandate: "review_invalid_block",
  // Not reachable through the reducers (see the file header): a hand-edited stored plan only.
  chain_without_position: "review_invalid_block",
  sequence: "review_invalid_block",
  orphan_auto: "review_invalid_block",
  missing_auto: "review_invalid_block",
  kind_coming_soon: "review_coming_soon_block",
  share_exceeds_parent: "review_over_share",
  negative_share: "review_over_share",
};

/** A violation's `targetId` as a target: a block, a chain or a spoke network of this plan. */
function resolveTarget(plan: BuildPlan, targetId: string | null): ReviewTarget | null {
  if (targetId === null) return null;
  if (findBlock(plan, targetId)) return { kind: "block", blockId: targetId };
  if (chainsWithNetwork(plan).some(({ chain }) => chain.id === targetId)) {
    return { kind: "chain", chainId: targetId };
  }
  if (plan.spokes.some((spoke) => spoke.network === targetId)) {
    return { kind: "network", network: targetId };
  }
  return null;
}

/** The plan's position blocks, in reading order. */
function positions(plan: BuildPlan) {
  return chainsWithNetwork(plan).flatMap(({ chain }) =>
    chain.steps.filter((step) => step.family === "position"),
  );
}

/** [AN4, D19] What Next: Review answers for this plan and its violations. */
export function reviewVerdict(
  plan: BuildPlan,
  violations: readonly PlanViolation[],
): ReviewVerdict {
  const cards = positions(plan);
  if (cards.length === 0) return { refusal: "review_empty_plan", target: null };

  for (const check of ["review_invalid_block", "review_coming_soon_block"] as const) {
    const first = violations.find((violation) => VIOLATION_CHECK[violation.code] === check);
    if (first) return { refusal: check, target: resolveTarget(plan, first.targetId) };
  }

  const empty = cards.find((card) => card.config === null);
  if (empty) return { refusal: "review_empty_block", target: { kind: "block", blockId: empty.id } };

  const share = violations.find(
    (violation) => VIOLATION_CHECK[violation.code] === "review_over_share",
  );
  if (share) return { refusal: "review_over_share", target: resolveTarget(plan, share.targetId) };

  return { refusal: "review_unavailable", target: null };
}

/** Where a target sits in the laid-out graph, or null when it is not drawn. */
export function targetRect(layout: GraphLayout, target: ReviewTarget | null): Rect | null {
  if (!target) return null;
  switch (target.kind) {
    case "block":
      return layout.blocks.find((block) => block.id === target.blockId)?.rect ?? null;
    case "chain":
      return layout.blocks.find((block) => block.chainId === target.chainId)?.rect ?? null;
    case "network":
      return layout.groups.find((group) => group.network === target.network)?.rect ?? null;
  }
}

/** The smallest rect holding every rect given. */
function bounds(rects: readonly Rect[]): Rect | null {
  const [first, ...rest] = rects;
  if (!first) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;
  for (const rect of rest) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** One state of the canvas: its layout and its selection. */
export interface CanvasState {
  layout: GraphLayout;
  selectedId: string | null;
}

/**
 * [I9] The rect to reveal after a change from `before` to `after`, or null when nothing should move.
 *
 * In order: a block that is new AND selected (a block just added from a menu, the palette or a port
 * arrives selected); otherwise every new block together (an inserted flow pill, an Undo bringing a
 * block back); otherwise a new spoke group (a network just added); otherwise a block the manager
 * just selected. A remove leaves no new block and clears the selection: nothing is revealed.
 */
export function revealTarget(before: CanvasState, after: CanvasState): Rect | null {
  const had = new Set(before.layout.blocks.map((block) => block.id));
  const added = after.layout.blocks.filter((block) => !had.has(block.id));
  const selected = after.selectedId
    ? after.layout.blocks.find((block) => block.id === after.selectedId)
    : undefined;

  if (selected && added.some((block) => block.id === selected.id)) return selected.rect;
  if (added.length > 0) return bounds(added.map((block) => block.rect));

  const hadGroup = new Set(before.layout.groups.map((group) => group.network));
  const group = after.layout.groups.find((candidate) => !hadGroup.has(candidate.network));
  if (group) return group.rect;

  if (selected && after.selectedId !== before.selectedId) return selected.rect;
  return null;
}
