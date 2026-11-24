/**
 * Node shape geometry: outline paths and ray/boundary intersection for clipping edges.
 * All geometry is relative to the node center.
 */

export interface Point {
  x: number;
  y: number;
}

export type Outline =
  | { kind: "ellipse"; rx: number; ry: number }
  | { kind: "polygon"; points: Point[] }
  | { kind: "rect"; w: number; h: number; r: number };

type UnitPolygon = [number, number][];

const POLYGONS: Record<string, UnitPolygon> = {
  diamond: [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]],
  mdiamond: [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]],
  triangle: [[0, -0.5], [0.5, 0.5], [-0.5, 0.5]],
  invtriangle: [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]],
  hexagon: [[-0.5, 0], [-0.25, -0.5], [0.25, -0.5], [0.5, 0], [0.25, 0.5], [-0.25, 0.5]],
  octagon: [[-0.5, -0.2], [-0.2, -0.5], [0.2, -0.5], [0.5, -0.2], [0.5, 0.2], [0.2, 0.5], [-0.2, 0.5], [-0.5, 0.2]],
  doubleoctagon: [[-0.5, -0.2], [-0.2, -0.5], [0.2, -0.5], [0.5, -0.2], [0.5, 0.2], [0.2, 0.5], [-0.2, 0.5], [-0.5, 0.2]],
  tripleoctagon: [[-0.5, -0.2], [-0.2, -0.5], [0.2, -0.5], [0.5, -0.2], [0.5, 0.2], [0.2, 0.5], [-0.2, 0.5], [-0.5, 0.2]],
  pentagon: [[0, -0.5], [0.5, -0.12], [0.31, 0.5], [-0.31, 0.5], [-0.5, -0.12]],
  septagon: [[0, -0.5], [0.39, -0.31], [0.49, 0.11], [0.22, 0.45], [-0.22, 0.45], [-0.49, 0.11], [-0.39, -0.31]],
  parallelogram: [[-0.3, -0.5], [0.5, -0.5], [0.3, 0.5], [-0.5, 0.5]],
  trapezium: [[-0.3, -0.5], [0.3, -0.5], [0.5, 0.5], [-0.5, 0.5]],
  invtrapezium: [[-0.5, -0.5], [0.5, -0.5], [0.3, 0.5], [-0.3, 0.5]],
  house: [[0, -0.5], [0.5, -0.1], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.1]],
  invhouse: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.1], [0, 0.5], [-0.5, 0.1]],
  rarrow: [[-0.5, -0.3], [0.2, -0.3], [0.2, -0.5], [0.5, 0], [0.2, 0.5], [0.2, 0.3], [-0.5, 0.3]],
  larrow: [[0.5, -0.3], [-0.2, -0.3], [-0.2, -0.5], [-0.5, 0], [-0.2, 0.5], [-0.2, 0.3], [0.5, 0.3]],
  cds: [[-0.5, -0.5], [0.3, -0.5], [0.5, 0], [0.3, 0.5], [-0.5, 0.5]],
  star: (() => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 0.5 : 0.21;
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r + 0.03]);
    }
    return pts;
  })(),
};

const ELLIPSES = new Set(["ellipse", "oval", "circle", "doublecircle", "mcircle", "egg", "point"]);

/** Shapes whose text box needs to be scaled to fit inside the outline. */
export const SHAPE_SCALE: Record<string, [number, number]> = {
  ellipse: [Math.SQRT2, Math.SQRT2],
  oval: [Math.SQRT2, Math.SQRT2],
  egg: [Math.SQRT2, Math.SQRT2],
  circle: [Math.SQRT2, Math.SQRT2],
  doublecircle: [Math.SQRT2, Math.SQRT2],
  mcircle: [Math.SQRT2, Math.SQRT2],
  diamond: [1.9, 1.9],
  mdiamond: [1.9, 1.9],
  triangle: [2, 1.7],
  invtriangle: [2, 1.7],
  hexagon: [1.35, 1.2],
  octagon: [1.3, 1.3],
  doubleoctagon: [1.3, 1.3],
  tripleoctagon: [1.3, 1.3],
  pentagon: [1.5, 1.4],
  septagon: [1.4, 1.4],
  parallelogram: [1.5, 1],
  trapezium: [1.5, 1],
  invtrapezium: [1.5, 1],
  house: [1.2, 1.5],
  invhouse: [1.2, 1.5],
  star: [2.6, 2.6],
  rarrow: [1.5, 1.6],
  larrow: [1.5, 1.6],
  cds: [1.3, 1],
  cylinder: [1, 1.35],
};

/** Shapes with a fixed 1:1 aspect ratio. */
export const SQUARE_SHAPES = new Set(["circle", "doublecircle", "mcircle", "square", "msquare", "point", "star"]);

/** Build the clipping outline for a shape of the given size. */
export function createOutline(shape: string, w: number, h: number, rounded: boolean): Outline {
  if (ELLIPSES.has(shape)) return { kind: "ellipse", rx: w / 2, ry: h / 2 };
  const unit = POLYGONS[shape];
  if (unit) return { kind: "polygon", points: unit.map(([x, y]) => ({ x: x * w, y: y * h })) };
  return { kind: "rect", w, h, r: rounded || shape === "mrecord" ? Math.min(10, h / 4, w / 4) : 0 };
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** Create an SVG path for an outline, optionally grown by `inset` (for peripheries). */
export function createOutlinePath(outline: Outline, grow = 0): string {
  const f = formatNumber;
  if (outline.kind === "ellipse") {
    const rx = outline.rx + grow;
    const ry = outline.ry + grow;
    return `M${f(-rx)} 0A${f(rx)} ${f(ry)} 0 1 0 ${f(rx)} 0A${f(rx)} ${f(ry)} 0 1 0 ${f(-rx)} 0Z`;
  }
  if (outline.kind === "rect") {
    const w = outline.w / 2 + grow;
    const h = outline.h / 2 + grow;
    const r = outline.r ? outline.r + grow : 0;
    if (!r) return `M${f(-w)} ${f(-h)}H${f(w)}V${f(h)}H${f(-w)}Z`;
    return (
      `M${f(-w + r)} ${f(-h)}H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(-h + r)}` +
      `V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(-w + r)}` +
      `A${f(r)} ${f(r)} 0 0 1 ${f(-w)} ${f(h - r)}V${f(-h + r)}A${f(r)} ${f(r)} 0 0 1 ${f(-w + r)} ${f(-h)}Z`
    );
  }
  const points = grow ? growPolygon(outline.points, grow) : outline.points;
  return `M${points.map((p) => `${f(p.x)} ${f(p.y)}`).join("L")}Z`;
}

function growPolygon(points: Point[], grow: number): Point[] {
  // Scale around the center so the outline grows by roughly `grow` px.
  let maxR = 0;
  for (const p of points) maxR = Math.max(maxR, Math.hypot(p.x, p.y));
  const s = maxR ? (maxR + grow) / maxR : 1;
  return points.map((p) => ({ x: p.x * s, y: p.y * s }));
}

/** Decorative strokes for compound shapes (cylinder, note, tab, folder, component, box3d). */
export function createShapeDecorations(shape: string, w: number, h: number): { outline?: string; details: string[] } {
  const f = formatNumber;
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  switch (shape) {
    case "cylinder": {
      const ry = Math.min(8, h / 6);
      return {
        outline: `M${f(x0)} ${f(y0 + ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${f(x1)} ${f(y0 + ry)}V${f(y1 - ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${f(x0)} ${f(y1 - ry)}Z`,
        details: [`M${f(x0)} ${f(y0 + ry)}A${f(w / 2)} ${f(ry)} 0 0 0 ${f(x1)} ${f(y0 + ry)}`],
      };
    }
    case "note": {
      const c = Math.min(10, h / 3);
      return {
        outline: `M${f(x0)} ${f(y0)}H${f(x1 - c)}L${f(x1)} ${f(y0 + c)}V${f(y1)}H${f(x0)}Z`,
        details: [`M${f(x1 - c)} ${f(y0)}V${f(y0 + c)}H${f(x1)}`],
      };
    }
    case "tab": {
      const tw = Math.min(16, w / 4);
      const th = Math.min(6, h / 5);
      return {
        outline: `M${f(x0)} ${f(y0)}H${f(x0 + tw)}V${f(y0 + th)}H${f(x1)}V${f(y1)}H${f(x0)}Z`,
        details: [`M${f(x0)} ${f(y0 + th)}H${f(x0 + tw)}`],
      };
    }
    case "folder": {
      const th = Math.min(6, h / 5);
      return {
        outline: `M${f(x0)} ${f(y0 + th)}L${f(x0 + 4)} ${f(y0)}H${f(x0 + w * 0.35)}L${f(x0 + w * 0.35 + 4)} ${f(y0 + th)}H${f(x1)}V${f(y1)}H${f(x0)}Z`,
        details: [],
      };
    }
    case "component": {
      const bw = 8;
      const bh = Math.min(6, h / 6);
      return {
        details: [
          `M${f(x0 - bw / 2)} ${f(y0 + h * 0.25 - bh / 2)}h${bw}v${f(bh)}h${-bw}Z`,
          `M${f(x0 - bw / 2)} ${f(y0 + h * 0.75 - bh / 2)}h${bw}v${f(bh)}h${-bw}Z`,
        ],
      };
    }
    case "box3d": {
      const d = 5;
      return {
        details: [`M${f(x0)} ${f(y0)}l${d} ${-d}H${f(x1 + d)}V${f(y1 - d)}l${-d} ${d}M${f(x1)} ${f(y0)}l${d} ${-d}`],
      };
    }
    case "msquare":
    case "mdiamond":
    case "mcircle":
      return { details: [] };
    case "underline":
      return { details: [`M${f(x0)} ${f(y1)}H${f(x1)}`] };
    default:
      return { details: [] };
  }
}

/**
 * Find where the ray from the center towards `toward` (both relative to the center)
 * leaves the outline. Returns a point relative to the center.
 */
export function intersectOutline(outline: Outline, toward: Point): Point {
  const len = Math.hypot(toward.x, toward.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  const dx = toward.x / len;
  const dy = toward.y / len;
  if (outline.kind === "ellipse") {
    const { rx, ry } = outline;
    if (rx <= 0 || ry <= 0) return { x: 0, y: 0 };
    const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    return { x: dx * t, y: dy * t };
  }
  const points =
    outline.kind === "rect"
      ? [
          { x: -outline.w / 2, y: -outline.h / 2 },
          { x: outline.w / 2, y: -outline.h / 2 },
          { x: outline.w / 2, y: outline.h / 2 },
          { x: -outline.w / 2, y: outline.h / 2 },
        ]
      : outline.points;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const t = intersectRaySegment(dx, dy, a, b);
    if (t !== null && t < best) best = t;
  }
  if (!Number.isFinite(best)) return { x: 0, y: 0 };
  return { x: dx * best, y: dy * best };
}

function intersectRaySegment(dx: number, dy: number, a: Point, b: Point): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-12) return null;
  const t = (a.x * ey - a.y * ex) / denom;
  const u = (a.x * dy - a.y * dx) / denom;
  if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}
