/**
 * @id PP-MGR-LIB-023
 * @name returnLanes
 * @implements-rules-version v2 (POO-2345)
 * @analytics-events none, a pure geometry module: nothing here is rendered or tracked.
 *
 * Helpers of `layoutGraph` for the return lines (rules R3 to R7 of POO-2345 v2). Three jobs:
 *
 * - {@link placePorts} puts the ports of one Bridge edge in a row. A port stays as close as it can
 *   to the x it wants, the order of the row never changes and two ports keep a gap.
 * - {@link orderLanes} gives each line of a channel a lane. A channel is the free band between the
 *   blocks and a row of ports. A line comes in from the top at `from`, runs along its lane and
 *   goes out at the bottom at `to`. The order of the lanes prevents every crossing that a lane
 *   order can prevent. A line with `from === to` runs straight and gets no lane. Two lines of
 *   one class that end at one port and come from opposite sides share a lane (rule R7).
 * - {@link laneYs} turns the number of lanes into y values that fit the band.
 *
 * Same input, same output: no DOM, no React, no clock, no randomness.
 */

import type { Rect } from "./graphTypes";
import { LAYOUT } from "./layoutConstants";

/** A line in a channel. A lower `rank` goes higher when nothing else decides. */
export interface LaneLine {
  from: number;
  to: number;
  rank: number;
}

/**
 * The x of each port of a row, left to right, inside [lo, hi]. `wanted` is in row order. A port
 * stays at its wanted x unless a neighbour or an end of the row pushes it.
 */
export function placePorts(wanted: readonly number[], lo: number, hi: number): number[] {
  const count = wanted.length;
  const gap = count > 1 ? Math.min(LAYOUT.PAIR, (hi - lo) / (count - 1)) : 0;
  const xs = wanted.map((x) => Math.min(hi, Math.max(lo, x)));
  for (let index = 1; index < count; index += 1)
    xs[index] = Math.max(xs[index] ?? lo, (xs[index - 1] ?? lo) + gap);
  if ((xs[count - 1] ?? lo) > hi) {
    xs[count - 1] = hi;
    for (let index = count - 2; index >= 0; index -= 1)
      xs[index] = Math.min(xs[index] ?? hi, (xs[index + 1] ?? hi) - gap);
  }
  return xs;
}

/** The offset of a top or bottom port that resolves to exactly x, as `rectX + width * offset`. */
export function offsetAt(rectX: number, width: number, x: number): number {
  let offset = (x - rectX) / width;
  for (let step = 0; step < LAYOUT.OFFSET_ITERATIONS && rectX + width * offset !== x; step += 1)
    offset += (x - (rectX + width * offset)) / width;
  return offset;
}

/**
 * True when two lines can use one lane: they end at the same x and come from opposite sides of it.
 * Their horizontals then meet at that x and do not overlap, and their last verticals are one trunk.
 */
function sharesTrunk(a: LaneLine | undefined, b: LaneLine | undefined): boolean {
  return (
    a !== undefined && b !== undefined && a.to === b.to && (a.from - a.to) * (b.from - b.to) < 0
  );
}

function strictlyInside(x: number, a: number, b: number): boolean {
  return x > Math.min(a, b) && x < Math.max(a, b);
}

/**
 * The lane of each line, 0 for the top lane, or -1 for a straight line.
 *
 * A line is a vertical at `from` down to its lane, a horizontal to `to`, and a vertical at `to`.
 * Take two lines i and j. When `from` of j is inside the run of i, j must lie above i, or its
 * vertical crosses the run. When `to` of j is inside the run of i, j must lie below i. When both
 * hold, one crossing is forced whatever the order is, so the pair is left out of the sort. Lines
 * that end at the same `to` need no rule: they form a trunk. Two such lines from opposite sides
 * share one lane when nothing blocks the second one: their horizontals only meet at `to`.
 *
 * Each pick takes the line with the fewest lines still above it, then the lowest rank. The count
 * of each line drops when a line gets its lane, so the sort costs O(n^2).
 */
export function orderLanes(lines: readonly LaneLine[]): number[] {
  const lanes = lines.map(() => -1);
  const members = lines.flatMap((line, index) => (line.from === line.to ? [] : [index]));
  const above = new Map<number, Set<number>>(members.map((index) => [index, new Set<number>()]));
  const need = (upper: number, lower: number) => above.get(upper)?.add(lower);
  for (const i of members) {
    for (const j of members) {
      const a = lines[i];
      const b = lines[j];
      if (i === j || !a || !b) continue;
      if (strictlyInside(b.from, a.from, a.to)) need(j, i);
      if (strictlyInside(b.to, a.from, a.to)) need(i, j);
    }
  }
  for (const i of members)
    for (const j of above.get(i) ?? [])
      if (above.get(j)?.has(i)) {
        above.get(i)?.delete(j);
        above.get(j)?.delete(i);
      }
  const waiting = new Set(members);
  // How many waiting lines must lie above each line. A line that gets its lane stops blocking.
  const blocked = new Map<number, number>(members.map((index) => [index, 0]));
  for (const upper of members)
    for (const lower of above.get(upper) ?? []) blocked.set(lower, (blocked.get(lower) ?? 0) + 1);
  const rankOf = (index: number) => lines[index]?.rank ?? 0;
  const settle = (index: number, lane: number) => {
    lanes[index] = lane;
    waiting.delete(index);
    for (const lower of above.get(index) ?? []) blocked.set(lower, (blocked.get(lower) ?? 1) - 1);
  };
  let lane = 0;
  while (waiting.size > 0) {
    let pick: number | undefined;
    let fewest = Number.POSITIVE_INFINITY;
    for (const index of waiting) {
      const count = blocked.get(index) ?? 0;
      if (
        count < fewest ||
        (count === fewest && pick !== undefined && rankOf(index) < rankOf(pick))
      ) {
        pick = index;
        fewest = count;
      }
    }
    if (pick === undefined) break;
    settle(pick, lane);
    // R7: a line from the other side of the same target shares the lane when nothing blocks it.
    let partner: number | undefined;
    for (const index of waiting)
      if (
        (blocked.get(index) ?? 0) === 0 &&
        sharesTrunk(lines[pick], lines[index]) &&
        (partner === undefined || rankOf(index) < rankOf(partner))
      )
        partner = index;
    if (partner !== undefined) settle(partner, lane);
    lane += 1;
  }
  return lanes;
}

/** The number of lanes that orderLanes used: the highest lane number plus 1. */
export function laneCount(lanes: readonly number[]): number {
  return lanes.reduce((count, lane) => Math.max(count, lane + 1), 0);
}

/**
 * The y of each of `count` lanes, top lane first. The lowest lane sits at `lowest`. The lanes
 * keep a LINK between them when the band allows it and get closer when it does not. A pitch is a
 * multiple of half a pixel, so two lanes never share a y, and no lane is above `bandTop`.
 */
export function laneYs(count: number, lowest: number, bandTop: number): number[] {
  const fit = count > 1 ? Math.floor(((lowest - bandTop) / (count - 1)) * 2) / 2 : 0;
  const pitch = Math.min(LAYOUT.LINK, fit);
  return Array.from({ length: count }, (_, index) => lowest - (count - 1 - index) * pitch);
}

/**
 * The height a band is short of, in px, when `count` lanes keep the least pitch (LANE_PITCH)
 * between them. It is 0 when the band holds them.
 */
export function bandShortfall(count: number, lowest: number, bandTop: number): number {
  return Math.max(0, (count - 1) * LAYOUT.LANE_PITCH - (lowest - bandTop));
}

/** A chain that returns money, as the planner reads it. */
export interface ReturnChainInput {
  chainId: string;
  /** The x of the vertical the principal line drops along, right of the last position. */
  laneX: number;
  /** The return Bridge of the chain's spoke, or nothing for a hub or local chain. */
  bridge?: { id: string; rect: Rect };
  /** One entry per Collect: the x where its income line leaves the fee swap. */
  fees: { id: string; x: number }[];
}

/** Where the lines end, and where the free band above Idle output is. */
export interface ReturnGeometry {
  /** The x of the Idle output port and of the Income port. */
  outputX: number;
  incomeX: number;
  /** The y of the top of Idle output and Income. */
  outputTop: number;
  /** True when Income exists, so the band above Idle output is RETURN_BAND_INCOME tall. */
  hasIncome: boolean;
}

/** One return line: where it starts, where it ends and the ports it uses on its Bridge. */
export interface ReturnLine {
  cls: "principal" | "income";
  /** The x of the first vertical of the line. */
  from: number;
  /** The x of the Idle output or Income port the line ends at. */
  target: number;
  bridgeId?: string;
  /** The x and offset of the Bridge port the line enters. */
  topX: number;
  topOffset: number;
  /** The x and offset of the Bridge port the line leaves. */
  bottomX: number;
  bottomOffset: number;
  /** The y of the lane above the Bridge, or nothing when the line enters its port straight. */
  topLane?: number;
  /** The y of the lane above its target, or nothing when the line ends straight. */
  bottomLane?: number;
}

/**
 * Plans the Bridge ports of every return line. The key of a line is `principal:<chainId>` or
 * `income:<feeId>`.
 *
 * - R3: on the top of a Bridge the ports follow the x where their lines start. Of two lines that
 *   start at one x, the income line goes left.
 * - R4: on the bottom of a Bridge the ports are grouped by class. The principal ports are on the
 *   left and the income ports on the right. Inside a class the order stays the one of the top.
 *   Each port stays near the x of its target, so a line goes straight when the Bridge allows it.
 * - R5: each line that is not straight gets its own lane in each channel it crosses: above its
 *   Bridge, and above Idle output and Income. {@link orderLanes} orders the lanes.
 * - R6: a line is straight when the x where it starts is the x where it ends.
 * - R7: lines of one class end at one port. They meet in one trunk, the last vertical.
 */
export function planReturnLines(
  chains: readonly ReturnChainInput[],
  geometry: ReturnGeometry,
): Map<string, ReturnLine> {
  const { outputX, incomeX } = geometry;
  const lines = new Map<string, ReturnLine>();
  const byBridge = new Map<string, { rect: Rect; keys: string[] }>();
  const add = (key: string, line: ReturnLine, bridge: ReturnChainInput["bridge"]) => {
    lines.set(key, line);
    if (!bridge) return;
    const group = byBridge.get(bridge.id) ?? { rect: bridge.rect, keys: [] };
    group.keys.push(key);
    byBridge.set(bridge.id, group);
  };
  const blank = {
    topX: 0,
    topOffset: LAYOUT.PORT_CENTER,
    bottomX: 0,
    bottomOffset: LAYOUT.PORT_CENTER,
  };
  for (const chain of chains) {
    add(
      `principal:${chain.chainId}`,
      {
        cls: "principal",
        from: chain.laneX,
        target: outputX,
        bridgeId: chain.bridge?.id,
        ...blank,
      },
      chain.bridge,
    );
    for (const fee of chain.fees)
      add(
        `income:${fee.id}`,
        { cls: "income", from: fee.x, target: incomeX, bridgeId: chain.bridge?.id, ...blank },
        chain.bridge,
      );
  }
  for (const { rect, keys } of byBridge.values()) {
    const row = keys
      .map((key) => ({ key, line: lines.get(key) as ReturnLine }))
      .sort(
        (a, b) =>
          a.line.from - b.line.from ||
          Number(b.line.cls === "income") - Number(a.line.cls === "income"),
      );
    const lo = rect.x + LAYOUT.PAIR;
    const hi = rect.x + rect.w - LAYOUT.PAIR;
    const xs = placePorts(
      row.map((entry) => entry.line.from),
      lo,
      hi,
    );
    for (const [index, entry] of row.entries()) {
      const offset = offsetAt(rect.x, rect.w, xs[index] ?? lo);
      entry.line.topOffset = offset;
      entry.line.topX = rect.x + rect.w * offset;
    }
    const out = [...row].sort(
      (a, b) =>
        Number(a.line.cls === "income") - Number(b.line.cls === "income") ||
        a.line.topX - b.line.topX,
    );
    const outXs = placePorts(
      out.map((entry) => entry.line.target),
      lo,
      hi,
    );
    for (const [index, entry] of out.entries()) {
      const offset = offsetAt(rect.x, rect.w, outXs[index] ?? lo);
      entry.line.bottomOffset = offset;
      entry.line.bottomX = rect.x + rect.w * offset;
    }
  }
  assignLanes(lines, byBridge, geometry);
  return lines;
}

/** Fills in `topLane` and `bottomLane` of every line (rule R5). */
function assignLanes(
  lines: Map<string, ReturnLine>,
  byBridge: Map<string, { rect: Rect; keys: string[] }>,
  geometry: ReturnGeometry,
): void {
  const order = [...lines.keys()];
  const rankOf = (key: string) =>
    (lines.get(key)?.cls === "income" ? order.length : 0) + order.indexOf(key);
  const place = (
    keys: string[],
    ends: (line: ReturnLine) => { from: number; to: number },
    lowest: number,
    bandTop: number,
  ): Map<string, number> => {
    const lanes = orderLanes(
      keys.map((key) => ({ ...ends(lines.get(key) as ReturnLine), rank: rankOf(key) })),
    );
    const ys = laneYs(laneCount(lanes), lowest, bandTop);
    return new Map(
      keys.flatMap((key, index) => {
        const lane = lanes[index] ?? -1;
        return lane < 0 ? [] : [[key, ys[lane] ?? lowest] as const];
      }),
    );
  };
  for (const { rect, keys } of byBridge.values()) {
    const found = place(
      keys,
      (line) => ({ from: line.from, to: line.topX }),
      rect.y - LAYOUT.LINK,
      rect.y - LAYOUT.RETURN_BRIDGE_GAP + LAYOUT.LANE_MARGIN,
    );
    for (const [key, y] of found) (lines.get(key) as ReturnLine).topLane = y;
  }
  const bottom = place(
    order.filter((key) => geometry.hasIncome || lines.get(key)?.cls === "principal"),
    (line) =>
      line.bridgeId === undefined
        ? { from: line.from, to: line.target }
        : { from: line.bottomX, to: line.target },
    geometry.outputTop - LAYOUT.LINK,
    geometry.outputTop -
      (geometry.hasIncome ? LAYOUT.RETURN_BAND_INCOME : LAYOUT.RETURN_BAND) +
      LAYOUT.LANE_MARGIN,
  );
  for (const [key, y] of bottom) (lines.get(key) as ReturnLine).bottomLane = y;
}
