/**
 * Edge geometry: paths that stay attached to their nodes as nodes move.
 *
 * - Edges are clipped to the node outlines (ellipse, polygon or box).
 * - Parallel edges between the same pair fan out as curves (index-based bend).
 * - Self-loops are drawn as loops on the node's right side, stacked per index.
 * - Routed edges (hierarchical layout) keep their waypoints, which deform
 *   smoothly with the endpoints' displacement while nodes are dragged.
 */
import type { EdgeRoute } from "../layout/initialLayout";
import { intersectOutline, type Outline, type Point } from "../render/shapes";

export interface NodeGeometry {
  center: Point;
  outline: Outline;
  width: number;
  height: number;
}

export interface ArrowPath {
  d: string;
  filled: boolean;
}

export interface EdgeGeometryInput {
  tail: NodeGeometry;
  head: NodeGeometry;
  /** Interior waypoints (already deformed to current node positions). */
  route: Point[] | null;
  /** Perpendicular bend in px for parallel edges; 0 = straight. */
  bend: number;
  /** Index among self-loops on the same node. */
  loopIndex: number;
  arrowHead: string | null;
  arrowTail: string | null;
  arrowSize: number;
  strokeWidth: number;
  tailPort: string | null;
  headPort: string | null;
  selfLoop: boolean;
}

export interface EdgeGeometry {
  /** Whether the main label is centered on its anchor or starts at it. */
  labelAlign: "center" | "start";
  path: string;
  headArrow: ArrowPath | null;
  tailArrow: ArrowPath | null;
  start: Point;
  end: Point;
  labelAnchor: Point;
  headLabelAnchor: Point;
  tailLabelAnchor: Point;
  /** Control points (for bounds computation). */
  extent: Point[];
  /** Polyline approximation of the drawn curve (for collision checks). */
  samples: Point[];
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s };
}

function normalize(a: Point): Point {
  const len = Math.hypot(a.x, a.y);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: a.x / len, y: a.y / len };
}

/* ------------------------------------------------------------------------ */
/* Arrowheads                                                                */
/* ------------------------------------------------------------------------ */

interface ArrowSpec {
  /** Local path with the tip at (0,0) pointing towards +x. */
  local: string;
  filled: boolean;
  /** How far the line must stop short of the tip. */
  length: number;
}

/** Build an arrowhead in local coordinates (tip at origin, pointing +x). */
export function createArrowSpec(name: string, arrowSize: number, strokeWidth: number): ArrowSpec | null {
  const sizeFactor = arrowSize * (1 + Math.max(0, strokeWidth - 1) * 0.35);
  const L = 7.5 * sizeFactor;
  const W = 2.9 * sizeFactor;
  let n = name.toLowerCase();
  let open = false;
  if (n === "empty") n = "onormal";
  if (n === "invempty") n = "oinv";
  if (n === "halfopen") n = "vee";
  if (n.startsWith("o") && n !== "open") {
    open = true;
    n = n.slice(1);
  }
  n = n.replace(/^[lr](?=[a-z])/, "");
  const match = /^(normal|inv|vee|open|dot|diamond|box|tee|crow|none|curve|icurve)/.exec(n);
  const kind = match ? match[1] : "normal";
  switch (kind) {
    case "none":
      return null;
    case "inv":
      return { local: `M${f(-L)} 0L0 ${f(-W)}L0 ${f(W)}Z`, filled: !open, length: L };
    case "vee":
      return { local: `M0 0L${f(-L)} ${f(-W * 1.2)}L${f(-L * 0.65)} 0L${f(-L)} ${f(W * 1.2)}Z`, filled: !open, length: L * 0.65 };
    case "open":
      return { local: `M${f(-L)} ${f(-W * 1.2)}L0 0L${f(-L)} ${f(W * 1.2)}`, filled: false, length: 0 };
    case "crow":
      return { local: `M${f(-L)} 0L0 ${f(-W * 1.2)}L${f(-L * 0.35)} 0L0 ${f(W * 1.2)}Z`, filled: !open, length: L };
    case "dot": {
      const r = W * 1.05;
      return {
        local: `M0 0A${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0A${f(r)} ${f(r)} 0 1 0 0 0Z`,
        filled: !open,
        length: 2 * r,
      };
    }
    case "diamond":
      return { local: `M0 0L${f(-L * 0.8)} ${f(-W)}L${f(-L * 1.6)} 0L${f(-L * 0.8)} ${f(W)}Z`, filled: !open, length: L * 1.6 };
    case "box":
      return { local: `M0 ${f(-W)}L${f(-W * 2)} ${f(-W)}L${f(-W * 2)} ${f(W)}L0 ${f(W)}Z`, filled: !open, length: W * 2 };
    case "tee":
      return { local: `M${f(-1.5)} ${f(-W * 1.4)}L${f(-3.5)} ${f(-W * 1.4)}L${f(-3.5)} ${f(W * 1.4)}L${f(-1.5)} ${f(W * 1.4)}Z`, filled: true, length: 0 };
    case "curve":
    case "icurve":
      return { local: `M0 0L${f(-L)} 0M${f(-L * 0.6)} ${f(-W * 1.3)}Q${f(-L * 0.2)} 0 ${f(-L * 0.6)} ${f(W * 1.3)}`, filled: false, length: 0 };
    default:
      return { local: `M0 0L${f(-L)} ${f(-W)}L${f(-L)} ${f(W)}Z`, filled: !open, length: L };
  }
}

/** Transform a local arrow path (tip at origin, +x) to a tip position and direction. */
function placeArrow(spec: ArrowSpec, tip: Point, direction: Point): ArrowPath {
  const angle = Math.atan2(direction.y, direction.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Transform each coordinate pair in the path (absolute commands M, L, Q, A).
  const d = spec.local.replace(/([MLQA])([^MLQAZ]*)/g, (_, cmd: string, args: string) => {
    const nums = args.trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (cmd === "A") {
      // rx ry rot large sweep x y
      const [rx, ry, rot, large, sweep, x, y] = nums;
      const px = tip.x + x * cos - y * sin;
      const py = tip.y + x * sin + y * cos;
      return `A${f(rx)} ${f(ry)} ${f(rot + (angle * 180) / Math.PI)} ${large} ${sweep} ${f(px)} ${f(py)}`;
    }
    const out: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      out.push(`${f(tip.x + x * cos - y * sin)} ${f(tip.y + x * sin + y * cos)}`);
    }
    return `${cmd}${out.join(" ")}`;
  });
  return { d, filled: spec.filled };
}

/* ------------------------------------------------------------------------ */
/* Ports                                                                     */
/* ------------------------------------------------------------------------ */

const COMPASS: Record<string, [number, number]> = {
  n: [0, -0.5],
  ne: [0.5, -0.5],
  e: [0.5, 0],
  se: [0.5, 0.5],
  s: [0, 0.5],
  sw: [-0.5, 0.5],
  w: [-0.5, 0],
  nw: [-0.5, -0.5],
};

/** Resolve a compass port (`n`, `se`, `p:w`...) to an anchor offset relative to the center. */
function resolvePortAnchor(node: NodeGeometry, port: string | null): Point | null {
  if (!port) return null;
  const parts = port.toLowerCase().split(":");
  const compass = parts[parts.length - 1];
  const c = COMPASS[compass];
  if (!c) return null;
  const toward = { x: c[0] * node.width, y: c[1] * node.height };
  return intersectOutline(node.outline, toward);
}

/* ------------------------------------------------------------------------ */
/* Route deformation                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Deform a stored route so it follows its endpoints: each waypoint moves by an
 * interpolation of the tail and head displacement, weighted by its position
 * along the route.
 */
export function deformRoute(route: EdgeRoute, tailCenter: Point, headCenter: Point): Point[] {
  const dTail = subtract(tailCenter, route.tail);
  const dHead = subtract(headCenter, route.head);
  if (Math.abs(dTail.x) + Math.abs(dTail.y) + Math.abs(dHead.x) + Math.abs(dHead.y) < 1e-6) return route.points;
  const chain = [route.tail, ...route.points, route.head];
  const lengths = [0];
  for (let i = 1; i < chain.length; i++) lengths.push(lengths[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y));
  const total = lengths[lengths.length - 1] || 1;
  return route.points.map((p, i) => {
    const t = lengths[i + 1] / total;
    return { x: p.x + dTail.x * (1 - t) + dHead.x * t, y: p.y + dTail.y * (1 - t) + dHead.y * t };
  });
}

/* ------------------------------------------------------------------------ */
/* Paths                                                                     */
/* ------------------------------------------------------------------------ */

interface CubicSegment {
  p0: Point;
  c1: Point;
  c2: Point;
  p3: Point;
}

/**
 * Uniform cubic B-spline through the control points (like d3.curveBasis):
 * starts and ends exactly at the first/last point and stays smooth, without
 * the overshoots of an interpolating spline. Returns the line-to start and
 * cubic segments.
 */
export function computeBasisSegments(points: Point[]): { lead: [Point, Point] | null; segments: CubicSegment[]; tail: Point | null } {
  const segments: CubicSegment[] = [];
  if (points.length < 3) return { lead: null, segments, tail: null };
  let x0 = points[0];
  let x1 = points[1];
  const leadEnd = { x: (5 * x0.x + x1.x) / 6, y: (5 * x0.y + x1.y) / 6 };
  let current = leadEnd;
  const push = (next: Point): void => {
    const p3 = { x: (x0.x + 4 * x1.x + next.x) / 6, y: (x0.y + 4 * x1.y + next.y) / 6 };
    segments.push({
      p0: current,
      c1: { x: (2 * x0.x + x1.x) / 3, y: (2 * x0.y + x1.y) / 3 },
      c2: { x: (x0.x + 2 * x1.x) / 3, y: (x0.y + 2 * x1.y) / 3 },
      p3,
    });
    current = p3;
  };
  for (let i = 2; i < points.length; i++) {
    push(points[i]);
    x0 = x1;
    x1 = points[i];
  }
  push(x1);
  return { lead: [points[0], leadEnd], segments, tail: x1 };
}

function evaluateCubic(s: CubicSegment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x, y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y };
}

/** Smooth path through routed waypoints (B-spline), plus a polyline sampling of it. */
export function createBasisPath(points: Point[]): { d: string; samples: Point[] } {
  if (points.length < 3) {
    return { d: `M${f(points[0].x)} ${f(points[0].y)}L${f(points[points.length - 1].x)} ${f(points[points.length - 1].y)}`, samples: points };
  }
  const { lead, segments, tail } = computeBasisSegments(points);
  let d = `M${f(lead![0].x)} ${f(lead![0].y)}L${f(lead![1].x)} ${f(lead![1].y)}`;
  const samples: Point[] = [lead![0], lead![1]];
  for (const seg of segments) {
    d += `C${f(seg.c1.x)} ${f(seg.c1.y)} ${f(seg.c2.x)} ${f(seg.c2.y)} ${f(seg.p3.x)} ${f(seg.p3.y)}`;
    for (let i = 1; i <= 6; i++) samples.push(evaluateCubic(seg, i / 6));
  }
  d += `L${f(tail!.x)} ${f(tail!.y)}`;
  samples.push(tail!);
  return { d, samples };
}

function getPointAlongPolyline(points: Point[], fraction: number): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let target = total * fraction;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (target <= seg || i === points.length - 1) {
      const t = seg ? Math.min(1, target / seg) : 0;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    target -= seg;
  }
  return points[0];
}

/** Compute the full geometry of an edge for the current node positions. */
export function computeEdgeGeometry(input: EdgeGeometryInput): EdgeGeometry {
  const { tail, head } = input;
  const headSpec = input.arrowHead ? createArrowSpec(input.arrowHead, input.arrowSize, input.strokeWidth) : null;
  const tailSpec = input.arrowTail ? createArrowSpec(input.arrowTail, input.arrowSize, input.strokeWidth) : null;

  if (input.selfLoop) {
    return computeSelfLoopGeometry(input, headSpec, tailSpec);
  }

  const tc = tail.center;
  const hc = head.center;
  let aimTail: Point;
  let aimHead: Point;
  let control: Point | null = null;
  const route = input.route && input.route.length ? input.route : null;
  if (route) {
    aimTail = route[0];
    aimHead = route[route.length - 1];
  } else if (input.bend !== 0) {
    const mid = scale(add(tc, hc), 0.5);
    const dir = normalize(subtract(hc, tc));
    const normal = { x: -dir.y, y: dir.x };
    control = add(mid, scale(normal, input.bend * 2));
    aimTail = control;
    aimHead = control;
  } else {
    aimTail = hc;
    aimHead = tc;
  }

  const tailPort = resolvePortAnchor(tail, input.tailPort);
  const headPort = resolvePortAnchor(head, input.headPort);
  let start = tailPort ? add(tc, tailPort) : add(tc, intersectOutline(tail.outline, subtract(aimTail, tc)));
  let end = headPort ? add(hc, headPort) : add(hc, intersectOutline(head.outline, subtract(aimHead, hc)));

  // If the nodes overlap, fall back to centers so the edge stays visible.
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1 && !route) {
    start = tc;
    end = hc;
  }

  const headDir = normalize(subtract(end, route ? aimHead : control ?? start));
  const tailDir = normalize(subtract(start, route ? aimTail : control ?? end));
  const headArrow = headSpec ? placeArrow(headSpec, end, headDir) : null;
  const tailArrow = tailSpec ? placeArrow(tailSpec, start, tailDir) : null;
  const lineEnd = headSpec ? subtract(end, scale(headDir, headSpec.length)) : end;
  const lineStart = tailSpec ? subtract(start, scale(tailDir, tailSpec.length)) : start;

  let path: string;
  let labelAnchor: Point;
  let extent: Point[];
  let samples: Point[];
  if (route) {
    const points = [lineStart, ...route, lineEnd];
    const basis = createBasisPath(points);
    path = basis.d;
    samples = basis.samples;
    labelAnchor = getPointAlongPolyline(samples, 0.5);
    extent = points;
  } else if (control) {
    path = `M${f(lineStart.x)} ${f(lineStart.y)}Q${f(control.x)} ${f(control.y)} ${f(lineEnd.x)} ${f(lineEnd.y)}`;
    labelAnchor = {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
    };
    extent = [lineStart, control, lineEnd];
    samples = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const u = 1 - t;
      samples.push({ x: u * u * lineStart.x + 2 * u * t * control.x + t * t * lineEnd.x, y: u * u * lineStart.y + 2 * u * t * control.y + t * t * lineEnd.y });
    }
  } else {
    path = `M${f(lineStart.x)} ${f(lineStart.y)}L${f(lineEnd.x)} ${f(lineEnd.y)}`;
    labelAnchor = scale(add(start, end), 0.5);
    extent = [lineStart, lineEnd];
    samples = [lineStart, lineEnd];
  }
  const headNormal = { x: -headDir.y, y: headDir.x };
  const tailNormal = { x: -tailDir.y, y: tailDir.x };
  return {
    labelAlign: "center",
    path,
    headArrow,
    tailArrow,
    start,
    end,
    labelAnchor,
    headLabelAnchor: add(subtract(end, scale(headDir, 16)), scale(headNormal, 10)),
    tailLabelAnchor: add(subtract(start, scale(tailDir, 16)), scale(tailNormal, 10)),
    extent,
    samples,
  };
}

function computeSelfLoopGeometry(input: EdgeGeometryInput, headSpec: ArrowSpec | null, tailSpec: ArrowSpec | null): EdgeGeometry {
  const node = input.tail;
  const c = node.center;
  const k = input.loopIndex;
  const spread = 0.22 + k * 0.06;
  const start = add(c, intersectOutline(node.outline, { x: node.width / 2, y: -node.height * spread }));
  const end = add(c, intersectOutline(node.outline, { x: node.width / 2, y: node.height * spread }));
  const extentX = 30 + k * 16;
  const extentY = Math.max(10, node.height * 0.3) + k * 6;
  const c1 = { x: start.x + extentX, y: start.y - extentY };
  const c2 = { x: end.x + extentX, y: end.y + extentY };
  const headDir = normalize(subtract(end, c2));
  const tailDir = normalize(subtract(start, c1));
  const headArrow = headSpec ? placeArrow(headSpec, end, headDir) : null;
  const tailArrow = tailSpec ? placeArrow(tailSpec, start, tailDir) : null;
  const lineEnd = headSpec ? subtract(end, scale(headDir, headSpec.length)) : end;
  const lineStart = tailSpec ? subtract(start, scale(tailDir, tailSpec.length)) : start;
  const path = `M${f(lineStart.x)} ${f(lineStart.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(lineEnd.x)} ${f(lineEnd.y)}`;
  const apex = {
    x: 0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y,
  };
  return {
    labelAlign: "start",
    path,
    headArrow,
    tailArrow,
    start,
    end,
    labelAnchor: { x: apex.x + 6, y: apex.y },
    headLabelAnchor: add(end, { x: 10, y: 12 }),
    tailLabelAnchor: add(start, { x: 10, y: -12 }),
    extent: [lineStart, c1, c2, lineEnd],
    samples: Array.from({ length: 13 }, (_, i) => evaluateCubic({ p0: lineStart, c1, c2, p3: lineEnd }, i / 12)),
  };
}
