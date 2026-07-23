/**
 * @covers managerStrategySort (POO-752 [R2])
 *
 * Pure metric sort for the Manager Console "My strategies" list: aum / investors / signed apy, and
 * fees30d where a 0 ("not measured", rendered as a dash) sinks to the bottom in BOTH directions.
 */
import { describe, expect, it } from "vitest";
import type { ManagerStrategy } from "@/lib/schemas";
import { sortManagerStrategies } from "./managerStrategySort";

/** Minimal ManagerStrategy for the pure sort (only the four metric fields + id are read). */
function strat(id: string, fields: Partial<ManagerStrategy>): ManagerStrategy {
  return { id, aum: 0, investors: 0, apy: 0, fees30d: 0, ...fields } as ManagerStrategy;
}

describe("sortManagerStrategies", () => {
  it("sorts by AUM descending and ascending", () => {
    const list = [strat("a", { aum: 100 }), strat("b", { aum: 300 }), strat("c", { aum: 200 })];
    expect(sortManagerStrategies(list, "aum", "desc").map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(sortManagerStrategies(list, "aum", "asc").map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts investors ascending/descending", () => {
    const list = [
      strat("a", { investors: 5 }),
      strat("b", { investors: 1 }),
      strat("c", { investors: 9 }),
    ];
    expect(sortManagerStrategies(list, "investors", "desc").map((s) => s.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortManagerStrategies(list, "investors", "asc").map((s) => s.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("sorts apy signed (negatives allowed)", () => {
    const list = [strat("a", { apy: -5 }), strat("b", { apy: 10 }), strat("c", { apy: 0 })];
    expect(sortManagerStrategies(list, "apy", "desc").map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(sortManagerStrategies(list, "apy", "asc").map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("forces fees30d === 0 (not measured) to the bottom in BOTH directions", () => {
    const list = [
      strat("a", { fees30d: 0 }),
      strat("b", { fees30d: 50 }),
      strat("c", { fees30d: 10 }),
    ];
    // desc: present values high→low, the 0 last (sanity — with non-negative fees, 0 is the numeric
    // minimum so it already lands last; this line does not by itself prove the special-casing).
    expect(sortManagerStrategies(list, "fees30d", "desc").map((s) => s.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    // asc: the DISCRIMINATING case — present values low→high, but the 0 (not measured) STILL sinks to
    // the bottom instead of sorting first as a literal 0. This is what proves the missing-to-bottom.
    expect(sortManagerStrategies(list, "fees30d", "asc").map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("returns a new array without mutating the input", () => {
    const list = [strat("a", { aum: 1 }), strat("b", { aum: 2 })];
    const out = sortManagerStrategies(list, "aum", "desc");
    expect(out).not.toBe(list);
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("is stable for equal keys (preserves input order)", () => {
    const list = [strat("a", { aum: 5 }), strat("b", { aum: 5 }), strat("c", { aum: 5 })];
    expect(sortManagerStrategies(list, "aum", "desc").map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
