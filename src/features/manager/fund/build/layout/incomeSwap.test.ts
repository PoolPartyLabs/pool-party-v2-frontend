/**
 * @id PP-MGR-LIB-023
 * @name incomeSwap tests
 * @implements-rules-version v1 (POO-2213)
 * @analytics-events none, pure canvas geometry
 */
import { describe, expect, it } from "vitest";
import { BUILD_CANVAS_FIXTURES } from "@/mocks/data/buildCanvasFixtures";
import { LAYOUT } from "./layoutConstants";
import { layoutGraph } from "./layoutGraph";

describe("fee conversion return path (POO-2213)", () => {
  it.each(
    Object.entries(BUILD_CANVAS_FIXTURES),
  )("adds one conversion per fee branch: %s", (_name, fixture) => {
    const before = JSON.stringify(fixture.input);
    const graph = layoutGraph(fixture.input, { startHereWidth: 420 });
    const fees = graph.blocks.filter((block) => block.kind === "collectFees");
    expect(graph.feeSwaps ?? []).toHaveLength(fees.length);
    for (const fee of fees) {
      const swap = graph.feeSwaps?.find((entry) => entry.sourceBlockId === fee.id);
      expect(swap).toBeDefined();
      if (!swap) throw new Error("Missing conversion");
      expect(swap.rect.y).toBe(fee.rect.y + fee.rect.h + LAYOUT.LINK);
      expect(swap.rect.x).toBe(fee.rect.x);
      expect(graph.ports.some((port) => port.target.blockId === `fee-swap:${fee.id}`)).toBe(false);
      const group = graph.groups.find((entry) => entry.network === fee.network);
      if (group) expect(swap.rect.y + swap.rect.h).toBeLessThan(group.rect.y + group.rect.h);
      expect(
        graph.edges.find((edge) => edge.id === `income:converted:${fee.id}`)?.points[0]?.y,
      ).toBe(swap.rect.y + swap.rect.h);
    }
    expect(JSON.stringify(fixture.input)).toBe(before);
  });
  it("removes the derived conversion when its source Collect fees is removed", () => {
    const input = structuredClone(BUILD_CANVAS_FIXTURES.canvasC.input);
    const before = layoutGraph(input, { startHereWidth: 420 });
    expect(before.feeSwaps).toHaveLength(1);
    for (const chain of input.hub.chains) {
      chain.steps = chain.steps.filter((step) => step.id !== "c-pool-fees");
    }
    const rebuilt = layoutGraph(input, { startHereWidth: 420 });
    expect(rebuilt.feeSwaps ?? []).toHaveLength(0);
    expect(rebuilt.edges.some((edge) => edge.id.includes("c-pool-fees"))).toBe(false);
  });
});

describe("Build connection polish (POO-2235)", () => {
  it("locks every fixed spine and keeps Income outgoing capital neutral", () => {
    const graph = layoutGraph(BUILD_CANVAS_FIXTURES.canvasC.input, { startHereWidth: 420 });
    expect(graph.spine).toHaveLength(5);
    expect(graph.spine.every((node) => node.locked)).toBe(true);
    expect(graph.edges.find((edge) => edge.id === "output:income")?.kind).toBe("structural");
  });
  it("joins bus centerlines and exposes clipped block-to-block connections", () => {
    const graph = layoutGraph(BUILD_CANVAS_FIXTURES.canvasC.input, { startHereWidth: 420 });
    const bus = graph.edges.find((edge) => edge.id === "bus:idleInput");
    const stub = graph.edges.find((edge) => edge.id === "stub:chain:c-pool");
    expect(bus).toBeDefined();
    expect(stub?.points[0]?.y).toBe(bus?.points[0]?.y);
    const connection = graph.connections?.find((entry) => entry.id === "stub:chain:c-pool");
    expect(connection?.points.length).toBeGreaterThan(2);
    expect(connection?.points.at(-1)?.y).toBe(graph.blocks[0]?.rect.y);
    expect(connection?.points[0]?.x).toBe(graph.spineCentreX);
  });
});

it("clips sibling principal paths and links income conversion as two separate connections (POO-2235)", () => {
  const graph = layoutGraph(BUILD_CANVAS_FIXTURES.canvasC.input, { startHereWidth: 420 });
  const pool = graph.connections?.find((entry) => entry.id === "principal:chain:c-pool");
  const supply = graph.connections?.find((entry) => entry.id === "principal:chain:c-supply");
  const output = graph.spine.find((entry) => entry.role === "idleOutput");
  expect(pool?.points.at(-1)).toEqual({ x: (output?.rect.x ?? 0) + 118, y: output?.rect.y });
  expect(supply?.points.at(-1)).toEqual(pool?.points.at(-1));
  expect(pool?.points.some((point) => point.x === 320)).toBe(false);
  expect(
    graph.connections?.find((entry) => entry.id === "income:block:c-pool-fees")?.points.at(-1)?.y,
  ).toBe(graph.feeSwaps?.[0]?.rect.y);
});
