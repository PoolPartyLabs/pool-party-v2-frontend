/**
 * @id PP-MGR-LIB-052
 * @name manageLayout tests
 * @implements-rules-version v1 (POO-2226)
 * @analytics-events none, pure geometry tests.
 */
import { describe, expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import { layoutManageGraph } from "./manageLayout";
import { normalizeManageModel } from "./manageModel";

describe("Manage geometry", () => {
  it("[R4,R5] cash per chain is 160x136 and every node remains inside graph bounds", () => {
    const model = normalizeManageModel(mockFund);
    const graph = layoutManageGraph(model);
    const cash = graph.nodes.filter((n) => n.kind === "cash");
    expect(cash).toHaveLength(model.chains.length);
    expect(graph.nodes.find((n) => n.kind === "group")?.rect.w).toBe(392);
    expect(cash.every((n) => n.rect.w === 160 && n.rect.h === 136)).toBe(true);
    expect(
      graph.nodes.every(
        (n) =>
          n.rect.x >= 0 &&
          n.rect.y >= 0 &&
          n.rect.x + n.rect.w <= graph.width &&
          n.rect.y + n.rect.h <= graph.height,
      ),
    ).toBe(true);
  });
  it("[R4] puts a derived fee Swap after Collect with separate principal and income edges", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    const collect = graph.nodes.find((n) => n.kind === "flow" && n.flow === "collectFees");
    const conversion = graph.nodes.find((n) => n.kind === "flow" && n.flow === "feeSwap");
    if (!collect || !conversion) throw new Error("missing flow");
    expect(conversion.rect.y).toBe(collect.rect.y + collect.rect.h + 24);
    expect(graph.edges.some((e) => e.tone === "income")).toBe(true);
    expect(graph.edges.some((e) => e.id.startsWith("principal:"))).toBe(true);
    expect(
      graph.nodes.some((n) => "flow" in n && n.flow === "collectFees" && n.chainId === 42161),
    ).toBe(false);
  });
  it("[R2,R5] preserves independent cash for multiple spoke chains and multiple same-pool positions", () => {
    const p = mockFund.positionsSummary?.positions[1];
    if (!p) throw new Error("fixture");
    const model = normalizeManageModel({
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2",
        positions: [p, { ...p, positionKey: `0x${"5".repeat(64)}` }, { ...p, chainId: "8453" }],
      },
    });
    const graph = layoutManageGraph(model);
    expect(graph.nodes.filter((n) => n.kind === "position")).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.kind === "cash")).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.kind === "group")).toHaveLength(2);
  });
});
