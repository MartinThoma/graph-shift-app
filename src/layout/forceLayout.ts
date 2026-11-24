/**
 * Force-directed layout that tries hard to avoid edge crossings:
 * 1. run a deterministic d3-force simulation from several starting
 *    arrangements and keep the result with the fewest crossings;
 * 2. refine it by swapping the positions of nodes on crossing edges, or
 *    mirroring a node across the other edge, whenever that removes crossings.
 * Swaps keep the set of occupied spots, so they never create overlaps.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { GraphModel } from "../dot/model";
import type { Point } from "../render/shapes";

export interface ForceInput {
  model: GraphModel;
  sizes: Map<string, { width: number; height: number }>;
}

type Link = [string, string];

const MULTI_START_NODE_LIMIT = 60;
/** Work cap for crossing refinement (segment tests), so big graphs stay fast and results stay deterministic. */
const REFINE_BUDGET = 600_000;
const REFINE_EDGE_LIMIT = 400;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function getRadius(size: { width: number; height: number }): number {
  return Math.hypot(size.width, size.height) / 2;
}

/** Unique undirected links between distinct nodes. */
export function collectLinks(model: GraphModel): Link[] {
  const seen = new Set<string>();
  const links: Link[] = [];
  for (const edge of model.edges) {
    if (edge.tail === edge.head) continue;
    const key = [edge.tail, edge.head].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([edge.tail, edge.head]);
  }
  return links;
}

function checkSegmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function checkLinksCross(l1: Link, l2: Link, positions: Record<string, Point>): boolean {
  if (l1[0] === l2[0] || l1[0] === l2[1] || l1[1] === l2[0] || l1[1] === l2[1]) return false;
  return checkSegmentsCross(positions[l1[0]], positions[l1[1]], positions[l2[0]], positions[l2[1]]);
}

/** Number of pairs of straight edges that cross (edges sharing a node never count). */
export function countEdgeCrossings(links: Link[], positions: Record<string, Point>): number {
  let count = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) if (checkLinksCross(links[i], links[j], positions)) count++;
  }
  return count;
}

/** Crossings that involve at least one edge touching one of `nodes` (each pair counted once). */
function countCrossingsAround(nodes: Set<string>, links: Link[], positions: Record<string, Point>, work?: { used: number }): number {
  const touching: number[] = [];
  for (let i = 0; i < links.length; i++) if (nodes.has(links[i][0]) || nodes.has(links[i][1])) touching.push(i);
  const touchingSet = new Set(touching);
  let count = 0;
  if (work) work.used += touching.length * links.length;
  for (const i of touching) {
    for (let j = 0; j < links.length; j++) {
      if (j === i || (touchingSet.has(j) && j < i)) continue;
      if (checkLinksCross(links[i], links[j], positions)) count++;
    }
  }
  return count;
}

function runSimulation(
  ids: string[],
  radii: Map<string, number>,
  links: Link[],
  start: Record<string, Point> | null,
  seed: number,
): Record<string, Point> {
  interface SimNode {
    id: string;
    r: number;
    x?: number;
    y?: number;
  }
  const nodes: SimNode[] = ids.map((id) => ({ id, r: radii.get(id)!, ...(start ? { x: start[id].x, y: start[id].y } : {}) }));
  const simulation = forceSimulation(nodes)
    .randomSource(createSeededRandom(seed))
    .force(
      "link",
      forceLink<SimNode, { source: string | SimNode; target: string | SimNode }>(links.map(([source, target]) => ({ source, target })))
        .id((d) => d.id)
        .distance((l) => 50 + (l.source as SimNode).r + (l.target as SimNode).r),
    )
    .force("charge", forceManyBody<SimNode>().strength(-420))
    .force("collide", forceCollide<SimNode>((d) => d.r + 10).iterations(2))
    .force("x", forceX<SimNode>(0).strength(0.06))
    .force("y", forceY<SimNode>(0).strength(0.06))
    .stop();
  const ticks = Math.min(300, 200 + nodes.length);
  for (let i = 0; i < ticks; i++) simulation.tick();
  const positions: Record<string, Point> = {};
  for (const n of nodes) positions[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };
  return positions;
}

/** Starting arrangement: nodes on a circle in depth-first order (neighbors adjacent). */
function createCircleStart(ids: string[], links: Link[]): Record<string, Point> {
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of links) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    seen.add(id);
    order.push(id);
    for (const next of adjacency.get(id)!) if (!seen.has(next)) visit(next);
  };
  for (const id of [...ids].sort((a, b) => adjacency.get(b)!.length - adjacency.get(a)!.length)) if (!seen.has(id)) visit(id);
  const radius = Math.max(80, Math.sqrt(ids.length) * 70);
  const out: Record<string, Point> = {};
  order.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / order.length;
    out[id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  return out;
}

function createRandomStart(ids: string[], seed: number): Record<string, Point> {
  const random = createSeededRandom(seed);
  const spread = Math.max(100, Math.sqrt(ids.length) * 80);
  const out: Record<string, Point> = {};
  for (const id of ids) out[id] = { x: (random() - 0.5) * spread, y: (random() - 0.5) * spread };
  return out;
}

function reflectPoint(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const foot = { x: a.x + t * dx, y: a.y + t * dy };
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}

/**
 * Greedy crossing removal: for each crossing pair, try swapping two of its
 * four endpoints, then mirroring an endpoint across the other edge; keep a
 * move only when it lowers the number of crossings (and causes no overlap).
 */
export function reduceCrossings(
  links: Link[],
  positions: Record<string, Point>,
  radii: Map<string, number>,
  maxPasses = 20,
  budget = REFINE_BUDGET,
): Record<string, Point> {
  const pos: Record<string, Point> = { ...positions };
  const work = { used: 0 };
  const ids = Object.keys(pos);
  const checkFree = (id: string, p: Point): boolean =>
    ids.every((other) => other === id || Math.hypot(pos[other].x - p.x, pos[other].y - p.y) >= radii.get(id)! + radii.get(other)! + 8);

  for (let pass = 0; pass < maxPasses && work.used < budget; pass++) {
    let improved = false;
    for (let i = 0; i < links.length && work.used < budget; i++) {
      work.used += links.length - i;
      for (let j = i + 1; j < links.length && work.used < budget; j++) {
        const e1 = links[i];
        const e2 = links[j];
        if (!checkLinksCross(e1, e2, pos)) continue;
        let fixed = false;
        for (const [u, v] of [
          [e1[0], e2[0]],
          [e1[0], e2[1]],
          [e1[1], e2[0]],
          [e1[1], e2[1]],
        ]) {
          const touched = new Set([u, v]);
          const before = countCrossingsAround(touched, links, pos, work);
          [pos[u], pos[v]] = [pos[v], pos[u]];
          if (countCrossingsAround(touched, links, pos, work) < before) {
            fixed = true;
            break;
          }
          [pos[u], pos[v]] = [pos[v], pos[u]];
        }
        if (!fixed) {
          for (const [u, other] of [
            [e1[0], e2],
            [e1[1], e2],
            [e2[0], e1],
            [e2[1], e1],
          ] as [string, Link][]) {
            const target = reflectPoint(pos[u], pos[other[0]], pos[other[1]]);
            if (!checkFree(u, target)) continue;
            const touched = new Set([u]);
            const before = countCrossingsAround(touched, links, pos, work);
            const old = pos[u];
            pos[u] = target;
            if (countCrossingsAround(touched, links, pos, work) < before) {
              fixed = true;
              break;
            }
            pos[u] = old;
          }
        }
        if (fixed) improved = true;
      }
    }
    if (!improved) break;
  }
  return pos;
}

/** Deterministic force-directed positions with few edge crossings. */
export function computeForceLayout(input: ForceInput): Record<string, Point> {
  const ids = [...input.model.nodes.keys()];
  if (!ids.length) return {};
  const radii = new Map(ids.map((id) => [id, getRadius(input.sizes.get(id)!)]));
  const links = collectLinks(input.model);
  const starts: { start: Record<string, Point> | null; seed: number }[] = [{ start: null, seed: 42 }];
  if (ids.length <= MULTI_START_NODE_LIMIT && links.length > 1) {
    starts.push({ start: createCircleStart(ids, links), seed: 7 });
    starts.push({ start: createRandomStart(ids, 11), seed: 11 });
    starts.push({ start: createRandomStart(ids, 23), seed: 23 });
  }
  let best: Record<string, Point> | null = null;
  let bestCrossings = Infinity;
  for (const { start, seed } of starts) {
    const positions = runSimulation(ids, radii, links, start, seed);
    const crossings = countEdgeCrossings(links, positions);
    if (crossings < bestCrossings) {
      best = positions;
      bestCrossings = crossings;
      if (crossings === 0) break;
    }
  }
  if (bestCrossings > 0 && links.length <= REFINE_EDGE_LIMIT) best = reduceCrossings(links, best!, radii);
  return best!;
}
