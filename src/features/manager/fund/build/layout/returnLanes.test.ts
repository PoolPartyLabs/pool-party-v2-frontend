/**
 * @id PP-MGR-LIB-023
 * @name returnLanes tests
 * @implements-rules-version v2 (POO-2345)
 * @analytics-events none, a pure geometry module: nothing here is rendered or tracked.
 *
 * Unit tests of the helpers that plan the Bridge ports and the lanes of the return lines.
 */

import { describe, expect, it } from "vitest";
import { LAYOUT } from "./layoutConstants";
import {
  bandShortfall,
  type LaneLine,
  laneCount,
  laneYs,
  offsetAt,
  orderLanes,
  placePorts,
  planReturnLines,
} from "./returnLanes";

const BRIDGE = { id: "bridge", rect: { x: 100, y: 500, w: 176, h: 26 } };

describe("placePorts", () => {
  it("keeps a port where it wants to be", () => {
    expect(placePorts([130, 200], 112, 264)).toEqual([130, 200]);
  });

  it("keeps the gap between two ports that want one x", () => {
    expect(placePorts([200, 200], 112, 264)).toEqual([200, 200 + LAYOUT.PAIR]);
  });

  it("keeps the ports inside the row and in order", () => {
    const xs = placePorts([300, 300, 300], 112, 264);
    expect(xs[2]).toBe(264);
    expect(xs).toEqual([264 - 2 * LAYOUT.PAIR, 264 - LAYOUT.PAIR, 264]);
  });

  it("shrinks the gap when the row is too short", () => {
    expect(placePorts([0, 0, 0], 0, 12)).toEqual([0, 6, 12]);
  });
});

describe("offsetAt", () => {
  it("gives an offset that resolves to the exact x", () => {
    for (const x of [112, 130.5, 163, 200, 264]) {
      expect(100 + 176 * offsetAt(100, 176, x)).toBe(x);
    }
  });
});

describe("orderLanes", () => {
  it("gives no lane to a straight line", () => {
    expect(orderLanes([{ from: 5, to: 5, rank: 0 }])).toEqual([-1]);
  });

  it("puts the line whose start is inside the run of another above it", () => {
    // b starts inside the run of a, so b lies above a. a ends inside the run of b, so a lies below b.
    const lanes = orderLanes([
      { from: 0, to: 100, rank: 0 },
      { from: 50, to: 150, rank: 1 },
    ]);
    expect(lanes[1]).toBeLessThan(lanes[0] ?? -1);
  });

  it("keeps lines that share a target in nested lanes", () => {
    const lanes = orderLanes([
      { from: 300, to: 100, rank: 0 },
      { from: 200, to: 100, rank: 1 },
    ]);
    // The nearer start goes above: its vertical stays inside the run of the farther line.
    expect(lanes[1]).toBeLessThan(lanes[0] ?? -1);
  });

  it("gives every crossing line its own lane", () => {
    const lanes = orderLanes([
      { from: 0, to: 100, rank: 0 },
      { from: 100, to: 0, rank: 1 },
      { from: 50, to: 60, rank: 2 },
    ]);
    expect(new Set(lanes).size).toBe(3);
    expect(lanes.every((lane) => lane >= 0)).toBe(true);
  });

  // @rule R7
  it("[R7] lets two lines of one target share a lane when they come from opposite sides", () => {
    const lanes = orderLanes([
      { from: 0, to: 100, rank: 0 },
      { from: 200, to: 100, rank: 1 },
    ]);
    expect(lanes).toEqual([0, 0]);
  });

  // @rule R7
  it("[R7] keeps two lines from the same side apart, and two lines of different targets apart", () => {
    expect(
      orderLanes([
        { from: 0, to: 100, rank: 0 },
        { from: 50, to: 100, rank: 1 },
      ]),
    ).toEqual([1, 0]);
    expect(
      orderLanes([
        { from: 0, to: 100, rank: 0 },
        { from: 300, to: 200, rank: 1 },
      ]),
    ).toEqual([0, 1]);
  });

  // @rule R7
  it("[R7] does not share a lane while another line must lie above the second line", () => {
    // f starts inside the run of b and ends left of it, so f lies above b. a and f are a forced pair.
    const lanes = orderLanes([
      { from: 0, to: 100, rank: 0 },
      { from: 400, to: 100, rank: 1 },
      { from: 300, to: 50, rank: 2 },
    ]);
    expect(lanes).toEqual([0, 2, 1]);
  });

  it("counts lanes, not lines", () => {
    expect(laneCount([0, 0, 1, -1])).toBe(2);
    expect(laneCount([-1])).toBe(0);
    expect(laneCount([])).toBe(0);
  });

  it("gives the same order as the plain pick by fewest blockers, for lines with no shared target", () => {
    // Reference: the first version of the sort, which counted the blockers again at each pick.
    const reference = (lines: readonly LaneLine[]): number[] => {
      const inside = (x: number, a: number, b: number) => x > Math.min(a, b) && x < Math.max(a, b);
      const members = lines.flatMap((line, index) => (line.from === line.to ? [] : [index]));
      const above = new Map<number, Set<number>>(members.map((i) => [i, new Set<number>()]));
      for (const i of members)
        for (const j of members) {
          const a = lines[i] as LaneLine;
          const b = lines[j] as LaneLine;
          if (i === j) continue;
          if (inside(b.from, a.from, a.to)) above.get(j)?.add(i);
          if (inside(b.to, a.from, a.to)) above.get(i)?.add(j);
        }
      for (const i of members)
        for (const j of above.get(i) ?? [])
          if (above.get(j)?.has(i)) {
            above.get(i)?.delete(j);
            above.get(j)?.delete(i);
          }
      const out = lines.map(() => -1);
      const waiting = new Set(members);
      for (let lane = 0; waiting.size > 0; lane += 1) {
        let pick = -1;
        let fewest = Number.POSITIVE_INFINITY;
        for (const index of waiting) {
          const count = [...waiting].filter((other) => above.get(other)?.has(index)).length;
          const rank = (lines[index] as LaneLine).rank;
          if (count < fewest || (count === fewest && rank < (lines[pick] as LaneLine).rank)) {
            pick = index;
            fewest = count;
          }
        }
        out[pick] = lane;
        waiting.delete(pick);
      }
      return out;
    };
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 200; round += 1) {
      const tos = Array.from({ length: 12 }, (_, index) => index * 10 + 5);
      const lines = tos.map((to, index) => ({
        from: Math.floor(next() * 12) * 10 + 5,
        to,
        rank: index,
      }));
      expect(orderLanes(lines)).toEqual(reference(lines));
    }
  });
});

describe("laneYs", () => {
  it("puts one lane at the lowest y", () => {
    expect(laneYs(1, 100, 40)).toEqual([100]);
  });

  it("keeps a LINK between lanes when the band is tall enough", () => {
    expect(laneYs(2, 100, 40)).toEqual([100 - LAYOUT.LINK, 100]);
  });

  it("closes the lanes up to fit the band, and puts no lane above the top of the band", () => {
    const ys = laneYs(13, 100, 40);
    expect(ys[0]).toBe(40);
    expect(ys.at(-1)).toBe(100);
    for (const count of [2, 5, 9, 14, 30]) {
      const lanes = laneYs(count, 100, 58);
      expect(Math.min(...lanes)).toBeGreaterThanOrEqual(58);
      expect(new Set(lanes).size).toBe(count);
    }
  });

  it("keeps at least LANE_PITCH between lanes whenever the band holds them", () => {
    for (const count of [2, 3, 7, 8]) {
      const ys = laneYs(count, 100, 58);
      expect(bandShortfall(count, 100, 58)).toBe(0);
      for (let index = 1; index < ys.length; index += 1)
        expect((ys[index] ?? 0) - (ys[index - 1] ?? 0)).toBeGreaterThanOrEqual(LAYOUT.LANE_PITCH);
    }
  });
});

describe("bandShortfall", () => {
  it("is 0 when the band holds the lanes at LANE_PITCH, and the missing height when it does not", () => {
    // A band of 42 px holds 8 lanes at 6 px: 7 gaps.
    expect(bandShortfall(8, 100, 58)).toBe(0);
    expect(bandShortfall(10, 100, 58)).toBe(12);
    expect(bandShortfall(1, 100, 100)).toBe(0);
  });
});

function geometry(outputX: number, incomeX: number) {
  return { outputX, incomeX, outputTop: 598, hasIncome: true };
}

describe("planReturnLines", () => {
  const chains = [
    { chainId: "a", laneX: 120, bridge: BRIDGE, fees: [{ id: "a-fee", x: 110 }] },
    { chainId: "b", laneX: 260, bridge: BRIDGE, fees: [] },
  ];

  // @rule R3
  it("[R3] orders the top ports by start x, income left of principal", () => {
    const lines = planReturnLines(chains, geometry(40, 400));
    const income = lines.get("income:a-fee");
    const principal = lines.get("principal:a");
    const other = lines.get("principal:b");
    expect(income?.topX).toBeLessThan(principal?.topX ?? Number.NaN);
    expect(principal?.topX).toBeLessThan(other?.topX ?? Number.NaN);
  });

  // @rule R4
  it("[R4] puts the principal bottom ports left of the income bottom ports", () => {
    const lines = planReturnLines(chains, geometry(400, 40));
    const income = lines.get("income:a-fee");
    expect(income?.bottomX).toBeGreaterThan(lines.get("principal:a")?.bottomX ?? Number.NaN);
    expect(income?.bottomX).toBeGreaterThan(lines.get("principal:b")?.bottomX ?? Number.NaN);
  });

  // @rule R4
  it("[R4] keeps a bottom port as near its target as the Bridge allows", () => {
    const lines = planReturnLines([chains[1] as (typeof chains)[number]], geometry(150, 400));
    expect(lines.get("principal:b")?.bottomX).toBe(150);
    const left = planReturnLines([chains[1] as (typeof chains)[number]], geometry(0, 400));
    expect(left.get("principal:b")?.bottomX).toBe(BRIDGE.rect.x + LAYOUT.PAIR);
  });

  // @rule R7
  it("[R7] gives two principal lines on opposite sides of Idle output one lane, and two on one side two", () => {
    const apart = planReturnLines(
      [
        { chainId: "l", laneX: 20, fees: [] },
        { chainId: "r", laneX: 380, fees: [] },
      ],
      geometry(200, 500),
    );
    expect(apart.get("principal:l")?.bottomLane).toBeDefined();
    expect(apart.get("principal:l")?.bottomLane).toBe(apart.get("principal:r")?.bottomLane);
    const near = planReturnLines(
      [
        { chainId: "l", laneX: 20, fees: [] },
        { chainId: "m", laneX: 60, fees: [] },
      ],
      geometry(200, 500),
    );
    expect(near.get("principal:l")?.bottomLane).not.toBe(near.get("principal:m")?.bottomLane);
  });

  it("puts every lane of a band inside it", () => {
    const wide = Array.from({ length: 6 }, (_, index) => ({
      chainId: `c${index}`,
      laneX: 20 + index * 40,
      fees: [],
    }));
    const lines = planReturnLines(wide, geometry(400, 500));
    const top = geometry(400, 500).outputTop - LAYOUT.RETURN_BAND_INCOME + LAYOUT.LANE_MARGIN;
    for (const line of lines.values()) expect(line.bottomLane ?? top).toBeGreaterThanOrEqual(top);
  });

  it("gives a line with no Bridge no port", () => {
    const lines = planReturnLines([{ chainId: "h", laneX: 5, fees: [] }], geometry(40, 400));
    expect(lines.get("principal:h")?.bridgeId).toBeUndefined();
  });
});
