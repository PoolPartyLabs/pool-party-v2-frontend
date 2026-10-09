/**
 * @id PP-MGR-CMP-100 (POO-2302)
 * @name ReactFlowGraph
 * @implements-rules-version v1
 * @analytics-events none, presentation infrastructure; Build and Manage hosts own events.
 *
 * React Flow owns one viewport and measures explicitly declared financial handles. Existing
 * Pool Party surfaces and financial route bends remain authoritative. Engine editing is disabled.
 */
"use client";
import "@xyflow/react/dist/base.css";
import {
  type EdgeProps,
  Handle,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  useUpdateNodeInternals,
} from "@xyflow/react";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils/cn";
import type { CanvasViewportHandle } from "../canvas/CanvasViewport";
import {
  computeFit,
  ensureVisible,
  formatZoom,
  type Size,
  stepZoom,
  type ViewTransform,
  ZOOM,
} from "../canvas/viewportMath";
import {
  type FinancialEdge,
  type FinancialGraphPresentation,
  type FinancialNode,
  measuredFinancialPoints,
  projectReactFlowGraph,
} from "./reactFlowProjection";
import type { FinancialPort } from "./semanticGraph";

const GraphPresentationContext = createContext<
  ((value: FinancialGraphPresentation | null) => void) | null
>(null);

export function useFinancialGraphEngine(): boolean {
  return useContext(GraphPresentationContext) !== null;
}

/** Register the existing renderer's surfaces with the engine; false retains the native renderer. */
export function useFinancialGraphPresentation(presentation: FinancialGraphPresentation): boolean {
  const register = useContext(GraphPresentationContext);
  useEffect(() => {
    register?.(presentation);
  }, [register, presentation]);
  useEffect(
    () => () => {
      register?.(null);
    },
    [register],
  );
  return register !== null;
}

const SIDES = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
} as const;

function handleStyle(port: FinancialPort): CSSProperties {
  const horizontal = port.side === "top" || port.side === "bottom";
  return {
    width: 2,
    height: 2,
    minWidth: 2,
    minHeight: 2,
    opacity: 0,
    border: 0,
    pointerEvents: "none",
    position: "absolute",
    ...(horizontal
      ? {
          left: `${port.offset * 100}%`,
          top: port.side === "top" ? 0 : "100%",
          transform: port.side === "top" ? "translate(-50%, 0)" : "translate(-50%, -100%)",
        }
      : {
          top: `${port.offset * 100}%`,
          left: port.side === "left" ? 0 : "100%",
          transform: port.side === "left" ? "translate(0, -50%)" : "translate(-100%, -50%)",
        }),
  };
}

/** Handles retain nonzero geometry on the exact surface border, even though they are invisible. */
export function FinancialNodeSurface({ id, data, width, height }: NodeProps<FinancialNode>) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const updateInternals = useUpdateNodeInternals();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a replaced surface can mount new interactive descendants.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.querySelectorAll<HTMLElement>("[data-canvas-interactive]").forEach((element) => {
      element.classList.add("pp-canvas-interactive");
    });
  }, [data.surface]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: React Flow must remeasure when the declared handle set or actual size changes.
  useEffect(() => {
    updateInternals(id);
  }, [id, data.ports, width, height, updateInternals]);
  return (
    <div
      ref={surfaceRef}
      data-financial-node={id}
      className={cn(
        "relative w-full [&_[data-canvas-interactive]]:pointer-events-auto [&_[data-flow-pill]]:h-auto [&_[data-flow-pill]]:min-h-[var(--financial-surface-height)] [&_[data-flow-pill]]:w-full [&_[data-spine-card]]:h-auto [&_[data-spine-card]]:min-h-[var(--financial-surface-height)] [&_[data-spine-card]]:w-full [&_[data-card-state]]:h-auto [&_[data-card-state]]:min-h-[var(--financial-surface-height)] [&_[data-card-state]]:w-full",
        data.interactive && "pp-canvas-interactive",
      )}
      style={
        {
          pointerEvents: data.interactive ? "all" : "none",
          minHeight: data.minimumHeight,
          "--financial-surface-height": `${data.minimumHeight ?? 0}px`,
        } as CSSProperties
      }
    >
      {data.surface}
      {data.ports.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type={port.direction === "out" ? "source" : "target"}
          position={SIDES[port.side]}
          isConnectable={false}
          isConnectableStart={false}
          isConnectableEnd={false}
          style={handleStyle(port)}
          aria-hidden="true"
          data-financial-port={port.id}
        />
      ))}
    </div>
  );
}

/** Measured endpoint props are authoritative; interior route points preserve the financial router. */
export function FinancialConnectionEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<FinancialEdge>) {
  if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) return null;
  const points = measuredFinancialPoints(
    data?.points ?? [],
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
    sourcePosition,
    targetPosition,
  );
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const highlighted = data?.highlighted ?? false;
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: SVG hover geometry is decorative and has no keyboard focus target.
    <g
      aria-hidden="true"
      data-financial-connection={id}
      ref={(element) => {
        // React Flow marks every edge wrapper as no-pan. Financial lines are background,
        // so retain the engine's pan/click-distance handling over our hover geometry too.
        element?.closest(".react-flow__edge")?.classList.remove("pp-canvas-interactive");
      }}
    >
      <path
        data-edge-id={id}
        data-connection-id={id}
        data-edge-tone={data?.tone}
        data-highlighted={highlighted ? "" : undefined}
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={highlighted ? 2 : 1.5}
        strokeLinejoin="miter"
        strokeLinecap="butt"
        className={cn(
          "transition-colors motion-reduce:transition-none",
          highlighted
            ? "text-primary"
            : data?.tone === "income"
              ? "text-success"
              : "text-muted-foreground",
        )}
        style={{ pointerEvents: "none" }}
      />
      <path
        data-edge-hit={id}
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={8}
        style={{ pointerEvents: "stroke" }}
        onPointerEnter={() => data?.onHoverChange?.(id)}
        onPointerLeave={() => data?.onHoverChange?.(null)}
      />
    </g>
  );
}
const NODE_TYPES = { financial: FinancialNodeSurface };
const EDGE_TYPES = { financial: FinancialConnectionEdge };

export interface FinancialViewportControls extends CanvasViewportHandle {
  readoutPct: number;
  zoomIn(): void;
  zoomOut(): void;
}
export interface ReactFlowGraphProps {
  graphSize: Size | null;
  initialScale?: number;
  fitOnResize?: boolean;
  onBackgroundClick?(): void;
  viewportRef?: Ref<CanvasViewportHandle>;
  children?: ReactNode;
  className?: string;
  hintId?: string;
  chrome(controls: FinancialViewportControls): ReactNode;
}

function GraphEngine({
  graphSize,
  initialScale,
  fitOnResize = false,
  onBackgroundClick,
  viewportRef,
  children,
  className,
  hintId,
  chrome,
}: ReactFlowGraphProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ReactFlowInstance<FinancialNode, FinancialEdge> | null>(
    null,
  );
  const [presentation, setPresentation] = useState<FinancialGraphPresentation | null>(null);
  const [view, setView] = useState<ViewTransform>({ scale: initialScale ?? 1, x: 0, y: 16 });
  const [panning, setPanning] = useState(false);
  const [measurements, setMeasurements] = useState<ReadonlyMap<string, Size>>(new Map());
  const preserveMeasurements = useCallback((changes: NodeChange<FinancialNode>[]) => {
    setMeasurements((current) => {
      let next: Map<string, Size> | null = null;
      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        const existing = current.get(change.id);
        if (
          existing?.width === change.dimensions.width &&
          existing.height === change.dimensions.height
        )
          continue;
        next ??= new Map(current);
        next.set(change.id, change.dimensions);
      }
      return next ?? current;
    });
  }, []);
  const graphRef = useRef(graphSize);
  graphRef.current = graphSize;
  const openingApplied = useRef(false);
  const size = useCallback((): Size => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, []);
  const apply = useCallback(
    (next: ViewTransform) => {
      setView(next);
      void instance?.setViewport({ x: next.x, y: next.y, zoom: next.scale });
    },
    [instance],
  );
  const fitGraph = useCallback(() => {
    const canvas = size();
    if (graphRef.current && canvas.width > 0 && canvas.height > 0)
      apply(computeFit(canvas, graphRef.current, fitOnResize));
  }, [apply, size, fitOnResize]);
  const placeOpening = useCallback(() => {
    const graph = graphRef.current;
    const canvas = size();
    if (!instance || !graph || openingApplied.current || canvas.width <= 0 || canvas.height <= 0)
      return;
    openingApplied.current = true;
    const scale =
      initialScale === undefined ? undefined : Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, initialScale));
    apply(
      scale === undefined
        ? computeFit(canvas, graph, fitOnResize)
        : { scale, x: Math.max(0, (canvas.width - graph.width * scale) / 2), y: 0 },
    );
  }, [instance, size, initialScale, fitOnResize, apply]);
  const revealRect = useCallback<CanvasViewportHandle["revealRect"]>(
    (rect) => {
      const current = instance?.getViewport();
      const next = ensureVisible(
        current ? { x: current.x, y: current.y, scale: current.zoom } : view,
        rect,
        size(),
      );
      apply(next);
    },
    [instance, view, size, apply],
  );
  useImperativeHandle(viewportRef, () => ({ fit: fitGraph, revealRect }), [fitGraph, revealRect]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: graph arrival retries the initial placement; later reflows retain the view.
  useEffect(() => {
    placeOpening();
  }, [placeOpening, graphSize]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!openingApplied.current) placeOpening();
      else if (fitOnResize) fitGraph();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitGraph, fitOnResize, placeOpening]);
  const projected = useMemo(() => {
    const projected = presentation ? projectReactFlowGraph(presentation) : { nodes: [], edges: [] };
    return {
      ...projected,
      nodes: projected.nodes.map((node) => {
        const measured = measurements.get(node.id);
        return measured ? { ...node, measured } : node;
      }),
    };
  }, [presentation, measurements]);
  const controls: FinancialViewportControls = {
    fit: fitGraph,
    revealRect,
    readoutPct: formatZoom(view.scale),
    zoomIn: () => apply(stepZoom(view, 1, size())),
    zoomOut: () => apply(stepZoom(view, -1, size())),
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: decorative background double-click duplicates the accessible Fit control.
    <div
      ref={canvasRef}
      data-canvas-viewport=""
      data-canvas-engine="react-flow"
      aria-describedby={hintId}
      className={cn(className, panning ? "cursor-grabbing" : "cursor-grab")}
      onDoubleClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("[data-canvas-interactive], [data-canvas-zoom-controls]")
        )
          fitGraph();
      }}
    >
      <GraphPresentationContext.Provider value={setPresentation}>
        {children}
        <ReactFlow<FinancialNode, FinancialEdge>
          nodes={projected.nodes}
          onNodesChange={preserveMeasurements}
          zIndexMode="manual"
          edges={projected.edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onInit={setInstance}
          onViewportChange={(next) => setView({ x: next.x, y: next.y, scale: next.zoom })}
          onMoveStart={() => setPanning(true)}
          onMoveEnd={() => setPanning(false)}
          onPaneClick={onBackgroundClick}
          onEdgeClick={onBackgroundClick}
          paneClickDistance={ZOOM.PAN_THRESHOLD}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesReconnectable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          disableKeyboardA11y={true}
          panOnScroll={true}
          panOnScrollSpeed={1}
          zoomOnScroll={false}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          minZoom={Math.min(ZOOM.MIN, view.scale)}
          maxZoom={ZOOM.MAX}
          noPanClassName="pp-canvas-interactive"
          noDragClassName="pp-canvas-interactive"
          noWheelClassName="pp-canvas-scroll"
          proOptions={{ hideAttribution: true }}
          onlyRenderVisibleElements={false}
        />
      </GraphPresentationContext.Provider>
      {chrome(controls)}
    </div>
  );
}
export function ReactFlowGraph(props: ReactFlowGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphEngine {...props} />
    </ReactFlowProvider>
  );
}
