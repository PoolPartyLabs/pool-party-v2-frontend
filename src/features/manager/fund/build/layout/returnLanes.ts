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
 * - {@link orderLanes} gives each line of a channel its own lane. A channel is the free band
 *   between the blocks and a row of ports. A line comes in from the top at `from`, runs along its
 *   lane and goes out at the bottom at `to`. The order of the lanes prevents every crossing that
 *   a lane order can prevent. A line with `from === to` runs straight and gets no lane.
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
  for (let step = 0; step < LAYOUT.PAIR && rectX + width * offset !== x; step += 1)
    offset += (x - (rectX + width * offset)) / width;
  return offset;
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
 * that end at the same `to` need no rule: they form a trunk.
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
  const blockers = (index: number) =>
    [...waiting].filter((other) => above.get(other)?.has(index)).length;
  let lane = 0;
  while (waiting.size > 0) {
    let pick: number | undefined;
    let fewest = Number.POSITIVE_INFINITY;
    for (const index of waiting) {
      const count = blockers(index);
      const rank = lines[index]?.rank ?? 0;
      const best = pick === undefined ? Number.POSITIVE_INFINITY : (lines[pick]?.rank ?? 0);
      if (count < fewest || (count === fewest && rank < best)) {
        pick = index;
        fewest = count;
      }
    }
    if (pick === undefined) break;
    lanes[pick] = lane;
    lane += 1;
    waiting.delete(pick);
  }
  return lanes;
}

/**
 * The y of each of `count` lanes, top lane first. The lowest lane sits at `lowest`. The lanes
 * keep a LINK between them when the band allows it and get closer when it does not. A pitch is a
 * multiple of half a pixel, and never under a line width, so two lanes never share a y.
 */
export function laneYs(count: number, lowest: number, bandTop: number): number[] {
  const fit = count > 1 ? Math.floor(((lowest - bandTop) / (count - 1)) * 2) / 2 : 0;
  const pitch = Math.max(LAYOUT.LINE_W, Math.min(LAYOUT.LINK, fit));
  return Array.from({ length: count }, (_, index) => lowest - (count - 1 - index) * pitch);
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
}

/**
 * Plans the Bridge ports of every return line. The key of a line is `principal:<chainId>` or
 * `income:<feeId>`.
 *
 * - R3: on the top of a Bridge the ports follow the x where their lines start. Of two lines that
 *   start at one x, the income line goes left.
 */
export function planReturnLines(
  chains: readonly ReturnChainInput[],
  outputX: number,
  incomeX: number,
): Map<string, ReturnLine> {
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
      entry.line.bottomOffset = offset;
      entry.line.bottomX = entry.line.topX;
    }
  }
  return lines;
}
