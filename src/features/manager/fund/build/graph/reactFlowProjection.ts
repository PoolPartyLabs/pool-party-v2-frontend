/**
 * @id PP-MGR-LIB-074 (POO-2302)
 * @name reactFlowProjection
 * @implements-rules-version v1
 * @analytics-events none, pure presentation projection of declared financial ports.
 */
import { type Edge, type Node, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { PieceEdge, PiecePoint } from "../pieces/pieceTypes";
import type { FinancialPort, SemanticGraph } from "./semanticGraph";

export type FinancialNode = Node<
  {
    surface: ReactNode;
    ports: readonly FinancialPort[];
    minimumHeight?: number;
    interactive: boolean;
  },
  "financial"
>;
export type FinancialEdge = Edge<
  {
    points: PieceEdge["points"];
    tone: PieceEdge["tone"];
    highlighted: boolean;
    onHoverChange?: (id: string | null) => void;
  },
  "financial"
>;
/** A presentation-only node has no financial handles and cannot establish an adjacency. */
export interface FinancialGraphDecoration {
  id: string;
  surface: ReactNode;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  zIndex?: number;
  interactive?: boolean;
}
export interface FinancialGraphPresentation {
  /** First paint and reduced-motion state come from the existing renderer. */
  motion?: boolean;
  semantic: SemanticGraph;
  paths: readonly PieceEdge[];
  surfaces: ReadonlyMap<string, ReactNode>;
  decorations?: readonly FinancialGraphDecoration[];
  readingOrder?: readonly string[];
  highlightedIds?: ReadonlySet<string>;
  onEdgeHoverChange?(id: string | null): void;
}
const FIXED_NODE = {
  draggable: false,
  connectable: false,
  selectable: false,
  focusable: false,
  deletable: false,
} as const;
/** A rendering projection never introduces connections absent from the financial graph. */
export function projectReactFlowGraph(input: FinancialGraphPresentation): {
  nodes: FinancialNode[];
  edges: FinancialEdge[];
} {
  const nodes: FinancialNode[] = input.semantic.nodes.flatMap((node) => {
    const surface = input.surfaces.get(node.id);
    if (
      surface === undefined ||
      ![node.rect.x, node.rect.y, node.rect.w, node.rect.h].every(Number.isFinite) ||
      node.rect.w <= 0 ||
      node.rect.h <= 0
    )
      return [];
    return [
      {
        id: node.id,
        type: "financial" as const,
        position: { x: node.rect.x, y: node.rect.y },
        style: {
          width: node.rect.w,
          minHeight: node.rect.h,
          padding: 0,
          border: 0,
          transition: input.motion ? "transform 150ms ease-out" : undefined,
        },
        className: "motion-reduce:!transition-none",
        initialWidth: node.rect.w,
        initialHeight: node.rect.h,
        zIndex: 2,
        ...FIXED_NODE,
        data: {
          surface,
          minimumHeight: node.rect.h,
          interactive: true,
          ports: input.semantic.ports.filter((port) => port.nodeId === node.id),
        },
      },
    ];
  });
  const financialNodeIds = new Set(nodes.map((node) => node.id));
  for (const decoration of input.decorations ?? []) {
    if (financialNodeIds.has(decoration.id)) continue;
    nodes.push({
      id: decoration.id,
      type: "financial",
      position: decoration.position,
      style: { width: decoration.width, height: decoration.height, padding: 0, border: 0 },
      initialWidth: decoration.width,
      initialHeight: decoration.height,
      zIndex: decoration.zIndex ?? 2,
      ...FIXED_NODE,
      data: {
        surface: decoration.surface,
        ports: [],
        interactive: decoration.interactive ?? false,
      },
    });
  }
  if (input.readingOrder) {
    const order = new Map(input.readingOrder.map((id, index) => [id, index]));
    nodes.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }
  const ports = new Map(input.semantic.ports.map((port) => [port.id, port]));
  const paths = new Map(input.paths.map((path) => [path.id, path]));
  const edges: FinancialEdge[] = input.semantic.connections.flatMap((connection) => {
    const path = paths.get(connection.id);
    const source = ports.get(connection.sourcePortId);
    const target = ports.get(connection.targetPortId);
    if (
      !path ||
      path.points.length < 2 ||
      path.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
      !source ||
      !target ||
      !Number.isFinite(source.offset) ||
      source.offset < 0 ||
      source.offset > 1 ||
      !Number.isFinite(target.offset) ||
      target.offset < 0 ||
      target.offset > 1 ||
      source.direction !== "out" ||
      target.direction !== "in" ||
      !financialNodeIds.has(source.nodeId) ||
      !financialNodeIds.has(target.nodeId)
    )
      return [];
    return [
      {
        id: connection.id,
        type: "financial" as const,
        source: source.nodeId,
        target: target.nodeId,
        sourceHandle: source.id,
        targetHandle: target.id,
        reconnectable: false,
        selectable: false,
        focusable: false,
        deletable: false,
        zIndex: 1,
        data: {
          points: path.points,
          tone: path.tone,
          highlighted: input.highlightedIds?.has(connection.id) ?? false,
          onHoverChange: input.onEdgeHoverChange,
        },
      },
    ];
  });
  return { nodes, edges };
}

function simplify(points: readonly PiecePoint[]): PiecePoint[] {
  const result: PiecePoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    result.push(point);
    while (result.length > 2) {
      const a = result.at(-3),
        b = result.at(-2),
        c = result.at(-1);
      if (!a || !b || !c) break;
      const between =
        (a.x === b.x && b.x === c.x && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y)) ||
        (a.y === b.y && b.y === c.y && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x));
      if (!between) break;
      result.splice(result.length - 2, 1);
    }
  }
  return result;
}
const vertical = (side: Position) => side === Position.Top || side === Position.Bottom;
/** Preserve declared interior bends, joining changed measured borders with orthogonal elbows. */
export function measuredFinancialPoints(
  points: PieceEdge["points"],
  source: PiecePoint,
  target: PiecePoint,
  sourceSide: Position,
  targetSide: Position,
): PieceEdge["points"] {
  const interior = points.slice(1, -1);
  const first = interior[0],
    last = interior.at(-1);
  if (!first || !last) {
    if (source.x === target.x || source.y === target.y) return [source, target];
    if (vertical(sourceSide) && vertical(targetSide)) {
      const y = (source.y + target.y) / 2;
      return [source, { x: source.x, y }, { x: target.x, y }, target];
    }
    if (!vertical(sourceSide) && !vertical(targetSide)) {
      const x = (source.x + target.x) / 2;
      return [source, { x, y: source.y }, { x, y: target.y }, target];
    }
    return [
      source,
      vertical(sourceSide) ? { x: source.x, y: target.y } : { x: target.x, y: source.y },
      target,
    ];
  }
  if (interior.length === 1 && vertical(sourceSide) !== vertical(targetSide))
    return simplify([
      source,
      vertical(sourceSide) ? { x: source.x, y: target.y } : { x: target.x, y: source.y },
      target,
    ]);
  const routed = interior.map((point) => ({ ...point }));
  routed[0] = vertical(sourceSide) ? { x: source.x, y: first.y } : { x: first.x, y: source.y };
  const lastIndex = routed.length - 1;
  routed[lastIndex] = vertical(targetSide)
    ? { x: target.x, y: last.y }
    : { x: last.x, y: target.y };
  const result: PiecePoint[] = [source];
  for (const [index, point] of [...routed, target].entries()) {
    const previous = result.at(-1);
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      // A shared bend moved on two axes; retain the router's corridor on the unaffected axis.
      result.push(
        vertical(sourceSide) && index === 0
          ? { x: previous.x, y: point.y }
          : { x: point.x, y: previous.y },
      );
    }
    result.push(point);
  }
  return simplify(result);
}
