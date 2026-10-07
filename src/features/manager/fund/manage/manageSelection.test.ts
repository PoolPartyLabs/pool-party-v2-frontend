/**
 * @id PP-MGR-LIB-067
 * @name manageSelection tests
 * @implements-rules-version v2 (POO-2274)
 * @analytics-events none, pure inspection identity tests
 */
import { describe, expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import { layoutManageGraph } from "./manageLayout";
import { normalizeManageModel } from "./manageModel";
import { deriveManageInspection, resolveManageInspection } from "./manageSelection";

describe("Manage inspection identity", () => {
  it("lists actual topology exactly once and preserves canonical position callbacks", () => {
    const model = normalizeManageModel(mockFund);
    const layout = layoutManageGraph(model);
    const inspection = deriveManageInspection(model, layout);
    expect(new Set(inspection.nodes.map((node) => node.id))).toEqual(
      new Set(layout.nodes.filter((node) => node.kind !== "group").map((node) => node.id)),
    );
    for (const node of inspection.nodes.filter((node) => node.kind === "position")) {
      expect(node.selectionId).toBe(node.position?.id);
      expect(resolveManageInspection(inspection, node.selectionId)).toBe(node);
    }
    expect(inspection.networks[0]?.nodes.slice(0, 3).map((node) => node.kind)).toEqual([
      "deposit",
      "idleInput",
      "cash",
    ]);
    expect(inspection.networks[0]?.nodes.slice(-3).map((node) => node.kind)).toEqual([
      "idleOutput",
      "income",
      "withdraw",
    ]);
  });
  it("resolves only exact position ownership and never grants an aggregate Bridge an operation owner", () => {
    const model = normalizeManageModel(mockFund);
    const inspection = deriveManageInspection(model);
    expect(
      inspection.nodes
        .filter((node) => node.kind === "bridge")
        .every((node) => node.position === null),
    ).toBe(true);
    const collect = inspection.nodes.find((node) => node.kind === "collectFees");
    expect(collect?.position?.kind).toBe("liquidity");
    const layout = layoutManageGraph(model);
    const flow = layout.nodes.find((node) => node.kind === "flow" && node.flow === "collectFees");
    if (!flow) throw new Error("Missing fee flow");
    flow.positionId = "unserved-position";
    expect(
      deriveManageInspection(model, layout).nodes.find((node) => node.id === flow.id)?.position,
    ).toBeNull();
    expect(resolveManageInspection(inspection, "missing")).toBeNull();
  });
  it("keeps hub first, each spoke grouped and inbound before outbound without coordinate inference", () => {
    const model = normalizeManageModel(mockFund);
    const layout = layoutManageGraph(model);
    layout.nodes = layout.nodes.map((node) => ({ ...node, rect: { ...node.rect, x: 0, y: 0 } }));
    const inspection = deriveManageInspection(model, layout);
    for (const network of inspection.networks.filter((network) => !network.hub)) {
      expect(network.nodes[0]?.direction).toBe("inbound");
      expect(network.nodes.at(-1)?.direction).toBe("outbound");
      expect(network.nodes.every((node) => node.chainId === network.chainId)).toBe(true);
    }
  });
});
