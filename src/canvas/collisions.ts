/**
 * Collision helpers that keep the drawing legible:
 * - straight edges bend around nodes they do not connect,
 * - edge labels sit beside their line, clear of nodes, cluster rules, arrowheads and other labels,
 * - cluster labels slide along the cluster's top band to a spot no edge crosses.
 */
import type { Point } from "../render/shapes";
import type { Rect } from "./scene";

/** Above this many nodes avoidance is skipped to keep dragging smooth. */
export const AVOIDANCE_NODE_LIMIT = 400;

export function checkRectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

export function checkPointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad;
}

function intersectSegments(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Whether the segment p-q touches the rectangle. */
export function checkSegmentHitsRect(p: Point, q: Point, r: Rect): boolean {
  if (checkPointInRect(p, r) || checkPointInRect(q, r)) return true;
  if (Math.max(p.x, q.x) < r.x || Math.min(p.x, q.x) > r.x + r.w || Math.max(p.y, q.y) < r.y || Math.min(p.y, q.y) > r.y + r.h) return false;
  const a = { x: r.x, y: r.y };
  const b = { x: r.x + r.w, y: r.y };
  const c = { x: r.x + r.w, y: r.y + r.h };
  const d = { x: r.x, y: r.y + r.h };
  return intersectSegments(p, q, a, b) || intersectSegments(p, q, b, c) || intersectSegments(p, q, c, d) || intersectSegments(p, q, d, a);
}

export function checkPolylineHitsRect(points: Point[], r: Rect): boolean {
  for (let i = 1; i < points.length; i++) if (checkSegmentHitsRect(points[i - 1], points[i], r)) return true;
  return false;
}

function sampleQuadratic(a: Point, c: Point, b: Point, steps = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return out;
}

/**
 * Pick a bend (same convention as parallel-edge bends: control point at
 * mid + normal * bend * 2) so the center-to-center curve misses every obstacle.
 * Returns the initial bend when it is already clear or nothing better exists.
 */
export function computeAvoidanceBend(tail: Point, head: Point, initialBend: number, obstacles: Rect[]): number {
  if (!obstacles.length) return initialBend;
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return initialBend;
  const normal = { x: -dy / length, y: dx / length };
  const mid = { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
  // A bend is the curve's deviation at its middle; keep detours short so edges stay readable.
  const maxDeviation = Math.min(90, Math.max(36, length * 0.3));
  const corridor: Rect = {
    x: Math.min(tail.x, head.x) - maxDeviation,
    y: Math.min(tail.y, head.y) - maxDeviation,
    w: Math.abs(dx) + maxDeviation * 2,
    h: Math.abs(dy) + maxDeviation * 2,
  };
  const near = obstacles.filter((o) => checkRectsOverlap(o, corridor));
  if (!near.length) return initialBend;
  const countHits = (bend: number): number => {
    const control = { x: mid.x + normal.x * bend * 2, y: mid.y + normal.y * bend * 2 };
    const samples = bend === 0 ? [tail, head] : sampleQuadratic(tail, control, head);
    return near.filter((o) => checkPolylineHitsRect(samples, o)).length;
  };
  let best = initialBend;
  let bestHits = countHits(initialBend);
  if (bestHits === 0) return initialBend;
  for (let step = 1; step * 12 <= maxDeviation; step++) {
    for (const sign of [1, -1]) {
      const bend = initialBend + sign * step * 12;
      const hits = countHits(bend);
      if (hits < bestHits) {
        best = bend;
        bestHits = hits;
        if (hits === 0) return bend;
      }
    }
  }
  // No short detour clears every box: take the one with the fewest crossings.
  return best;
}

export interface LabelObstacles {
  nodes: Rect[];
  clusterRules: Rect[];
  arrowTips: Point[];
  placed: Rect[];
  lines: Point[][];
}

export function countLabelCollisions(rect: Rect, obstacles: LabelObstacles, ownLine: Point[] | null): number {
  let count = 0;
  for (const n of obstacles.nodes) if (checkRectsOverlap(rect, n, 2)) count += 3;
  for (const r of obstacles.clusterRules) if (checkRectsOverlap(rect, r, 1)) count += 2;
  for (const t of obstacles.arrowTips) if (checkPointInRect(t, rect, 6)) count += 2;
  for (const p of obstacles.placed) if (checkRectsOverlap(rect, p, 2)) count += 3;
  if (ownLine && checkPolylineHitsRect(ownLine, rect)) count += 1;
  for (const line of obstacles.lines) if (line !== ownLine && checkPolylineHitsRect(line, rect)) count += 1;
  return count;
}

/** Thin rectangles along a cluster box's border (its "rules"). */
export function createRuleRects(r: Rect, thickness = 3): Rect[] {
  const h = thickness;
  return [
    { x: r.x, y: r.y - h / 2, w: r.w, h },
    { x: r.x, y: r.y + r.h - h / 2, w: r.w, h },
    { x: r.x - h / 2, y: r.y, w: h, h: r.h },
    { x: r.x + r.w - h / 2, y: r.y, w: h, h: r.h },
  ];
}

/**
 * Place an edge label: beside its line (right of mostly vertical edges, above
 * mostly horizontal ones), falling back to other sides and positions along the
 * line, choosing the spot with the fewest collisions.
 */
export function placeEdgeLabel(samples: Point[], anchor: Point, size: { width: number; height: number }, obstacles: LabelObstacles): Point {
  const first = samples[0];
  const last = samples[samples.length - 1];
  let dx = last.x - first.x;
  let dy = last.y - first.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  let normal = { x: -dy, y: dx };
  const vertical = Math.abs(dy) >= Math.abs(dx);
  if (vertical ? normal.x < 0 : normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  const offset = Math.abs(normal.x) * (size.width / 2) + Math.abs(normal.y) * (size.height / 2) + 6;
  const along = [0, -0.18, 0.18, -0.32, 0.32].map((t) => ({ x: anchor.x + dx * t * length, y: anchor.y + dy * t * length }));
  const candidates: Point[] = [];
  for (const base of along) {
    candidates.push({ x: base.x + normal.x * offset, y: base.y + normal.y * offset });
    candidates.push({ x: base.x - normal.x * offset, y: base.y - normal.y * offset });
  }
  candidates.push(anchor);
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const rect = { x: c.x - size.width / 2, y: c.y - size.height / 2, w: size.width, h: size.height };
    const score = countLabelCollisions(rect, obstacles, samples);
    if (score < bestScore) {
      best = c;
      bestScore = score;
      if (score === 0) break;
    }
  }
  return best;
}

/** Slide a cluster label along the top (or bottom) band to a spot that no edge crosses. */
export function placeClusterLabel(
  rect: Rect,
  size: { width: number; height: number },
  just: "l" | "r" | "c",
  loc: "t" | "b",
  lines: Point[][],
): Point {
  const inset = 10;
  const y = loc === "t" ? rect.y + inset + size.height / 2 : rect.y + rect.h - inset - size.height / 2;
  const minX = rect.x + inset + size.width / 2;
  const maxX = rect.x + rect.w - inset - size.width / 2;
  const preferred = just === "r" ? maxX : just === "c" ? (minX + maxX) / 2 : minX;
  if (maxX <= minX) return { x: rect.x + rect.w / 2, y };
  const xs = [preferred];
  for (let x = minX; x <= maxX; x += 12) xs.push(x);
  xs.push(maxX);
  xs.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
  for (const x of xs) {
    const box = { x: x - size.width / 2 - 3, y: y - size.height / 2 - 2, w: size.width + 6, h: size.height + 4 };
    if (!lines.some((line) => checkPolylineHitsRect(line, box))) return { x, y };
  }
  return { x: preferred, y };
}

/** Place a self-loop label beside its loop, above or below it, whichever collides least. */
export function placeLoopLabel(start: Point, size: { width: number; height: number }, obstacles: LabelObstacles, ownLine: Point[]): Point {
  const candidates = [
    { x: start.x + size.width / 2, y: start.y },
    { x: start.x + size.width / 2 - 6, y: start.y - size.height - 2 },
    { x: start.x + size.width / 2 - 6, y: start.y + size.height + 2 },
  ];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const rect = { x: c.x - size.width / 2, y: c.y - size.height / 2, w: size.width, h: size.height };
    const score = countLabelCollisions(rect, obstacles, ownLine) - (checkPolylineHitsRect(ownLine, rect) ? 1 : 0);
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
