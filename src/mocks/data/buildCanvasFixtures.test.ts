/**
 * @id PP-MGR-MCK-004
 * @name buildCanvasFixtures tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a data fixture.
 *
 * The fixtures are oracles, so a typo in them would hide a layout bug. These checks keep them
 * honest as data: every block has its printed content and nothing else does, ids are unique, the
 * shares obey C8 (what hangs below never adds up to more than the node above), every chain holds a
 * position (INV4), and every drawn fixture names the Figma frame it was read from.
 */
import { describe, expect, it } from "vitest";
import { BUILD_CANVAS_FIXTURES, type BuildCanvasFixture } from "./buildCanvasFixtures";

const ENTRIES = Object.entries(BUILD_CANVAS_FIXTURES) as Array<[string, BuildCanvasFixture]>;

function chainsOf(fixture: BuildCanvasFixture) {
  return [...fixture.input.hub.chains, ...fixture.input.spokes.flatMap((s) => s.chains)];
}

describe("buildCanvasFixtures", () => {
  it.each(ENTRIES)("%s maps every block id to its content, and only those", (_name, fixture) => {
    const ids = chainsOf(fixture).flatMap((c) => c.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(fixture.content).sort()).toEqual([...ids].sort());
  });

  it.each(ENTRIES)("%s has unique chain ids and spoke networks", (_name, fixture) => {
    const chainIds = chainsOf(fixture).map((c) => c.id);
    expect(new Set(chainIds).size).toBe(chainIds.length);
    const networks = [fixture.input.hubNetwork, ...fixture.input.spokes.map((s) => s.network)];
    expect(new Set(networks).size).toBe(networks.length);
  });

  // @rule C8
  it.each(ENTRIES)("%s keeps every share within the node above it", (_name, fixture) => {
    const { hub, spokes } = fixture.input;
    const top = [...hub.chains, ...spokes].reduce((sum, n) => sum + n.sharePct, 0);
    expect(top).toBeLessThanOrEqual(100);
    for (const spoke of spokes) {
      const inner = spoke.chains.reduce((sum, c) => sum + c.sharePct, 0);
      expect(inner).toBeLessThanOrEqual(spoke.sharePct);
    }
  });

  it.each(ENTRIES)("%s gives every chain at least one position block", (_name, fixture) => {
    for (const chain of chainsOf(fixture)) {
      expect(chain.steps.some((s) => s.family === "position")).toBe(true);
    }
  });

  it("names the Figma frame of every drawn fixture and none for the undrawn ones", () => {
    const drawn = ENTRIES.filter(([, f]) => f.figmaNode !== null).map(([name]) => name);
    expect(drawn.sort()).toEqual(
      ["buildState3", "buildState5", "canvasA", "canvasB", "canvasC", "canvasD"].sort(),
    );
    for (const [, f] of ENTRIES) {
      if (f.figmaNode !== null) expect(f.figmaNode).toMatch(/^\d+:\d+$/);
    }
  });

  it("draws canvas A with 10 positions on 3 networks", () => {
    const { canvasA } = BUILD_CANVAS_FIXTURES;
    const positions = chainsOf(canvasA).flatMap((c) =>
      c.steps.filter((s) => s.family === "position"),
    );
    expect(positions).toHaveLength(10);
    expect(canvasA.input.spokes.map((s) => s.network)).toEqual(["base", "robinhood"]);
  });

  it("draws canvas B with no pool, so no Collect fees anywhere", () => {
    const steps = chainsOf(BUILD_CANVAS_FIXTURES.canvasB).flatMap((c) => c.steps);
    expect(steps.some((s) => s.kind === "uniswapV4Pool" || s.kind === "collectFees")).toBe(false);
  });
});
