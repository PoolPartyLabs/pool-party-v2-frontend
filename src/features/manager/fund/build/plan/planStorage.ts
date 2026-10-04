/**
 * @id PP-MGR-LIB-021
 * @name planStorage
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure storage helper; the store and the builder shell own the events.
 *
 * The plan rides inside the mandate draft (same store, same Save & exit, same resume on reload, as
 * R9 of the Mandate handoff). These two helpers are what the draft store and the draft hook need to
 * carry it:
 *
 * - {@link normalizePlan} is the READ check. A stored plan comes back through JSON and may have been
 *   written by another build, so its SHAPE is checked before any screen touches it. It is a
 *   structural check only: a plan that names a pool or a network the mandate no longer holds is
 *   still a plan, and `validatePlan` reports those (coordinator default D6). Anything else unreadable
 *   is null: the store then keeps the draft WITHOUT the plan, marks it `planUnreadable`, and keeps the
 *   raw plan in storage untouched until a save with a new plan replaces it (PR #31 review, F1).
 * - {@link planFingerprint} is what the unsaved check compares (D17), so a plan edit arms the leave
 *   prompt. No plan and the empty plan are the same work, so they fingerprint the same.
 *
 * PP-INTEGRATION-POINT: the plan is stored as part of the mandate draft in the browser store
 * (`mandateDraftStore`, PP-MGR-STO-001). When drafts move to the backend draft API (wiring issue
 * POO-2132) the plan travels in the same payload, and this read check stays the gate it passes.
 */
import { isConfigFor } from "./blockConfig";
import {
  type BlockKind,
  BUILD_PLAN_VERSION,
  type BuildPlan,
  createEmptyPlan,
  type FlowKind,
} from "./buildPlan";

const POSITION_KINDS: ReadonlySet<string> = new Set<BlockKind>([
  "uniswapV4Pool",
  "aaveSupply",
  "aaveBorrow",
  "uniswapV3Pool",
  "pendle",
  "gmxPerp",
]);

const FLOW_KINDS: ReadonlySet<string> = new Set<FlowKind>(["swap", "collectFees"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A stored step. A position's `config` must be one its kind takes (`isConfigFor`, PP-MGR-LIB-026):
 * the right shape, `poolId` xor `assetKey`, and every field of the panel contract it carries of the
 * right type and range, so a malformed config makes the plan unreadable while a config still being
 * filled in (a pool with no range yet) reads. Extra fields are kept (panel batch).
 */
function isStep(value: unknown): boolean {
  if (!isRecord(value) || !isId(value.id)) return false;
  if (value.family === "position") {
    return (
      typeof value.kind === "string" &&
      POSITION_KINDS.has(value.kind) &&
      "config" in value &&
      isConfigFor(value.kind, value.config)
    );
  }
  if (value.family === "flow") {
    return (
      typeof value.kind === "string" &&
      FLOW_KINDS.has(value.kind) &&
      typeof value.auto === "boolean"
    );
  }
  return false;
}

function isChain(value: unknown): value is { id: string; steps: Array<{ id: string }> } {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isNumber(value.sharePct) &&
    Array.isArray(value.steps) &&
    value.steps.every(isStep)
  );
}

/**
 * A stored plan, or null when it cannot be read as one: not version 1, or a hub, spoke, chain or
 * step that is not the shape the plan model says, or two chains or two steps sharing an id (every
 * lookup on the canvas is by id). Checks structure only; the mandate is `validatePlan`'s business.
 */
export function normalizePlan(value: unknown): BuildPlan | null {
  if (!isRecord(value) || value.version !== BUILD_PLAN_VERSION) return null;
  const hub = value.hub;
  if (!isRecord(hub) || !Array.isArray(hub.chains) || !Array.isArray(value.spokes)) return null;
  const chains: unknown[] = [...hub.chains];
  for (const spoke of value.spokes) {
    if (!isRecord(spoke) || !isId(spoke.network) || !isNumber(spoke.sharePct)) return null;
    if (!Array.isArray(spoke.chains)) return null;
    chains.push(...spoke.chains);
  }
  const chainIds = new Set<string>();
  const stepIds = new Set<string>();
  for (const chain of chains) {
    if (!isChain(chain) || chainIds.has(chain.id)) return null;
    chainIds.add(chain.id);
    for (const step of chain.steps) {
      if (stepIds.has(step.id)) return null;
      stepIds.add(step.id);
    }
  }
  return value as unknown as BuildPlan;
}

/** What the unsaved check compares. No plan fingerprints as the empty plan. */
export function planFingerprint(plan: BuildPlan | undefined): string {
  return JSON.stringify(plan ?? createEmptyPlan());
}
