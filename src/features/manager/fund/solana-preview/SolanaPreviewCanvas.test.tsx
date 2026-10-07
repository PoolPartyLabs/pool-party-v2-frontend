/**
 * @id PP-MGR-CMP-088
 * @name SolanaPreviewCanvas tests
 * @implements-rules-version v2 (POO-2281)
 */
import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PreviewBlock } from "./previewModel";
import { getPreviewGeometry, getPreviewNode, SolanaPreviewCanvas } from "./SolanaPreviewCanvas";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ number: (value: number) => `${value * 100}%` }),
}));
vi.mock("../build/canvas/CanvasViewport", () => ({
  CanvasViewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../build/pieces/SpokeGroup", () => ({ SpokeGroup: () => null }));
vi.mock("../build/pieces/SpineCard", () => ({ SpineCard: () => null }));
vi.mock("../build/pieces/FlowPill", () => ({ FlowPill: () => null }));

it("keeps LP fee paths green through the return bridge until hub Income, then gray", () => {
  const { container } = render(
    <SolanaPreviewCanvas
      blocks={[
        { id: "kamino", protocol: "kamino", allocationBps: 5000, pair: "SOL / USDC" },
        { id: "orca", protocol: "orca", allocationBps: 5000, pair: "SOL / USDC" },
      ]}
      selectedId={null}
      onSelect={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  expect(container.querySelector('[data-edge-id="kamino-fees"]')).toBeNull();
  expect(container.querySelector('[data-edge-id="kamino-swap-entry"]')).toBeNull();
  expect(container.querySelector('[data-edge-id="kamino-principal"]')).toHaveAttribute(
    "data-edge-tone",
    "muted",
  );
  expect(container.querySelector('[data-edge-id="orca-fees"]')).toHaveAttribute(
    "data-edge-tone",
    "income",
  );
  expect(container.querySelector('[data-edge-id="orca-collected"]')).toHaveAttribute(
    "data-edge-tone",
    "income",
  );
  expect(container.querySelector('[data-edge-id="income-outgoing"]')).toHaveAttribute(
    "data-edge-tone",
    "muted",
  );
  expect(container.querySelector('[data-edge-id="return-idle"]')).toHaveAttribute(
    "data-edge-tone",
    "muted",
  );
  expect(container.querySelector('[data-edge-id="bridge-out"]')).toHaveAttribute(
    "data-edge-tone",
    "muted",
  );
  expect(container.querySelector('[data-edge-id="principal-withdraw"]')).toHaveAttribute(
    "data-edge-tone",
    "muted",
  );
});

const protocols: PreviewBlock[] = ["kamino", "jupiter", "raydium", "orca"].map(
  (protocol, index) => ({
    id: `block-${index}`,
    protocol: protocol as PreviewBlock["protocol"],
    allocationBps: 2500,
    pair: "SOL / USDC",
  }),
);
describe("canvas geometry regressions", () => {
  // @rule POO-2291 R6: Holding routes use conversion when required, gray principal and no LP fees.
  it("routes Holding principal through its own automatic conversions without LP collection", () => {
    const graph = getPreviewGeometry([
      { id: "holding-a", protocol: "holding", allocationBps: 3000, pair: "SOL / USDC" },
    ]);
    expect(graph.nodes["holding-a-input-swap"]).toBeDefined();
    expect(graph.nodes["holding-a-output-swap"]).toBeDefined();
    expect(graph.nodes["holding-a-collect"]).toBeUndefined();
    expect(graph.connections.find((edge) => edge.id === "holding-a-entry")).toMatchObject({
      source: "solana-idle",
      target: "holding-a-input-swap",
      tone: "muted",
    });
    expect(graph.connections.find((edge) => edge.id === "holding-a-principal")).toMatchObject({
      source: "holding-a",
      target: "holding-a-output-swap",
      tone: "muted",
    });
    expect(graph.connections.find((edge) => edge.id === "holding-a-return-idle")).toMatchObject({
      source: "holding-a-output-swap",
      target: "solana-idle-output",
      tone: "muted",
    });
    expect(
      graph.connections.some(
        (edge) => edge.source.startsWith("holding-a") && edge.tone === "income",
      ),
    ).toBe(false);
  });
  it("bypasses conversion when a Holding drawing uses the same USDC as Idle", () => {
    const graph = getPreviewGeometry([
      { id: "holding-usdc", protocol: "holding", allocationBps: 3000, pair: "USDC / SOL" },
    ]);
    expect(graph.nodes["holding-usdc-input-swap"]).toBeUndefined();
    expect(graph.nodes["holding-usdc-output-swap"]).toBeUndefined();
    expect(graph.connections.find((edge) => edge.id === "holding-usdc-entry")).toMatchObject({
      source: "solana-idle",
      target: "holding-usdc",
      tone: "muted",
    });
    expect(graph.connections.find((edge) => edge.id === "holding-usdc-principal")).toMatchObject({
      source: "holding-usdc",
      target: "solana-idle-output",
      tone: "muted",
    });
  });
  // @rule R8: every drawing size includes native cash centered to the right of Idle.
  it.each([
    { blocks: [] },
    { blocks: protocols.slice(0, 1) },
    { blocks: protocols },
  ])("contains every node and the Solana cash/Idle in the spoke ($blocks.length blocks)", ({
    blocks,
  }) => {
    const graph = getPreviewGeometry(blocks);
    expect(Object.keys(graph.nodes).length).toBeGreaterThan(0);
    for (const rect of Object.values(graph.nodes)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(graph.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(graph.height);
    }
    for (const id of ["solana-idle", "solana-idle-output", "operating-cash"]) {
      const rect = getPreviewNode(graph.nodes, id);
      expect(rect).toBeDefined();
      expect(rect.x).toBeGreaterThanOrEqual(graph.spoke.x);
      expect(rect.y).toBeGreaterThanOrEqual(graph.spoke.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(graph.spoke.x + graph.spoke.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(graph.spoke.y + graph.spoke.height);
    }
    expect(Object.keys(graph.nodes).filter((id) => id.startsWith("bridge-"))).toHaveLength(2);
    const cash = getPreviewNode(graph.nodes, "operating-cash"),
      idle = getPreviewNode(graph.nodes, "solana-idle");
    expect([cash.width, cash.height]).toEqual([144, 96]);
    expect(cash.y + cash.height / 2).toBe(idle.y + idle.height / 2);
    expect(cash.x).toBeGreaterThan(idle.x + idle.width);
  });
  // @rule R8: LP fees pass through the return bridge before reaching the hub Income.
  it("uses a single hub Income with neutral outgoing paths and fees routed through the bridge", () => {
    const graph = getPreviewGeometry(protocols);
    const incomeIds = Object.keys(graph.nodes).filter((id) => id.endsWith("-income"));
    expect(incomeIds).toEqual(["hub-income"]);
    for (const block of protocols.filter(
      (block) => block.protocol === "raydium" || block.protocol === "orca",
    )) {
      expect(
        graph.connections.find((edge) => edge.source === `${block.id}-auto-swap`),
      ).toMatchObject({
        target: "bridge-out",
        tone: "income",
      });
    }
    expect(graph.connections.filter((edge) => incomeIds.includes(edge.source))).toEqual([
      expect.objectContaining({ target: "hub-withdraw", tone: "muted" }),
    ]);
  });
  it("aligns complete orthogonal connection endpoints to the actual source/target boundaries", () => {
    const mixedBlocks: PreviewBlock[] = [
      ...protocols,
      { id: "holding-converted", protocol: "holding", allocationBps: 0, pair: "SOL / USDC" },
      { id: "holding-direct", protocol: "holding", allocationBps: 0, pair: "USDC / SOL" },
    ];
    const graph = getPreviewGeometry(mixedBlocks);
    expect(graph.connections.length).toBeGreaterThan(10);
    for (const connection of graph.connections) {
      const boundary = (id: string, point: { x: number; y: number }) => {
        const rect = getPreviewNode(graph.nodes, id);
        const horizontal =
          (point.x === rect.x || point.x === rect.x + rect.width) &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height;
        const vertical =
          (point.y === rect.y || point.y === rect.y + rect.height) &&
          point.x >= rect.x &&
          point.x <= rect.x + rect.width;
        expect(horizontal || vertical, `${connection.id} endpoint on ${id}`).toBe(true);
      };
      const first = connection.points[0];
      const last = connection.points[connection.points.length - 1];
      if (!first || !last) throw new Error("A connection needs two endpoints");
      boundary(connection.source, first);
      boundary(connection.target, last);
      connection.points.slice(1).forEach((point, i) => {
        const previous = connection.points[i];
        if (!previous) throw new Error("A segment needs two endpoints");
        expect(point.x === previous.x || point.y === previous.y).toBe(true);
      });
    }
    for (const block of mixedBlocks) {
      const path = graph.connections.find(
        (connection) => connection.id === `${block.id}-principal`,
      );
      expect(path).toBeDefined();
      expect(path?.points[0]?.x).toBe(getPreviewNode(graph.nodes, block.id).x);
      expect(path?.target).toBe(
        block.id === "holding-converted" ? `${block.id}-output-swap` : "solana-idle-output",
      );
      expect(path?.tone).toBe("muted");
    }
  });
  it("never shares a collinear segment between gray principal and green fees", () => {
    const graph = getPreviewGeometry([
      ...protocols,
      { id: "holding-converted", protocol: "holding", allocationBps: 0, pair: "SOL / USDC" },
      { id: "holding-direct", protocol: "holding", allocationBps: 0, pair: "USDC / SOL" },
    ]);
    expect(graph.edges.some((edge) => edge.tone === "income")).toBe(true);
    const segments = (tone: string) =>
      graph.edges
        .filter((edge) => edge.tone === tone)
        .flatMap((edge) =>
          edge.points.slice(1).map((b, i) => {
            const a = edge.points[i];
            if (!a) throw new Error("A segment needs two endpoints");
            return { a, b };
          }),
        );
    for (const gray of segments("muted"))
      for (const green of segments("income")) {
        const horizontal =
          gray.a.y === gray.b.y && green.a.y === green.b.y && gray.a.y === green.a.y;
        const vertical = gray.a.x === gray.b.x && green.a.x === green.b.x && gray.a.x === green.a.x;
        const overlaps = (axis: "x" | "y") =>
          Math.min(Math.max(gray.a[axis], gray.b[axis]), Math.max(green.a[axis], green.b[axis])) >
          Math.max(Math.min(gray.a[axis], gray.b[axis]), Math.min(green.a[axis], green.b[axis]));
        expect((horizontal && overlaps("x")) || (vertical && overlaps("y"))).toBe(false);
      }
    expect(graph.connections.find((edge) => edge.id === "block-2-fee-swap-bridge")?.tone).toBe(
      "income",
    );
    expect(graph.connections.find((edge) => edge.id === "bridge-fees-income")?.target).toBe(
      "hub-income",
    );
    expect(graph.connections.find((edge) => edge.id === "income-outgoing")?.tone).toBe("muted");
  });
  it("highlights one complete protocol-to-Idle path without highlighting its siblings", () => {
    const { container } = render(
      <SolanaPreviewCanvas
        blocks={protocols}
        selectedId={null}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const hit = container.querySelector('[data-edge-hit="block-2-principal"]');
    expect(hit).not.toBeNull();
    fireEvent.pointerEnter(hit as Element);
    const highlighted = container.querySelector('[data-connection-id="block-2-principal"]');
    expect(highlighted).not.toBeNull();
    const path = getPreviewGeometry(protocols).connections.find(
      (edge) => edge.id === "block-2-principal",
    );
    expect(highlighted).toHaveAttribute(
      "points",
      path?.points.map((point) => `${point.x},${point.y}`).join(" "),
    );
    expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(1);
    expect(container.querySelector('[data-connection-id="block-3-principal"]')).toBeNull();
    fireEvent.pointerLeave(hit as Element);
    expect(container.querySelector("[data-highlighted]")).toBeNull();
  });
});
