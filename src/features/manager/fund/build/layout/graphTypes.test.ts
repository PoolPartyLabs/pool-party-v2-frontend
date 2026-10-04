/**
 * @id PP-MGR-LIB-023
 * @name graphTypes tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a pure key function: nothing here is rendered or tracked.
 *
 * `targetKey` is the string the renderer (S6) writes into `data-graph-target` and the drag of the
 * palette (S5) looks up in `activeTargetKeys`, so two different targets must never share a key, and
 * the same target must always give the same key.
 */
import { describe, expect, it } from "vitest";
import { canvasA, canvasB } from "@/mocks/data/buildCanvasFixtures";
import { type GraphTarget, targetKey } from "./graphTypes";
import { layoutGraph } from "./layoutGraph";

const TARGETS: GraphTarget[] = [
  { kind: "addProtocol", network: "arbitrum" },
  { kind: "addProtocol", network: "robinhood" },
  { kind: "addNetwork" },
  { kind: "port", side: "before", blockId: "a" },
  { kind: "port", side: "after", blockId: "a" },
  { kind: "port", side: "before", blockId: "b" },
  { kind: "block", blockId: "a" },
  { kind: "block", blockId: "b" },
  { kind: "shareLabel", chainId: "c1", network: "arbitrum", feedsBlockId: "a" },
  { kind: "shareLabel", chainId: "c1", network: "arbitrum", feedsBlockId: null },
  { kind: "shareLabel", chainId: null, network: "robinhood", feedsBlockId: null },
  { kind: "shareLabel", chainId: null, network: null, feedsBlockId: null },
  // Separators and the null marker inside ids must not make two targets collide.
  { kind: "shareLabel", chainId: "x:y", network: "z", feedsBlockId: null },
  { kind: "shareLabel", chainId: "x", network: "y:z", feedsBlockId: null },
  { kind: "shareLabel", chainId: "~", network: null, feedsBlockId: null },
  { kind: "shareLabel", chainId: null, network: "~", feedsBlockId: null },
  { kind: "shareLabel", chainId: "", network: null, feedsBlockId: null },
  { kind: "port", side: "before", blockId: "after:a" },
  { kind: "block", blockId: "port:before:a" },
];

describe("targetKey", () => {
  it("gives a different key to every different target", () => {
    const keys = TARGETS.map(targetKey);
    expect(new Set(keys).size).toBe(TARGETS.length);
  });

  it("gives the same key to equal targets (stable across calls and copies)", () => {
    for (const target of TARGETS) {
      expect(targetKey(structuredClone(target))).toBe(targetKey(target));
    }
  });

  it("reads plainly for the common targets", () => {
    expect(targetKey({ kind: "addProtocol", network: "arbitrum" })).toBe("addProtocol:arbitrum");
    expect(targetKey({ kind: "addNetwork" })).toBe("addNetwork");
    expect(targetKey({ kind: "port", side: "after", blockId: "b-1" })).toBe("port:after:b-1");
    expect(targetKey({ kind: "block", blockId: "b-1" })).toBe("block:b-1");
  });

  it("is unique across every target a reference canvas lays out", () => {
    for (const fixture of [canvasA, canvasB]) {
      const layout = layoutGraph(fixture.input, { startHereWidth: 420 });
      const targets: GraphTarget[] = [
        ...layout.templates.map((t) => t.target),
        ...layout.ports.map((p) => p.target),
        ...layout.shareLabels.map((l) => l.target),
        ...layout.blocks
          .filter((b) => b.family === "position")
          .map((b): GraphTarget => ({ kind: "block", blockId: b.id })),
      ];
      const keys = targets.map(targetKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
