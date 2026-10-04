/**
 * @id PP-MGR-LIB-027
 * @name allocationCeiling
 * @implements-rules-version v1 (POO-2184 rules v1)
 * @analytics-events none, a pure domain module. The panel batch reports the slider reaching its
 *   ceiling (`limit_hit`, slice PG) from what this returns; nothing here touches the dataLayer.
 *
 * Handoff P8 (POO-2171, murilo 2026-10-03): how far a chain's Allocation slider may go, and which
 * ceiling stopped it, so the panel can say "Maximum reached" with the right reason.
 *
 * - The mandate caps from Limits (step 5) are TOTALS, not per block numbers: the room under a
 *   protocol cap is that cap minus the shares of the other blocks of the same protocol; the room
 *   under a network cap is that cap minus the shares of the other blocks on the same network. A
 *   block's share is its chain's share, and a chain belongs to the protocol of its first position
 *   (only that block has an Allocation field). Caps are read from the draft (`draft.caps`): a row
 *   marked "no cap", or no row at all, caps nothing. These are frontend rules, not contract
 *   guarantees (R41).
 * - The room of the strategy is 100 minus every other chain, on the hub and inside the spokes. A
 *   spoke's share is the sum of its chains (open point 3, DP3): another spoke counts with its
 *   share, the chain's own spoke with its sibling chains.
 * - The ceiling is the lowest room. On a tie it names the mandate cap, the protocol cap before the
 *   network cap. A ceiling that is not a multiple of 5 is a valid stop, so the value is returned as
 *   it is, never rounded to the slider's step; it never goes below 0.
 * - Per token caps are not applied in this batch (open point 11).
 */
import type { NetworkId, ProtocolId } from "../../mandateDraft";
import { BLOCK_KIND_PROTOCOL, type BuildPlan, type Chain, type PlanContext } from "./buildPlan";
import { chainsWithNetwork } from "./planDerive";

/** What stopped the slider: a mandate cap from Limits, or the room left in the strategy. */
export type AllocationCeilingReason = "protocolCap" | "networkCap" | "strategyRoom";

export interface AllocationCeiling {
  /** The highest share the chain may take, 0 to 100, not rounded to the slider's step. */
  max: number;
  reason: AllocationCeilingReason;
  /** The capped protocol, when `reason` is "protocolCap". */
  protocol?: ProtocolId;
  /** The capped network, when `reason` is "networkCap". */
  network?: NetworkId;
  /** The mandate cap itself, when one stopped the slider ("Your mandate caps X at <n>%"). */
  capPct?: number;
  /**
   * What the other blocks already take inside the ceiling that stopped the slider: of the protocol,
   * of the network, or of the strategy ("The other blocks under Idle input already take <n>%").
   */
  otherPct: number;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Float noise off a sum of shares (33.3 + 33.3 + ...), so a ceiling reads as the number it is. */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The protocol a chain's share counts toward: its first position's. */
function protocolOf(chain: Chain): ProtocolId | null {
  const first = chain.steps.find((step) => step.family === "position");
  return first?.family === "position" ? BLOCK_KIND_PROTOCOL[first.kind] : null;
}

/**
 * [P8] The ceiling of a chain's Allocation, and what set it. Null for a chain the plan does not
 * hold.
 */
export function allocationCeiling(
  plan: BuildPlan,
  ctx: Pick<PlanContext, "draft">,
  chainId: string,
): AllocationCeiling | null {
  const entries = chainsWithNetwork(plan);
  const self = entries.find(({ chain }) => chain.id === chainId);
  if (!self) return null;
  const others = entries.filter(({ chain }) => chain.id !== chainId);
  const candidates: AllocationCeiling[] = [];

  const protocol = protocolOf(self.chain);
  const protocolCap = protocol === null ? undefined : ctx.draft.caps.protocols[protocol];
  if (protocol !== null && protocolCap && !protocolCap.noCap) {
    const otherPct = clean(
      sum(
        others.filter(({ chain }) => protocolOf(chain) === protocol).map((e) => e.chain.sharePct),
      ),
    );
    candidates.push({
      max: protocolCap.pct - otherPct,
      reason: "protocolCap",
      protocol,
      capPct: protocolCap.pct,
      otherPct,
    });
  }

  const networkCap = ctx.draft.caps.networks[self.network];
  if (networkCap && !networkCap.noCap) {
    const otherPct = clean(
      sum(others.filter(({ network }) => network === self.network).map((e) => e.chain.sharePct)),
    );
    candidates.push({
      max: networkCap.pct - otherPct,
      reason: "networkCap",
      network: self.network,
      capPct: networkCap.pct,
      otherPct,
    });
  }

  const hubOthers = sum(plan.hub.chains.filter((c) => c.id !== chainId).map((c) => c.sharePct));
  const spokeOthers = sum(
    plan.spokes.map((spoke, index) =>
      index === self.spokeIndex
        ? sum(spoke.chains.filter((c) => c.id !== chainId).map((c) => c.sharePct))
        : spoke.sharePct,
    ),
  );
  const strategyOther = clean(hubOthers + spokeOthers);
  candidates.push({ max: 100 - strategyOther, reason: "strategyRoom", otherPct: strategyOther });

  // The lowest room wins; a tie keeps the earlier entry, so a mandate cap is named first.
  let lowest = candidates[0] as AllocationCeiling;
  for (const candidate of candidates) {
    if (candidate.max < lowest.max) lowest = candidate;
  }
  return { ...lowest, max: Math.max(0, clean(lowest.max)) };
}
