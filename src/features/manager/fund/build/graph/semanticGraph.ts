/**
 * @id PP-MGR-LIB-062
 * @name semanticGraph
 * @description Explicit financial endpoints, stable identities and deterministic graph integrity.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=7992-868
 * @linear https://linear.app/yeildbay/issue/POO-2288
 * @implements-rules-version v1 (POO-2288)
 * @analytics-events none, pure graph contract; Build and Manage hosts own user events.
 */
import type { Point, Rect } from "../layout/graphTypes";

export type FlowClass = "structural" | "principal" | "income" | "repayment" | "template";
export interface SemanticNode {
  id: string;
  kind: "structural" | "position" | "holding" | "conversion" | "bridge";
  network: string;
  rect: Rect;
  bridge?: { fromNetwork: string; toNetwork: string; direction: "inbound" | "outbound" };
}
export interface FinancialPort {
  id: string;
  nodeId: string;
  direction: "in" | "out";
  class: FlowClass;
  network: string;
  originId: string | null;
  side: "top" | "right" | "bottom" | "left";
  /** Fraction along the actual border, from left to right or top to bottom. */
  offset: number;
}
export interface SemanticJunction {
  id: string;
  class: FlowClass;
  network: string;
  /** Null permits explicitly declared aggregation of origins within the same class. */
  originId: string | null;
  point: Point;
}
export type SemanticEndpoint = { kind: "port" | "junction"; id: string };
export interface SemanticSegment {
  id: string;
  connectionId: string;
  from: SemanticEndpoint;
  to: SemanticEndpoint;
}
export interface SemanticConnection {
  id: string;
  class: FlowClass;
  originId: string | null;
  sourcePortId: string;
  targetPortId: string;
  /** Owned segments in traversal order; coincident geometry never establishes ownership. */
  segmentIds: readonly string[];
}
export interface SemanticGraph {
  nodes: readonly SemanticNode[];
  ports: readonly FinancialPort[];
  junctions: readonly SemanticJunction[];
  segments: readonly SemanticSegment[];
  connections: readonly SemanticConnection[];
}
export interface SemanticIssue {
  code:
    | "duplicate_id"
    | "dangling_endpoint"
    | "dangling_segment"
    | "inconsistent_port"
    | "type_conflict"
    | "origin_conflict"
    | "route_break"
    | "orphan_conversion"
    | "same_chain_bridge";
  id: string;
}
export interface ResolvedSemanticPath {
  id: string;
  class: FlowClass;
  points: Point[];
}

const part = (value: string) => encodeURIComponent(value).replace(/~/g, "%7E");
/** Existing render keys remain intact; a second Bridge direction receives a separate identity. */
export function semanticNodeId(
  kind: "spine" | "block" | "bridge" | "group" | "fee-swap",
  origin: string,
  direction?: "inbound" | "outbound",
): string {
  return `${kind}:${encodeURIComponent(origin)}${direction === "outbound" ? ":outbound" : ""}`;
}
export function financialPortId(nodeId: string, role: string): string {
  return `financial-port:${part(nodeId)}:${part(role)}`;
}
export function semanticConnectionId(
  sourcePortId: string,
  targetPortId: string,
  flowClass: FlowClass,
  originId: string | null,
): string {
  return `connection:${part(sourcePortId)}:${part(targetPortId)}:${flowClass}:${originId === null ? "~" : part(originId)}`;
}
export function semanticJunctionId(
  role: string,
  network: string,
  flowClass: FlowClass,
  originId: string | null,
): string {
  return `junction:${part(role)}:${part(network)}:${flowClass}:${originId === null ? "~" : part(originId)}`;
}
export function semanticSegmentId(connectionId: string, role: string): string {
  return `segment:${part(connectionId)}:${part(role)}`;
}
export function resolvePortPoint(node: SemanticNode, port: FinancialPort): Point {
  const { x, y, w, h } = node.rect;
  const horizontal = port.side === "top" || port.side === "bottom";
  return horizontal
    ? { x: x + w * port.offset, y: y + (port.side === "bottom" ? h : 0) }
    : { x: x + (port.side === "right" ? w : 0), y: y + h * port.offset };
}

const endpointKey = (endpoint: SemanticEndpoint) => `${endpoint.kind}:${endpoint.id}`;
const finitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const validRect = (rect: Rect) =>
  finitePoint(rect) &&
  Number.isFinite(rect.w) &&
  Number.isFinite(rect.h) &&
  rect.w > 0 &&
  rect.h > 0;

/** All diagnostics are deterministic. No coordinate/color proximity is treated as a junction. */
export function validateSemanticGraph(graph: SemanticGraph): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const add = (code: SemanticIssue["code"], id: string) => {
    if (!issues.some((issue) => issue.code === code && issue.id === id)) issues.push({ code, id });
  };
  const ids = new Set<string>();
  for (const item of [
    ...graph.nodes,
    ...graph.ports,
    ...graph.junctions,
    ...graph.segments,
    ...graph.connections,
  ]) {
    if (!item.id || ids.has(item.id)) add("duplicate_id", item.id);
    ids.add(item.id);
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ports = new Map(graph.ports.map((port) => [port.id, port]));
  const junctions = new Map(graph.junctions.map((junction) => [junction.id, junction]));
  const segments = new Map(graph.segments.map((segment) => [segment.id, segment]));
  const connections = new Map(graph.connections.map((connection) => [connection.id, connection]));
  for (const node of graph.nodes) {
    if (!validRect(node.rect)) add("inconsistent_port", node.id);
    if (node.kind === "bridge") {
      if (!node.bridge) add("inconsistent_port", node.id);
      else if (node.bridge.fromNetwork === node.bridge.toNetwork) add("same_chain_bridge", node.id);
    } else if (node.bridge) add("inconsistent_port", node.id);
  }
  for (const port of graph.ports) {
    const node = nodes.get(port.nodeId);
    if (!node) add("dangling_endpoint", port.id);
    const validNetwork = node?.bridge
      ? [node.bridge.fromNetwork, node.bridge.toNetwork].includes(port.network)
      : node?.network === port.network;
    if (!validNetwork || !Number.isFinite(port.offset) || port.offset < 0 || port.offset > 1)
      add("inconsistent_port", port.id);
  }
  for (const junction of graph.junctions) {
    if (!finitePoint(junction.point)) add("inconsistent_port", junction.id);
  }
  const endpoint = (ref: SemanticEndpoint) =>
    ref.kind === "port" ? ports.get(ref.id) : junctions.get(ref.id);
  const endpointPoint = (ref: SemanticEndpoint): Point | undefined => {
    if (ref.kind === "junction") return junctions.get(ref.id)?.point;
    const port = ports.get(ref.id);
    const node = port && nodes.get(port.nodeId);
    return port && node ? resolvePortPoint(node, port) : undefined;
  };
  for (const segment of graph.segments) {
    if (!connections.has(segment.connectionId)) add("dangling_segment", segment.id);
    for (const ref of [segment.from, segment.to])
      if (!endpoint(ref)) add("dangling_endpoint", segment.id);
    const from = endpointPoint(segment.from);
    const to = endpointPoint(segment.to);
    if (from && to && from.x !== to.x && from.y !== to.y) add("route_break", segment.id);
  }
  const claimed = new Set<string>();
  for (const connection of graph.connections) {
    const source = ports.get(connection.sourcePortId);
    const target = ports.get(connection.targetPortId);
    if (!source || !target) add("dangling_endpoint", connection.id);
    if (source?.direction !== "out" || target?.direction !== "in")
      add("inconsistent_port", connection.id);
    const crossingBridge =
      source && target && source.nodeId === target.nodeId && nodes.get(source.nodeId)?.bridge;
    if (source && target && source.network !== target.network && !crossingBridge)
      add("type_conflict", connection.id);
    if (
      crossingBridge &&
      (source?.network !== crossingBridge.fromNetwork ||
        target?.network !== crossingBridge.toNetwork)
    )
      add("inconsistent_port", connection.id);
    let previous: SemanticEndpoint = { kind: "port", id: connection.sourcePortId };
    if (!connection.segmentIds.length) add("route_break", connection.id);
    for (const [index, id] of connection.segmentIds.entries()) {
      const segment = segments.get(id);
      if (!segment) {
        add("dangling_segment", connection.id);
        continue;
      }
      if (claimed.has(id) || segment.connectionId !== connection.id) add("dangling_segment", id);
      claimed.add(id);
      if (endpointKey(previous) !== endpointKey(segment.from)) add("route_break", connection.id);
      if (index > 0 && segment.from.kind === "port") add("route_break", connection.id);
      if (index < connection.segmentIds.length - 1 && segment.to.kind === "port")
        add("route_break", connection.id);
      previous = segment.to;
      for (const ref of [segment.from, segment.to]) {
        const value = endpoint(ref);
        if (!value) continue;
        if (value.class !== connection.class) add("type_conflict", connection.id);
        if (value.originId !== null && value.originId !== connection.originId)
          add("origin_conflict", connection.id);
        if (
          source &&
          value.network !== source.network &&
          !(crossingBridge && ref.kind === "port" && ref.id === target?.id)
        )
          add("type_conflict", connection.id);
      }
    }
    if (endpointKey(previous) !== endpointKey({ kind: "port", id: connection.targetPortId }))
      add("route_break", connection.id);
  }
  for (const segment of graph.segments)
    if (!claimed.has(segment.id)) add("dangling_segment", segment.id);
  for (const node of graph.nodes.filter((node) => node.kind === "conversion")) {
    const incoming = graph.connections.filter(
      (connection) => ports.get(connection.targetPortId)?.nodeId === node.id,
    );
    const outgoing = graph.connections.filter(
      (connection) => ports.get(connection.sourcePortId)?.nodeId === node.id,
    );
    if (!incoming.length || !outgoing.length) add("orphan_conversion", node.id);
    else if (
      incoming.some(
        (entry) =>
          !outgoing.some((exit) => exit.class === entry.class && exit.originId === entry.originId),
      ) ||
      outgoing.some(
        (exit) =>
          !incoming.some((entry) => entry.class === exit.class && entry.originId === exit.originId),
      )
    )
      add("type_conflict", node.id);
  }
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}

/** Validated explicit routes resolved against current outer rects, without changing the layout. */
export function resolveSemanticGraph(graph: SemanticGraph): {
  segments: ResolvedSemanticPath[];
  connections: ResolvedSemanticPath[];
} {
  const issues = validateSemanticGraph(graph);
  if (issues.length)
    throw new Error(
      `Invalid semantic graph: ${issues.map((issue) => `${issue.code}:${issue.id}`).join(", ")}`,
    );
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const points = new Map(
    graph.junctions.map((junction) => [
      endpointKey({ kind: "junction", id: junction.id }),
      junction.point,
    ]),
  );
  for (const port of graph.ports) {
    const node = nodes.get(port.nodeId);
    if (node) points.set(endpointKey({ kind: "port", id: port.id }), resolvePortPoint(node, port));
  }
  const classes = new Map(graph.connections.map((connection) => [connection.id, connection.class]));
  const segments = graph.segments.map((segment) => ({
    id: segment.id,
    class: classes.get(segment.connectionId) ?? "structural",
    points: [segment.from, segment.to].flatMap((ref) => {
      const point = points.get(endpointKey(ref));
      return point ? [{ ...point }] : [];
    }),
  }));
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  return {
    segments,
    connections: graph.connections.map((connection) => ({
      id: connection.id,
      class: connection.class,
      points: connection.segmentIds.flatMap((id, index) => {
        const segment = byId.get(id);
        return segment ? segment.points.slice(index === 0 ? 0 : 1) : [];
      }),
    })),
  };
}
