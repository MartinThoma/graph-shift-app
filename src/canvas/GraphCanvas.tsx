/**
 * Interactive graph sheet: pan (drag background / middle mouse / Space+drag),
 * zoom (wheel, pinch, buttons), node dragging with live edge updates,
 * selection (click, Shift+click, rectangle) with group dragging, and the
 * add-edge picking mode. Overlays (selection, hand-placed ticks, grid) are
 * drawn separately from the graph markup so the SVG export stays clean.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Point } from "../render/shapes";
import { renderClusterLabelMarkup, renderClusterMarkup, renderEdgeMarkup, renderGraphLabelMarkup, renderNodeMarkup } from "../render/svgMarkup";
import { THEME } from "../render/visuals";
import type { Viewport } from "../state/storage";
import type { EdgePrim, NodePrim, Scene } from "./scene";

export type Selection = { kind: "nodes"; ids: string[] } | { kind: "edge"; key: string };

/** What a plain drag on empty sheet does: pan the view or draw a selection rectangle. */
export type PointerTool = "pan" | "select";

/** Node IDs whose boxes intersect a rectangle (content coordinates). */
export function findNodesInRect(nodes: NodePrim[], rect: { x: number; y: number; w: number; h: number }): string[] {
  return nodes
    .filter((n) => {
      const hw = n.visual.width / 2;
      const hh = n.visual.height / 2;
      return n.x + hw >= rect.x && n.x - hw <= rect.x + rect.w && n.y + hh >= rect.y && n.y - hh <= rect.y + rect.h;
    })
    .map((n) => n.id);
}

/** Toggle one node in a node selection (Shift+click). */
export function toggleNodeSelection(selection: Selection | null, id: string): Selection | null {
  const ids = selection?.kind === "nodes" ? selection.ids : [];
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return next.length ? { kind: "nodes", ids: next } : null;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const DRAG_THRESHOLD = 3;

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Zoom around a screen point so the content under it stays put. */
export function zoomViewportAt(viewport: Viewport, factor: number, at: Point): Viewport {
  const k = clampZoom(viewport.k * factor);
  const ratio = k / viewport.k;
  return { k, x: at.x - (at.x - viewport.x) * ratio, y: at.y - (at.y - viewport.y) * ratio };
}

/** Viewport that fits a rectangle into a screen area with padding. */
export function computeFitViewport(bounds: { x: number; y: number; w: number; h: number }, size: { width: number; height: number }, padding = 48): Viewport {
  const w = Math.max(1, bounds.w);
  const h = Math.max(1, bounds.h);
  const k = clampZoom(Math.min((size.width - padding * 2) / w, (size.height - padding * 2) / h, 1));
  return { k, x: size.width / 2 - (bounds.x + w / 2) * k, y: size.height / 2 - (bounds.y + h / 2) * k };
}

interface GraphCanvasProps {
  scene: Scene | null;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  manualNodes: Set<string>;
  mode: "select" | "add-edge";
  edgeSource: string | null;
  pointerTool: PointerTool;
  onPickNode: (id: string) => void;
  onDragNodes: (moves: Record<string, Point>) => void;
  onCommitDrag: (ids: string[]) => void;
  onCancelDrag: () => void;
  onAddNodeAt: (position: Point) => void;
  onNudge: (ids: string[], dx: number, dy: number) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  emptyMessage: string | null;
}

type Gesture =
  | {
      kind: "node";
      id: string;
      pointerId: number;
      start: Point;
      startContent: Point;
      /** Start positions of every node that moves with this drag. */
      origins: Record<string, Point>;
      shift: boolean;
      moved: boolean;
    }
  | { kind: "marquee"; pointerId: number; start: Point; startContent: Point; additive: boolean; moved: boolean }
  | { kind: "edge"; key: string; pointerId: number; start: Point; moved: boolean }
  | { kind: "pan"; pointerId: number; start: Point; viewport: Viewport; moved: boolean }
  | { kind: "pinch"; ids: [number, number]; distance: number; mid: Point; viewport: Viewport };

const NodeView = memo(function NodeView({ prim }: { prim: NodePrim }) {
  const markup = useMemo(() => renderNodeMarkup(prim.visual), [prim.visual]);
  const v = prim.visual;
  const needsHitArea = v.invisible || v.fill === "none" || v.outlinePaths.length === 0;
  return (
    <g className="node" data-node-id={prim.id} transform={`translate(${prim.x} ${prim.y})`}>
      {needsHitArea && <rect className="hit" x={-v.width / 2} y={-v.height / 2} width={v.width} height={v.height} />}
      <g dangerouslySetInnerHTML={{ __html: markup }} />
    </g>
  );
});

const EdgeView = memo(function EdgeView({ prim, halo }: { prim: EdgePrim; halo: string }) {
  const markup = useMemo(() => renderEdgeMarkup(prim, halo), [prim, halo]);
  return (
    <g className="edge" data-edge-key={prim.key}>
      <path className="hit" d={prim.geometry.path} />
      <g dangerouslySetInnerHTML={{ __html: markup }} />
    </g>
  );
});

const ClustersView = memo(function ClustersView({ clusters }: { clusters: Scene["clusters"] }) {
  const markup = useMemo(() => clusters.map(renderClusterMarkup).join(""), [clusters]);
  return <g className="clusters" dangerouslySetInnerHTML={{ __html: markup }} />;
});

const ClusterLabelsView = memo(function ClusterLabelsView({ clusters, halo }: { clusters: Scene["clusters"]; halo: string }) {
  const markup = useMemo(() => clusters.map((c) => renderClusterLabelMarkup(c, halo)).join(""), [clusters, halo]);
  return <g className="cluster-labels" dangerouslySetInnerHTML={{ __html: markup }} />;
});

export function GraphCanvas(props: GraphCanvasProps) {
  const {
    scene,
    viewport,
    onViewportChange,
    selection,
    onSelect,
    manualNodes,
    mode,
    edgeSource,
    pointerTool,
    onPickNode,
    onDragNodes,
    onCommitDrag,
    onCancelDrag,
    onAddNodeAt,
    onNudge,
    onSizeChange,
    emptyMessage,
  } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pointer, setPointer] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Space held = temporary pan, as in most drawing tools.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      const el = event.target as HTMLElement | null;
      if (el?.closest?.(".cm-editor, input, textarea, select, button")) return;
      const down = event.type === "keydown";
      if (down) event.preventDefault();
      if (spaceHeldRef.current !== down) {
        spaceHeldRef.current = down;
        setSpaceHeld(down);
      }
    };
    const onBlur = (): void => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const toScreen = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const toContent = useCallback((screen: Point, vp: Viewport = viewportRef.current): Point => {
    return { x: (screen.x - vp.x) / vp.k, y: (screen.y - vp.y) / vp.k };
  }, []);

  // Track the canvas size.
  useEffect(() => {
    const svg = svgRef.current!;
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(next);
      onSizeChange(next);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [onSizeChange]);

  // Wheel zoom (non-passive so the page does not scroll).
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const intensity = event.ctrlKey ? 0.01 : 0.0018;
      const factor = Math.exp(-event.deltaY * unit * intensity);
      onViewportChange(zoomViewportAt(viewportRef.current, factor, toScreen(event)));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [onViewportChange, toScreen]);

  const nodeById = useMemo(() => new Map(scene?.nodes.map((n) => [n.id, n]) ?? []), [scene]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const screen = toScreen(event);
    pointersRef.current.set(event.pointerId, screen);
    const svg = svgRef.current!;

    // Second touch: switch to pinch zoom.
    if (pointersRef.current.size === 2) {
      const current = gestureRef.current;
      if (current?.kind === "node" && current.moved) onCancelDrag();
      const [a, b] = [...pointersRef.current.entries()];
      gestureRef.current = {
        kind: "pinch",
        ids: [a[0], b[0]],
        distance: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y) || 1,
        mid: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 },
        viewport: viewportRef.current,
      };
      setDragging(null);
      return;
    }
    if (pointersRef.current.size > 2) return;

    const target = (event.target as Element).closest("[data-node-id],[data-edge-key]");
    const nodeId = target?.getAttribute("data-node-id") ?? null;
    const edgeKey = target?.getAttribute("data-edge-key") ?? null;

    svg.setPointerCapture(event.pointerId);
    const onSheet = !nodeId && !edgeKey;
    const wantsMarquee =
      event.button === 0 && onSheet && mode === "select" && !spaceHeldRef.current && (event.shiftKey || pointerTool === "select");
    if (wantsMarquee) {
      gestureRef.current = {
        kind: "marquee",
        pointerId: event.pointerId,
        start: screen,
        startContent: toContent(screen),
        additive: event.shiftKey,
        moved: false,
      };
      return;
    }
    if (event.button === 1 || spaceHeldRef.current || (event.button === 0 && onSheet) || (mode === "add-edge" && !nodeId)) {
      gestureRef.current = { kind: "pan", pointerId: event.pointerId, start: screen, viewport: viewportRef.current, moved: false };
      return;
    }
    if (event.button !== 0) return;
    if (mode === "add-edge" && nodeId) {
      onPickNode(nodeId);
      gestureRef.current = null;
      return;
    }
    if (nodeId) {
      if (!nodeById.has(nodeId)) return;
      // Dragging a node of a multi-selection moves the whole selection.
      const selected = selection?.kind === "nodes" && selection.ids.includes(nodeId) ? selection.ids : [nodeId];
      const ids = event.shiftKey && !selected.includes(nodeId) ? [...selected, nodeId] : selected;
      const origins: Record<string, Point> = {};
      for (const id of ids) {
        const n = nodeById.get(id);
        if (n) origins[id] = { x: n.x, y: n.y };
      }
      gestureRef.current = {
        kind: "node",
        id: nodeId,
        pointerId: event.pointerId,
        start: screen,
        startContent: toContent(screen),
        origins,
        shift: event.shiftKey,
        moved: false,
      };
      return;
    }
    if (edgeKey) {
      gestureRef.current = { kind: "edge", key: edgeKey, pointerId: event.pointerId, start: screen, moved: false };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const screen = toScreen(event);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, screen);
    if (mode === "add-edge") setPointer(toContent(screen));
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      const a = pointersRef.current.get(gesture.ids[0]);
      const b = pointersRef.current.get(gesture.ids[1]);
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const start = gesture.viewport;
      const k = clampZoom(start.k * (distance / gesture.distance));
      const anchor = { x: (gesture.mid.x - start.x) / start.k, y: (gesture.mid.y - start.y) / start.k };
      onViewportChange({ k, x: mid.x - anchor.x * k, y: mid.y - anchor.y * k });
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    const distance = Math.hypot(screen.x - gesture.start.x, screen.y - gesture.start.y);
    if (!gesture.moved && distance < DRAG_THRESHOLD) return;
    gesture.moved = true;
    if (gesture.kind === "node") {
      const content = toContent(screen);
      if (dragging !== gesture.id) setDragging(gesture.id);
      const dx = Math.round(content.x - gesture.startContent.x);
      const dy = Math.round(content.y - gesture.startContent.y);
      const moves: Record<string, Point> = {};
      for (const [id, origin] of Object.entries(gesture.origins)) moves[id] = { x: origin.x + dx, y: origin.y + dy };
      onDragNodes(moves);
    } else if (gesture.kind === "marquee") {
      const content = toContent(screen);
      const a = gesture.startContent;
      setMarquee({ x: Math.min(a.x, content.x), y: Math.min(a.y, content.y), w: Math.abs(content.x - a.x), h: Math.abs(content.y - a.y) });
    } else if (gesture.kind === "pan") {
      onViewportChange({ ...gesture.viewport, x: gesture.viewport.x + screen.x - gesture.start.x, y: gesture.viewport.y + screen.y - gesture.start.y });
    }
  };

  const finishPointer = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean): void => {
    pointersRef.current.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      if (pointersRef.current.size === 0) gestureRef.current = null;
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setDragging(null);
    if (gesture.kind === "node") {
      const ids = Object.keys(gesture.origins);
      if (cancelled) onCancelDrag();
      else if (gesture.moved) {
        onCommitDrag(ids);
        if (ids.length > 1) onSelect({ kind: "nodes", ids });
      } else if (gesture.shift) onSelect(toggleNodeSelection(selection, gesture.id));
      else onSelect({ kind: "nodes", ids: [gesture.id] });
    } else if (gesture.kind === "marquee") {
      setMarquee(null);
      if (cancelled) return;
      if (!gesture.moved) {
        if (!gesture.additive) onSelect(null);
        return;
      }
      const end = toContent(toScreen(event));
      const a = gesture.startContent;
      const rect = { x: Math.min(a.x, end.x), y: Math.min(a.y, end.y), w: Math.abs(end.x - a.x), h: Math.abs(end.y - a.y) };
      const hits = findNodesInRect(scene?.nodes ?? [], rect);
      const base = gesture.additive && selection?.kind === "nodes" ? selection.ids : [];
      const ids = [...new Set([...base, ...hits])];
      onSelect(ids.length ? { kind: "nodes", ids } : null);
    } else if (gesture.kind === "edge") {
      if (!gesture.moved && !cancelled) onSelect({ kind: "edge", key: gesture.key });
    } else if (gesture.kind === "pan" && !gesture.moved && !cancelled && mode === "select") {
      onSelect(null);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if ((event.target as Element).closest("[data-node-id],[data-edge-key]") || mode !== "select") return;
    const p = toContent(toScreen(event));
    onAddNodeAt({ x: Math.round(p.x), y: Math.round(p.y) });
  };

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (selection?.kind !== "nodes") return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    onNudge(selection.ids, d[0], d[1]);
  };

  // Grid in content coordinates so it pans and zooms with the drawing.
  const k = viewport.k;
  const visible = {
    x: -viewport.x / k,
    y: -viewport.y / k,
    w: size.width / k,
    h: size.height / k,
  };
  const minorVisible = 20 * k >= 7;
  const majorStep = 20 * k >= 7 ? 100 : 20 * k * 5 >= 7 ? 100 : 500;
  const hairline = 1 / k;

  const selectedNodes = selection?.kind === "nodes" ? selection.ids.map((id) => nodeById.get(id)).filter((n): n is NodePrim => !!n) : [];
  const selectedEdge = selection?.kind === "edge" ? scene?.edges.find((e) => e.key === selection.key) : undefined;
  const sourceNode = edgeSource ? nodeById.get(edgeSource) : undefined;
  const halo = scene?.background ?? THEME.paper;

  return (
    <svg
      ref={svgRef}
      className={`graph-canvas${mode === "add-edge" ? " is-picking" : ""}${dragging ? " is-dragging" : ""}${
        pointerTool === "select" && !spaceHeld ? " is-select-tool" : ""
      }${spaceHeld ? " is-space-pan" : ""}`}
      role="application"
      aria-label="Graph canvas. Drag nodes to move them, Shift+click to select several, Shift+drag the background to select a rectangle, drag the background to pan, scroll to zoom."
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishPointer(e, false)}
      onPointerCancel={(e) => finishPointer(e, true)}
      onPointerLeave={() => mode === "add-edge" && setPointer(null)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <defs>
        <pattern id="grid-minor" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="var(--grid-minor)" strokeWidth={hairline} />
        </pattern>
        <pattern id="grid-major" width={majorStep} height={majorStep} patternUnits="userSpaceOnUse">
          <path d={`M${majorStep} 0H0V${majorStep}`} fill="none" stroke="var(--grid-major)" strokeWidth={hairline} />
        </pattern>
      </defs>
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${k})`}>
        <g className="sheet-grid" aria-hidden="true">
          {minorVisible && <rect x={visible.x} y={visible.y} width={visible.w} height={visible.h} fill="url(#grid-minor)" />}
          <rect x={visible.x} y={visible.y} width={visible.w} height={visible.h} fill="url(#grid-major)" />
        </g>
        {scene && (
          <>
            {scene.background && (
              <rect x={scene.bounds.x - 16} y={scene.bounds.y - 16} width={scene.bounds.w + 32} height={scene.bounds.h + 32} fill={scene.background} />
            )}
            <ClustersView clusters={scene.clusters} />
            <g className="edges">
              {scene.edges.map((edge) => (
                <EdgeView key={edge.key} prim={edge} halo={halo} />
              ))}
            </g>
            <ClusterLabelsView clusters={scene.clusters} halo={halo} />
            <g className="nodes">
              {scene.nodes.map((node) => (
                <NodeView key={node.id} prim={node} />
              ))}
            </g>
            {scene.graphLabel && <g dangerouslySetInnerHTML={{ __html: renderGraphLabelMarkup(scene.graphLabel) }} />}
            <g className="overlay" aria-hidden="true">
              {scene.nodes.map((node) =>
                manualNodes.has(node.id) ? (
                  <path
                    key={node.id}
                    className="hand-tick"
                    d={`M${node.x - node.visual.width / 2 - 6} ${node.y - node.visual.height / 2 + 6}V${node.y - node.visual.height / 2 - 6}H${node.x - node.visual.width / 2 + 6}`}
                  />
                ) : null,
              )}
              {selectedEdge && <path className="selected-edge" d={selectedEdge.geometry.path} strokeWidth={selectedEdge.visual.strokeWidth + 2.5 / k} />}
              {selectedNodes.map((node) => (
                <rect
                  key={node.id}
                  className="selected-node"
                  x={node.x - node.visual.width / 2 - 5}
                  y={node.y - node.visual.height / 2 - 5}
                  width={node.visual.width + 10}
                  height={node.visual.height + 10}
                  rx={8}
                  strokeWidth={2 / k}
                />
              ))}
              {marquee && (
                <rect
                  className="marquee"
                  x={marquee.x}
                  y={marquee.y}
                  width={marquee.w}
                  height={marquee.h}
                  strokeWidth={1 / k}
                  strokeDasharray={`${4 / k} ${3 / k}`}
                />
              )}
              {sourceNode && (
                <>
                  <rect
                    className="edge-source"
                    x={sourceNode.x - sourceNode.visual.width / 2 - 5}
                    y={sourceNode.y - sourceNode.visual.height / 2 - 5}
                    width={sourceNode.visual.width + 10}
                    height={sourceNode.visual.height + 10}
                    rx={8}
                    strokeWidth={2 / k}
                    strokeDasharray={`${5 / k} ${4 / k}`}
                  />
                  {pointer && (
                    <line
                      className="edge-preview"
                      x1={sourceNode.x}
                      y1={sourceNode.y}
                      x2={pointer.x}
                      y2={pointer.y}
                      strokeWidth={1.5 / k}
                      strokeDasharray={`${5 / k} ${4 / k}`}
                    />
                  )}
                </>
              )}
            </g>
          </>
        )}
      </g>
      {emptyMessage && (
        <text className="canvas-empty" x={size.width / 2} y={size.height / 2} textAnchor="middle">
          {emptyMessage}
        </text>
      )}
    </svg>
  );
}
