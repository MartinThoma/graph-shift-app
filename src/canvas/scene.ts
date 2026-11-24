/**
 * Scene assembly: combine the model, its resolved visuals and the current node
 * positions into drawable primitives. The same scene feeds the interactive
 * canvas and the SVG export, so both always match.
 */
import type { GraphModel } from "../dot/model";
import type { EdgeRoute } from "../layout/initialLayout";
import type { Point } from "../render/shapes";
import type { TextBlock } from "../render/visuals";
import {
  computeClusterVisual,
  computeEdgeVisual,
  computeGraphVisual,
  computeNodeVisual,
  type ClusterVisual,
  type EdgeVisual,
  type GraphVisual,
  type NodeVisual,
} from "../render/visuals";
import { measureTextWidth, type MeasureTextFunction } from "../render/text";
import {
  AVOIDANCE_NODE_LIMIT,
  computeAvoidanceBend,
  createRuleRects,
  placeClusterLabel,
  placeEdgeLabel,
  placeLoopLabel,
  type LabelObstacles,
} from "./collisions";
import { computeEdgeGeometry, deformRoute, type EdgeGeometry, type NodeGeometry } from "./edgeGeometry";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgeHint {
  bend: number;
  loopIndex: number;
}

export interface GraphVisuals {
  nodes: Map<string, NodeVisual>;
  edges: Map<string, EdgeVisual>;
  clusters: Map<string, ClusterVisual>;
  graph: GraphVisual;
  hints: Map<string, EdgeHint>;
}

export interface NodePrim {
  id: string;
  x: number;
  y: number;
  visual: NodeVisual;
}

export interface EdgePrim {
  key: string;
  tail: string;
  head: string;
  visual: EdgeVisual;
  geometry: EdgeGeometry;
  /** Final center of the main label after collision avoidance. */
  labelAt: Point | null;
}

export interface ClusterPrim {
  id: string;
  visual: ClusterVisual;
  rect: Rect;
  /** Center of the cluster label, placed where no edge crosses it. */
  labelAt: Point | null;
}

export interface GraphLabelPrim {
  block: TextBlock;
  x: number;
  y: number;
}

export interface Scene {
  nodes: NodePrim[];
  edges: EdgePrim[];
  clusters: ClusterPrim[];
  graphLabel: GraphLabelPrim | null;
  bounds: Rect;
  background: string | null;
}

const PARALLEL_SPACING = 22;
const CLUSTER_PADDING = 14;

/** Compute bends for parallel edges and indices for stacked self-loops. */
export function computeEdgeHints(model: GraphModel): Map<string, EdgeHint> {
  const hints = new Map<string, EdgeHint>();
  const groups = new Map<string, string[]>();
  const loops = new Map<string, number>();
  for (const edge of model.edges) {
    if (edge.tail === edge.head) {
      const index = loops.get(edge.tail) ?? 0;
      loops.set(edge.tail, index + 1);
      hints.set(edge.key, { bend: 0, loopIndex: index });
      continue;
    }
    const pair = [edge.tail, edge.head].sort().join("\u0000");
    const list = groups.get(pair) ?? [];
    list.push(edge.key);
    groups.set(pair, list);
  }
  const byKey = new Map(model.edges.map((e) => [e.key, e]));
  for (const [pair, keys] of groups) {
    const [first] = pair.split("\u0000");
    keys.forEach((key, i) => {
      const edge = byKey.get(key)!;
      const offset = keys.length > 1 ? (i - (keys.length - 1) / 2) * PARALLEL_SPACING : 0;
      // Offsets are defined relative to the canonical direction of the pair.
      const sign = edge.tail === first ? 1 : -1;
      hints.set(key, { bend: offset * sign, loopIndex: 0 });
    });
  }
  return hints;
}

/** Resolve all visuals for a model. */
export function computeGraphVisuals(model: GraphModel, measure: MeasureTextFunction = measureTextWidth): GraphVisuals {
  const nodes = new Map<string, NodeVisual>();
  for (const node of model.nodes.values()) nodes.set(node.id, computeNodeVisual(node, model, measure));
  const edges = new Map<string, EdgeVisual>();
  for (const edge of model.edges) edges.set(edge.key, computeEdgeVisual(edge, model, measure));
  const clusters = new Map<string, ClusterVisual>();
  for (const cluster of model.clusters.values()) clusters.set(cluster.id, computeClusterVisual(cluster, model, measure));
  return { nodes, edges, clusters, graph: computeGraphVisual(model, measure), hints: computeEdgeHints(model) };
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

interface CachedEdge {
  signature: string;
  visual: EdgeVisual;
  prim: EdgePrim;
}

interface CachedNode {
  prim: NodePrim;
}

/**
 * Builds scenes and reuses unchanged primitives between frames, so that while
 * dragging only the moved node and its incident edges get new objects.
 */
export class SceneBuilder {
  private edgeCache = new Map<string, CachedEdge>();
  private nodeCache = new Map<string, CachedNode>();

  build(
    model: GraphModel,
    visuals: GraphVisuals,
    positions: Record<string, Point>,
    routes: Record<string, EdgeRoute>,
  ): Scene {
    const nodes: NodePrim[] = [];
    const geometries = new Map<string, NodeGeometry>();
    let bounds: Rect | null = null;
    const seenNodes = new Set<string>();

    for (const node of model.nodes.values()) {
      const visual = visuals.nodes.get(node.id)!;
      const p = positions[node.id] ?? { x: 0, y: 0 };
      const cached = this.nodeCache.get(node.id);
      let prim: NodePrim;
      if (cached && cached.prim.visual === visual && cached.prim.x === p.x && cached.prim.y === p.y) {
        prim = cached.prim;
      } else {
        prim = { id: node.id, x: p.x, y: p.y, visual };
        this.nodeCache.set(node.id, { prim });
      }
      seenNodes.add(node.id);
      nodes.push(prim);
      geometries.set(node.id, { center: p, outline: visual.outline, width: visual.width, height: visual.height });
      bounds = unionRect(bounds, { x: p.x - visual.width / 2, y: p.y - visual.height / 2, w: visual.width, h: visual.height });
    }
    for (const id of this.nodeCache.keys()) if (!seenNodes.has(id)) this.nodeCache.delete(id);

    // Clusters, deepest first so parents can contain children.
    const clusterRects = new Map<string, Rect>();
    const clusters = [...model.clusters.values()].sort((a, b) => b.depth - a.depth);
    for (const cluster of clusters) {
      const visual = visuals.clusters.get(cluster.id)!;
      let rect: Rect | null = null;
      for (const id of cluster.nodeIds) {
        const g = geometries.get(id);
        if (!g) continue;
        rect = unionRect(rect, { x: g.center.x - g.width / 2, y: g.center.y - g.height / 2, w: g.width, h: g.height });
      }
      for (const child of cluster.children) {
        const r = clusterRects.get(child);
        if (r) rect = unionRect(rect, r);
      }
      if (!rect) continue;
      const labelSpace = visual.label ? visual.label.height + 6 : 0;
      const top = CLUSTER_PADDING + (visual.labelLoc === "t" ? labelSpace : 0);
      const bottom = CLUSTER_PADDING + (visual.labelLoc === "b" ? labelSpace : 0);
      const padded = { x: rect.x - CLUSTER_PADDING, y: rect.y - top, w: rect.w + CLUSTER_PADDING * 2, h: rect.h + top + bottom };
      const minWidth = visual.label ? visual.label.width + CLUSTER_PADDING * 2 : 0;
      if (padded.w < minWidth) {
        padded.x -= (minWidth - padded.w) / 2;
        padded.w = minWidth;
      }
      clusterRects.set(cluster.id, padded);
    }
    const clusterPrims: ClusterPrim[] = [];
    for (const cluster of [...model.clusters.values()].sort((a, b) => a.depth - b.depth)) {
      const rect = clusterRects.get(cluster.id);
      if (!rect) continue;
      clusterPrims.push({ id: cluster.id, visual: visuals.clusters.get(cluster.id)!, rect, labelAt: null });
      bounds = unionRect(bounds, rect);
    }

    const nodeRects = new Map<string, Rect>();
    for (const [id, g] of geometries) nodeRects.set(id, { x: g.center.x - g.width / 2, y: g.center.y - g.height / 2, w: g.width, h: g.height });
    const avoid = nodes.length <= AVOIDANCE_NODE_LIMIT;

    const edges: EdgePrim[] = [];
    const seenEdges = new Set<string>();
    for (const edge of model.edges) {
      const visual = visuals.edges.get(edge.key)!;
      const tail = geometries.get(edge.tail)!;
      const head = geometries.get(edge.head)!;
      const hint = visuals.hints.get(edge.key) ?? { bend: 0, loopIndex: 0 };
      const route = routes[edge.key] ?? null;
      const selfLoop = edge.tail === edge.head;
      let bend = hint.bend;
      if (avoid && !route && !selfLoop && !visual.invisible) {
        const obstacles: Rect[] = [];
        for (const [id, r] of nodeRects) {
          if (id === edge.tail || id === edge.head || visuals.nodes.get(id)!.invisible) continue;
          obstacles.push({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 });
        }
        bend = computeAvoidanceBend(tail.center, head.center, hint.bend, obstacles);
      }
      const tv = visuals.nodes.get(edge.tail)!;
      const hv = visuals.nodes.get(edge.head)!;
      const signature = [
        tail.center.x,
        tail.center.y,
        head.center.x,
        head.center.y,
        bend,
        hint.loopIndex,
        route ? JSON.stringify(route) : "",
        tv.width,
        tv.height,
        tv.shape,
        hv.width,
        hv.height,
        hv.shape,
      ].join("|");
      const cached = this.edgeCache.get(edge.key);
      let prim: EdgePrim;
      if (cached && cached.signature === signature && cached.visual === visual && cached.prim.tail === edge.tail && cached.prim.head === edge.head) {
        prim = cached.prim;
      } else {
        const geometry = computeEdgeGeometry({
          tail,
          head: selfLoop ? tail : head,
          route: route && !selfLoop ? deformRoute(route, tail.center, head.center) : null,
          bend,
          loopIndex: hint.loopIndex,
          arrowHead: visual.arrowHead,
          arrowTail: visual.arrowTail,
          arrowSize: visual.arrowSize,
          strokeWidth: visual.strokeWidth,
          tailPort: edge.tailPort,
          headPort: edge.headPort,
          selfLoop,
        });
        prim = { key: edge.key, tail: edge.tail, head: edge.head, visual, geometry, labelAt: null };
        this.edgeCache.set(edge.key, { signature, visual, prim });
      }
      seenEdges.add(edge.key);
      edges.push(prim);
      for (const p of prim.geometry.extent) bounds = unionRect(bounds, { x: p.x, y: p.y, w: 0, h: 0 });
    }
    for (const key of this.edgeCache.keys()) if (!seenEdges.has(key)) this.edgeCache.delete(key);

    // Label placement against the finished drawing.
    const lines = edges.filter((e) => !e.visual.invisible).map((e) => e.geometry.samples);
    const clusterRules = clusterPrims.flatMap((c) => (c.visual.invisible ? [] : createRuleRects(c.rect)));
    for (let i = 0; i < clusterPrims.length; i++) {
      const c = clusterPrims[i];
      const label = c.visual.label;
      if (!label) continue;
      const at = placeClusterLabel(c.rect, label, c.visual.labelJust, c.visual.labelLoc, lines);
      if (!c.labelAt || c.labelAt.x !== at.x || c.labelAt.y !== at.y) clusterPrims[i] = { ...c, labelAt: at };
    }
    const labelObstacles: LabelObstacles = {
      nodes: [...nodeRects.values()],
      clusterRules,
      arrowTips: edges.flatMap((e) => [e.geometry.headArrow ? e.geometry.end : null, e.geometry.tailArrow ? e.geometry.start : null].filter((p): p is Point => !!p)),
      placed: clusterPrims.filter((c) => c.labelAt && c.visual.label).map((c) => ({
        x: c.labelAt!.x - c.visual.label!.width / 2,
        y: c.labelAt!.y - c.visual.label!.height / 2,
        w: c.visual.label!.width,
        h: c.visual.label!.height,
      })),
      lines: avoid ? lines : [],
    };
    for (let i = 0; i < edges.length; i++) {
      const prim = edges[i];
      const label = prim.visual.label;
      if (!label) continue;
      let at: Point;
      if (prim.geometry.labelAlign === "start") {
        const a = prim.geometry.labelAnchor;
        at = avoid ? placeLoopLabel(a, label, labelObstacles, prim.geometry.samples) : { x: a.x + label.width / 2, y: a.y };
      } else if (!avoid) {
        at = prim.geometry.labelAnchor;
      } else {
        at = placeEdgeLabel(prim.geometry.samples, prim.geometry.labelAnchor, label, labelObstacles);
      }
      labelObstacles.placed.push({ x: at.x - label.width / 2, y: at.y - label.height / 2, w: label.width, h: label.height });
      if (!prim.labelAt || prim.labelAt.x !== at.x || prim.labelAt.y !== at.y) {
        const next = { ...prim, labelAt: at };
        edges[i] = next;
        const cached = this.edgeCache.get(prim.key);
        if (cached) cached.prim = next;
      }
      bounds = unionRect(bounds, { x: at.x - label.width / 2, y: at.y - label.height / 2, w: label.width, h: label.height });
    }

    const box = bounds ?? { x: 0, y: 0, w: 0, h: 0 };
    let graphLabel: GraphLabelPrim | null = null;
    const gl = visuals.graph.label;
    let finalBounds = box;
    if (gl) {
      const x =
        visuals.graph.labelJust === "l"
          ? box.x + gl.width / 2
          : visuals.graph.labelJust === "r"
            ? box.x + box.w - gl.width / 2
            : box.x + box.w / 2;
      const y = visuals.graph.labelLoc === "t" ? box.y - 12 - gl.height / 2 : box.y + box.h + 12 + gl.height / 2;
      graphLabel = { block: gl, x, y };
      finalBounds = unionRect(box, { x: x - gl.width / 2, y: y - gl.height / 2, w: gl.width, h: gl.height });
    }
    return { nodes, edges, clusters: clusterPrims, graphLabel, bounds: finalBounds, background: visuals.graph.background };
  }
}
