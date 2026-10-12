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
import { laneYs, offsetAt, orderLanes, placePorts, planReturnLines } from "./returnLanes";

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
});

describe("laneYs", () => {
  it("puts one lane at the lowest y", () => {
    expect(laneYs(1, 100, 40)).toEqual([100]);
  });

  it("keeps a LINK between lanes when the band is tall enough", () => {
    expect(laneYs(2, 100, 40)).toEqual([100 - LAYOUT.LINK, 100]);
  });

  it("closes the lanes up to fit the band, and never to less than a line width", () => {
    const ys = laneYs(13, 100, 40);
    expect(ys[0]).toBeGreaterThanOrEqual(40);
    expect(ys.at(-1)).toBe(100);
    expect(laneYs(100, 100, 99).at(0)).toBe(100 - 99 * LAYOUT.LINE_W);
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

  it("gives a line with no Bridge no port", () => {
    const lines = planReturnLines([{ chainId: "h", laneX: 5, fees: [] }], geometry(40, 400));
    expect(lines.get("principal:h")?.bridgeId).toBeUndefined();
  });
});
