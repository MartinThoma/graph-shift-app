/**
 * Client-side initial layout engines (no Graphviz):
 *   hierarchical -> dagre (layered, honors rankdir)
 *   force        -> d3-force, deterministic seed
 *   radial       -> BFS rings around a root
 *   circular     -> one circle per connected component
 *   grid         -> compact grid in flow (topological) order
 */
import { graphlib, layout as runDagre } from "@dagrejs/dagre";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { GraphModel } from "../dot/model";
import type { Point } from "../render/shapes";

export type LayoutEngine = "hierarchical" | "force" | "radial" | "circular" | "grid";

export const LAYOUT_ENGINES: { id: LayoutEngine; label: string; hint: string }[] = [
  { id: "hierarchical", label: "Hierarchical", hint: "Layers in the direction of edges (honors rankdir)" },
  { id: "force", label: "Force-directed", hint: "Connected nodes pull together, others push apart" },
  { id: "radial", label: "Radial", hint: "Rings around the most connected node" },
  { id: "circular", label: "Circular", hint: "Each connected group on a circle" },
  { id: "grid", label: "Compact grid", hint: "Rows and columns in flow order" },
];

export function checkLayoutEngine(value: unknown): value is LayoutEngine {
  return LAYOUT_ENGINES.some((e) => e.id === value);
}

export interface Size {
  width: number;
  height: number;
}

/** A routed edge: interior waypoints plus the endpoint centers they were computed for. */
export interface EdgeRoute {
  points: Point[];
  tail: Point;
  head: Point;
}

export interface LayoutInput {
  model: GraphModel;
  sizes: Map<string, Size>;
  edgeLabelSizes: Map<string, Size>;
  rankdir: "TB" | "LR" | "BT" | "RL";
}

export interface LayoutResult {
  positions: Record<string, Point>;
  routes: Record<string, EdgeRoute>;
}

const CLUSTER_PREFIX = "\u0001cluster:";

/** Run the selected layout engine. */
export function computeLayout(engine: LayoutEngine, input: LayoutInput): LayoutResult {
  let result: LayoutResult;
  switch (engine) {
    case "hierarchical":
      result = computeHierarchicalLayout(input);
      break;
    default:
      result = { positions: computeClusteredLayout(FLAT_ENGINES[engine], input, null), routes: {} };
  }
  return normalizeLayout(result, input.sizes);
}

type FlatEngine = (input: LayoutInput) => Record<string, Point>;

const GROUP_PREFIX = "\u0001group:";
const GROUP_PADDING = 14;
const GROUP_LABEL_SPACE = 22;

/** Build a model restricted to some nodes (edges between them, clusters below `parent`). */
function createSubModel(model: GraphModel, ids: string[]): GraphModel {
  const set = new Set(ids);
  const clusters = new Map(
    [...model.clusters].filter(([, c]) => c.nodeIds.some((id) => set.has(id)) && c.nodeIds.every((id) => set.has(id))),
  );
  return {
    ...model,
    nodes: new Map([...model.nodes].filter(([id]) => set.has(id))),
    edges: model.edges.filter((e) => set.has(e.tail) && set.has(e.head)),
    clusters,
  };
}

/**
 * Lay out clusters as units for engines that do not know about clusters:
 * each cluster's members are laid out on their own, then the cluster takes
 * part in the outer layout as one block, so cluster boxes never swallow
 * unrelated nodes.
 */
function computeClusteredLayout(engine: FlatEngine, input: LayoutInput, parent: string | null): Record<string, Point> {
  const { model } = input;
  const groups = [...model.clusters.values()].filter(
    (c) => c.parent === parent && c.nodeIds.some((id) => model.nodes.has(id)),
  );
  if (!groups.length) return engine(input);

  const sizes = new Map(input.sizes);
  const groupOf = new Map<string, string>();
  const inner = new Map<string, Record<string, Point>>();
  for (const cluster of groups) {
    const members = cluster.nodeIds.filter((id) => model.nodes.has(id));
    const groupId = GROUP_PREFIX + cluster.id;
    const local = computeClusteredLayout(engine, { ...input, model: createSubModel(model, members), sizes }, cluster.id);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of members) {
      const p = local[id];
      const s = sizes.get(id)!;
      minX = Math.min(minX, p.x - s.width / 2);
      maxX = Math.max(maxX, p.x + s.width / 2);
      minY = Math.min(minY, p.y - s.height / 2);
      maxY = Math.max(maxY, p.y + s.height / 2);
    }
    const width = maxX - minX + GROUP_PADDING * 2;
    const height = maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_SPACE;
    // Member offsets relative to the group's center.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2 - GROUP_LABEL_SPACE / 2;
    const offsets: Record<string, Point> = {};
    for (const id of members) {
      offsets[id] = { x: local[id].x - cx, y: local[id].y - cy };
      groupOf.set(id, groupId);
    }
    inner.set(groupId, offsets);
    sizes.set(groupId, { width, height });
  }

  // Collapsed model: free nodes plus one block per cluster, in first-appearance order.
  const nodes = new Map<string, GraphModel["nodes"] extends Map<string, infer V> ? V : never>();
  for (const [id, info] of model.nodes) {
    const group = groupOf.get(id);
    if (!group) nodes.set(id, info);
    else if (!nodes.has(group)) nodes.set(group, { id: group, attrs: {}, htmlKeys: [], order: info.order, cluster: null });
  }
  const edges = model.edges
    .map((e) => ({ ...e, tail: groupOf.get(e.tail) ?? e.tail, head: groupOf.get(e.head) ?? e.head }))
    .filter((e) => e.tail !== e.head || !e.tail.startsWith(GROUP_PREFIX));
  const collapsed: GraphModel = { ...model, nodes, edges, clusters: new Map() };
  const outer = engine({ ...input, model: collapsed, sizes });

  const positions: Record<string, Point> = {};
  for (const id of model.nodes.keys()) {
    const group = groupOf.get(id);
    if (!group) positions[id] = outer[id];
    else {
      const center = outer[group];
      const offset = inner.get(group)![id];
      positions[id] = { x: center.x + offset.x, y: center.y + offset.y };
    }
  }
  return positions;
}

/** Shift a layout so its bounding box starts at (0, 0). */
function normalizeLayout(result: LayoutResult, sizes: Map<string, Size>): LayoutResult {
  let minX = Infinity;
  let minY = Infinity;
  for (const [id, p] of Object.entries(result.positions)) {
    const s = sizes.get(id) ?? { width: 0, height: 0 };
    minX = Math.min(minX, p.x - s.width / 2);
    minY = Math.min(minY, p.y - s.height / 2);
  }
  for (const route of Object.values(result.routes)) {
    for (const p of route.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return result;
  const dx = -minX;
  const dy = -minY;
  const shift = (p: Point): Point => ({ x: round(p.x + dx), y: round(p.y + dy) });
  const positions: Record<string, Point> = {};
  for (const [id, p] of Object.entries(result.positions)) positions[id] = shift(p);
  const routes: Record<string, EdgeRoute> = {};
  for (const [key, r] of Object.entries(result.routes)) {
    routes[key] = { points: r.points.map(shift), tail: shift(r.tail), head: shift(r.head) };
  }
  return { positions, routes };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------------ */

function computeHierarchicalLayout(input: LayoutInput): LayoutResult {
  const { model, sizes, edgeLabelSizes, rankdir } = input;
  const g = new graphlib.Graph({ multigraph: true, compound: true });
  const attrs = model.graphAttrs;
  const nodesep = attrs.nodesep ? Number.parseFloat(attrs.nodesep) * 72 : 36;
  const ranksep = attrs.ranksep ? Number.parseFloat(attrs.ranksep) * 72 : 52;
  g.setGraph({
    rankdir,
    nodesep: Number.isFinite(nodesep) ? nodesep : 36,
    ranksep: Number.isFinite(ranksep) ? ranksep : 52,
    edgesep: 14,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of model.nodes.keys()) {
    const s = sizes.get(id)!;
    g.setNode(id, { width: s.width, height: s.height });
  }
  for (const cluster of model.clusters.values()) {
    if (!cluster.nodeIds.length) continue;
    g.setNode(CLUSTER_PREFIX + cluster.id, { paddingTop: 28, paddingBottom: 14, paddingLeft: 14, paddingRight: 14 });
  }
  for (const cluster of model.clusters.values()) {
    if (!cluster.nodeIds.length) continue;
    if (cluster.parent) g.setParent(CLUSTER_PREFIX + cluster.id, CLUSTER_PREFIX + cluster.parent);
  }
  for (const node of model.nodes.values()) {
    if (node.cluster) g.setParent(node.id, CLUSTER_PREFIX + node.cluster);
  }
  for (const edge of model.edges) {
    if (edge.tail === edge.head) continue;
    const label = edgeLabelSizes.get(edge.key);
    const minlen = Number.parseInt(edge.attrs.minlen ?? "1", 10);
    const weight = Number.parseFloat(edge.attrs.weight ?? "1");
    const constraint = (edge.attrs.constraint ?? "true").toLowerCase() !== "false";
    g.setEdge(
      edge.tail,
      edge.head,
      {
        width: label ? label.width + 8 : 0,
        height: label ? label.height + 4 : 0,
        labelpos: "c",
        minlen: Number.isFinite(minlen) ? Math.max(0, minlen) : 1,
        weight: constraint ? (Number.isFinite(weight) ? weight : 1) : 0,
      },
      edge.key,
    );
  }
  runDagre(g);
  const positions: Record<string, Point> = {};
  for (const id of model.nodes.keys()) {
    const n = g.node(id);
    positions[id] = { x: n.x, y: n.y };
  }
  const routes: Record<string, EdgeRoute> = {};
  for (const edge of model.edges) {
    if (edge.tail === edge.head) continue;
    const e = g.edge({ v: edge.tail, w: edge.head, name: edge.key });
    if (!e?.points || e.points.length < 3) continue;
    const interior = e.points.slice(1, -1).map((p: Point) => ({ x: p.x, y: p.y }));
    // A single midpoint on a straight line adds nothing.
    if (interior.length === 1 && checkCollinear(e.points[0], interior[0], e.points[2])) continue;
    routes[edge.key] = { points: interior, tail: positions[edge.tail], head: positions[edge.head] };
  }
  return { positions, routes };
}

const FLAT_ENGINES: Record<Exclude<LayoutEngine, "hierarchical">, FlatEngine> = {
  force: (input) => computeForceLayout(input),
  radial: (input) => computeRadialLayout(input),
  circular: (input) => computeCircularLayout(input),
  grid: (input) => computeGridLayout(input),
};

function checkCollinear(a: Point, b: Point, c: Point): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) < 1;
}

/* ------------------------------------------------------------------------ */

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function getRadius(size: Size): number {
  return Math.hypot(size.width, size.height) / 2;
}

function computeForceLayout(input: LayoutInput): Record<string, Point> {
  const { model, sizes } = input;
  interface SimNode {
    id: string;
    r: number;
    x?: number;
    y?: number;
  }
  const nodes: SimNode[] = [...model.nodes.keys()].map((id) => ({ id, r: getRadius(sizes.get(id)!) }));
  const seen = new Set<string>();
  const links: { source: string; target: string }[] = [];
  for (const edge of model.edges) {
    if (edge.tail === edge.head) continue;
    const key = [edge.tail, edge.head].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: edge.tail, target: edge.head });
  }
  const simulation = forceSimulation(nodes)
    .randomSource(createSeededRandom(42))
    .force(
      "link",
      forceLink<SimNode, { source: string | SimNode; target: string | SimNode }>(links)
        .id((d) => d.id)
        .distance((l) => 50 + (l.source as SimNode).r + (l.target as SimNode).r),
    )
    .force("charge", forceManyBody<SimNode>().strength(-420))
    .force("collide", forceCollide<SimNode>((d) => d.r + 10).iterations(2))
    .force("x", forceX<SimNode>(0).strength(0.06))
    .force("y", forceY<SimNode>(0).strength(0.06))
    .stop();
  const ticks = Math.min(500, 200 + nodes.length * 2);
  for (let i = 0; i < ticks; i++) simulation.tick();
  const positions: Record<string, Point> = {};
  for (const n of nodes) positions[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };
  return positions;
}

/* ------------------------------------------------------------------------ */

function buildAdjacency(model: GraphModel): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of model.nodes.keys()) adjacency.set(id, []);
  for (const edge of model.edges) {
    if (edge.tail === edge.head) continue;
    adjacency.get(edge.tail)!.push(edge.head);
    adjacency.get(edge.head)!.push(edge.tail);
  }
  return adjacency;
}

/** Split the graph into connected components, ordered by first node appearance. */
function findComponents(model: GraphModel, adjacency: Map<string, string[]>): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of model.nodes.keys()) {
    if (seen.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of adjacency.get(current)!) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function pickRoot(component: string[], adjacency: Map<string, string[]>, preferred?: string): string {
  if (preferred && component.includes(preferred)) return preferred;
  let best = component[0];
  let bestDegree = -1;
  for (const id of component) {
    const degree = adjacency.get(id)!.length;
    if (degree > bestDegree) {
      best = id;
      bestDegree = degree;
    }
  }
  return best;
}

/** Pack per-component layouts (centered at their own origin) into rows. */
function packComponents(parts: { positions: Record<string, Point> }[], sizes: Map<string, Size>): Record<string, Point> {
  const boxes = parts.map((part) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, p] of Object.entries(part.positions)) {
      const s = sizes.get(id)!;
      minX = Math.min(minX, p.x - s.width / 2);
      maxX = Math.max(maxX, p.x + s.width / 2);
      minY = Math.min(minY, p.y - s.height / 2);
      maxY = Math.max(maxY, p.y + s.height / 2);
    }
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  });
  const totalArea = boxes.reduce((s, b) => s + (b.w + 60) * (b.h + 60), 0);
  const rowLimit = Math.max(900, Math.sqrt(totalArea) * 1.6, ...boxes.map((b) => b.w));
  const gap = 60;
  const out: Record<string, Point> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  parts.forEach((part, i) => {
    const box = boxes[i];
    if (x > 0 && x + box.w > rowLimit) {
      x = 0;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    for (const [id, p] of Object.entries(part.positions)) {
      out[id] = { x: p.x - box.minX + x, y: p.y - box.minY + y };
    }
    x += box.w + gap;
    rowHeight = Math.max(rowHeight, box.h);
  });
  return out;
}

function computeRadialLayout(input: LayoutInput): Record<string, Point> {
  const { model, sizes } = input;
  const adjacency = buildAdjacency(model);
  const components = findComponents(model, adjacency);
  const maxDiameter = Math.max(36, ...[...sizes.values()].map((s) => getRadius(s) * 2));
  const ringGap = maxDiameter + 40;

  const parts = components.map((component) => {
    const root = pickRoot(component, adjacency, model.graphAttrs.root);
    const children = new Map<string, string[]>();
    const depth = new Map<string, number>([[root, 0]]);
    const queue = [root];
    while (queue.length) {
      const current = queue.shift()!;
      children.set(current, []);
      for (const next of adjacency.get(current)!) {
        if (!depth.has(next)) {
          depth.set(next, depth.get(current)! + 1);
          children.get(current)!.push(next);
          queue.push(next);
        }
      }
    }
    const leaves = new Map<string, number>();
    const countLeaves = (id: string): number => {
      const kids = children.get(id)!;
      const n = kids.length ? kids.reduce((s, k) => s + countLeaves(k), 0) : 1;
      leaves.set(id, n);
      return n;
    };
    countLeaves(root);
    // Ring radii large enough to fit the nodes at that depth.
    const widthAtDepth = new Map<number, number>();
    for (const [id, d] of depth) widthAtDepth.set(d, (widthAtDepth.get(d) ?? 0) + getRadius(sizes.get(id)!) * 2 + 16);
    const radii: number[] = [0];
    const maxDepth = Math.max(...depth.values());
    for (let d = 1; d <= maxDepth; d++) {
      radii[d] = Math.max(radii[d - 1] + ringGap, (widthAtDepth.get(d) ?? 0) / (2 * Math.PI));
    }
    const positions: Record<string, Point> = {};
    const place = (id: string, start: number, end: number): void => {
      const d = depth.get(id)!;
      const angle = (start + end) / 2;
      positions[id] = d === 0 ? { x: 0, y: 0 } : { x: Math.cos(angle) * radii[d], y: Math.sin(angle) * radii[d] };
      const kids = children.get(id)!;
      const total = leaves.get(id)!;
      let cursor = start;
      for (const kid of kids) {
        const span = ((end - start) * leaves.get(kid)!) / total;
        place(kid, cursor, cursor + span);
        cursor += span;
      }
    };
    place(root, -Math.PI / 2, (3 * Math.PI) / 2);
    return { positions };
  });
  return packComponents(parts, sizes);
}

function computeCircularLayout(input: LayoutInput): Record<string, Point> {
  const { model, sizes } = input;
  const adjacency = buildAdjacency(model);
  const components = findComponents(model, adjacency);
  const parts = components.map((component) => {
    if (component.length === 1) return { positions: { [component[0]]: { x: 0, y: 0 } } };
    // DFS order keeps neighbors adjacent on the circle (fewer crossings).
    const root = pickRoot(component, adjacency);
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      seen.add(id);
      order.push(id);
      for (const next of adjacency.get(id)!) if (!seen.has(next)) visit(next);
    };
    visit(root);
    const circumference = order.reduce((s, id) => s + getRadius(sizes.get(id)!) * 2 + 24, 0);
    const radius = Math.max(60, circumference / (2 * Math.PI));
    const positions: Record<string, Point> = {};
    order.forEach((id, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / order.length;
      positions[id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    return { positions };
  });
  return packComponents(parts, sizes);
}

/** Order nodes topologically where possible (Kahn), falling back to declaration order. */
export function orderNodesByFlow(model: GraphModel): string[] {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of model.nodes.keys()) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of model.edges) {
    if (edge.tail === edge.head) continue;
    outgoing.get(edge.tail)!.push(edge.head);
    indegree.set(edge.head, indegree.get(edge.head)! + 1);
  }
  const order: string[] = [];
  const remaining = new Set(model.nodes.keys());
  while (remaining.size) {
    let ready = [...remaining].filter((id) => indegree.get(id) === 0);
    if (!ready.length) ready = [[...remaining][0]]; // break a cycle
    for (const id of ready) {
      remaining.delete(id);
      order.push(id);
      for (const next of outgoing.get(id)!) indegree.set(next, indegree.get(next)! - 1);
    }
  }
  return order;
}

function computeGridLayout(input: LayoutInput): Record<string, Point> {
  const { model, sizes, rankdir } = input;
  const order = orderNodesByFlow(model);
  const n = order.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
  const cellW = Math.max(54, ...order.map((id) => sizes.get(id)!.width)) + 40;
  const cellH = Math.max(36, ...order.map((id) => sizes.get(id)!.height)) + 40;
  const transpose = rankdir === "LR" || rankdir === "RL";
  const positions: Record<string, Point> = {};
  order.forEach((id, i) => {
    const row = Math.floor(i / columns);
    const col = i % columns;
    positions[id] = transpose ? { x: row * cellW, y: col * cellH } : { x: col * cellW, y: row * cellH };
  });
  return positions;
}
