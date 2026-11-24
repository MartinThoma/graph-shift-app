/**
 * Placement of new nodes while manual positions are locked: never move existing
 * nodes, find a free spot near the node's neighbors or the viewport center.
 */
import type { Point } from "../render/shapes";
import type { Size } from "./initialLayout";

export interface PlacementRequest {
  id: string;
  size: Size;
  /** Already-positioned neighbors (by edge), used as the preferred anchor. */
  neighbors: string[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARGIN = 24;

function checkOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x - a.w / 2 - MARGIN < b.x + b.w / 2 &&
    a.x + a.w / 2 + MARGIN > b.x - b.w / 2 &&
    a.y - a.h / 2 - MARGIN < b.y + b.h / 2 &&
    a.y + a.h / 2 + MARGIN > b.y - b.h / 2
  );
}

/**
 * Find a non-overlapping position for each new node. Existing positions are
 * treated as fixed obstacles; placed nodes become obstacles for later ones.
 */
export function placeNewNodes(
  requests: PlacementRequest[],
  positions: Record<string, Point>,
  sizes: Map<string, Size>,
  fallbackCenter: Point | null,
): Record<string, Point> {
  const obstacles: Rect[] = [];
  for (const [id, p] of Object.entries(positions)) {
    const s = sizes.get(id) ?? { width: 54, height: 36 };
    obstacles.push({ x: p.x, y: p.y, w: s.width, h: s.height });
  }
  const placed: Record<string, Point> = {};
  const lookup = (id: string): Point | undefined => placed[id] ?? positions[id];

  for (const request of requests) {
    const anchors = request.neighbors.map(lookup).filter((p): p is Point => !!p);
    let start: Point;
    if (anchors.length) {
      const cx = anchors.reduce((s, p) => s + p.x, 0) / anchors.length;
      const cy = anchors.reduce((s, p) => s + p.y, 0) / anchors.length;
      start = { x: cx, y: cy + (anchors.length === 1 ? request.size.height + 60 : 0) };
    } else if (fallbackCenter) {
      start = fallbackCenter;
    } else if (obstacles.length) {
      const maxX = Math.max(...obstacles.map((o) => o.x + o.w / 2));
      const minY = Math.min(...obstacles.map((o) => o.y - o.h / 2));
      start = { x: maxX + MARGIN + request.size.width / 2, y: minY + request.size.height / 2 };
    } else {
      start = { x: request.size.width / 2, y: request.size.height / 2 };
    }
    const spot = findFreeSpot(start, request.size, obstacles);
    placed[request.id] = spot;
    obstacles.push({ x: spot.x, y: spot.y, w: request.size.width, h: request.size.height });
  }
  return placed;
}

/** Search outward on a square spiral of grid steps for the first free spot. */
export function findFreeSpot(start: Point, size: Size, obstacles: Rect[]): Point {
  const stepX = Math.max(20, Math.round((size.width + MARGIN) / 2));
  const stepY = Math.max(20, Math.round((size.height + MARGIN) / 2));
  const fits = (p: Point): boolean => !obstacles.some((o) => checkOverlap({ x: p.x, y: p.y, w: size.width, h: size.height }, o));
  const origin = { x: Math.round(start.x), y: Math.round(start.y) };
  if (fits(origin)) return origin;
  for (let ring = 1; ring < 200; ring++) {
    const candidates: Point[] = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push({ x: origin.x + i * stepX, y: origin.y - ring * stepY });
      candidates.push({ x: origin.x + i * stepX, y: origin.y + ring * stepY });
      if (i !== -ring && i !== ring) {
        candidates.push({ x: origin.x - ring * stepX, y: origin.y + i * stepY });
        candidates.push({ x: origin.x + ring * stepX, y: origin.y + i * stepY });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
    for (const c of candidates) if (fits(c)) return c;
  }
  return origin;
}
