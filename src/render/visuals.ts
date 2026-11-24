/**
 * Resolve DOT attributes into concrete visual styles for nodes, edges and clusters.
 */
import type { ClusterInfo, EdgeInfo, GraphModel, NodeInfo } from "../dot/model";
import { resolveColor } from "./colors";
import {
  createOutline,
  createOutlinePath,
  createShapeDecorations,
  SHAPE_SCALE,
  SQUARE_SHAPES,
  type Outline,
} from "./shapes";
import {
  checkBoldFont,
  LINE_HEIGHT_FACTOR,
  measureLines,
  measureTextWidth,
  resolveFontFamily,
  resolveLabelLines,
  splitLabelLines,
  type FontSpec,
  type MeasureTextFunction,
  type TextLine,
} from "./text";

/** Theme defaults (the "Drafting Grid" ink-on-white look). */
export const THEME = {
  ink: "#1c1f23",
  inkMuted: "#5b6168",
  clusterStroke: "#8a9097",
  paper: "#ffffff",
  nodeFontSize: 14,
  edgeFontSize: 12,
  clusterFontSize: 13,
  penWidth: 1.1,
};

const POINTS_PER_INCH = 72;

export interface TextBlock {
  lines: TextLine[];
  font: FontSpec;
  color: string;
  width: number;
  height: number;
}

export interface RecordCell {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: TextLine[];
}

export interface NodeVisual {
  id: string;
  shape: string;
  width: number;
  height: number;
  outline: Outline;
  /** Outline paths (several for peripheries), relative to the center. */
  outlinePaths: string[];
  detailPaths: string[];
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: string | null;
  invisible: boolean;
  label: TextBlock;
  /** Record cells relative to the node's top-left corner. */
  recordCells: RecordCell[] | null;
  recordSeparators: string[];
  /** Raw DOT attributes (for tooltips etc.). */
  tooltip: string | null;
  url: string | null;
}

export interface EdgeVisual {
  key: string;
  color: string;
  strokeWidth: number;
  dash: string | null;
  invisible: boolean;
  arrowHead: string | null;
  arrowTail: string | null;
  arrowSize: number;
  label: TextBlock | null;
  headLabel: TextBlock | null;
  tailLabel: TextBlock | null;
}

export interface ClusterVisual {
  id: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: string | null;
  rounded: boolean;
  invisible: boolean;
  label: TextBlock | null;
  labelJust: "l" | "r" | "c";
  labelLoc: "t" | "b";
  depth: number;
}

export interface GraphVisual {
  background: string | null;
  label: TextBlock | null;
  labelLoc: "t" | "b";
  labelJust: "l" | "r" | "c";
  rankdir: "TB" | "LR" | "BT" | "RL";
}

/** Parse a DOT style attribute into flags. */
export function parseStyle(style: string | undefined): { flags: Set<string>; lineWidth: number | null } {
  const flags = new Set<string>();
  let lineWidth: number | null = null;
  if (!style) return { flags, lineWidth };
  for (const raw of style.split(",")) {
    const item = raw.trim().toLowerCase();
    const setWidth = /^setlinewidth\(([\d.]+)\)$/.exec(item);
    if (setWidth) lineWidth = Number(setWidth[1]);
    else if (item) flags.add(item);
  }
  return { flags, lineWidth };
}

function resolveDash(flags: Set<string>, strokeWidth: number): string | null {
  if (flags.has("dashed")) return `${Math.max(4, strokeWidth * 4)} ${Math.max(3, strokeWidth * 3)}`;
  if (flags.has("dotted")) return `${Math.max(1, strokeWidth)} ${Math.max(3, strokeWidth * 2.5)}`;
  return null;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function createFont(attrs: Record<string, string>, defaultSize: number): FontSpec {
  return {
    family: resolveFontFamily(attrs.fontname),
    size: Math.max(4, parseNumber(attrs.fontsize, defaultSize)),
    weight: checkBoldFont(attrs.fontname) ? 700 : 400,
    italic: /italic|oblique/i.test(attrs.fontname ?? ""),
  };
}

function createTextBlock(lines: TextLine[], font: FontSpec, color: string, measure: MeasureTextFunction): TextBlock {
  const { width, height } = measureLines(lines, font, measure);
  return { lines, font, color, width, height };
}

/* ------------------------------------------------------------------------ */
/* Record labels                                                             */
/* ------------------------------------------------------------------------ */

interface RecordField {
  text: string | null;
  children: RecordField[];
}

/** Parse a record label like `{a|<p>b}|c` into a field tree. */
export function parseRecordLabel(label: string): RecordField {
  let i = 0;
  const parseFields = (): RecordField[] => {
    const fields: RecordField[] = [];
    let text = "";
    let nested: RecordField | null = null;
    const push = (): void => {
      if (nested) fields.push(nested);
      else fields.push({ text: text.replace(/^\s*<[^>]*>\s*/, "").trim(), children: [] });
      text = "";
      nested = null;
    };
    while (i < label.length) {
      const ch = label[i];
      if (ch === "\\" && i + 1 < label.length && "{}|<> ".includes(label[i + 1])) {
        text += label[i + 1];
        i += 2;
        continue;
      }
      if (ch === "{") {
        i++;
        nested = { text: null, children: parseFields() };
        continue;
      }
      if (ch === "}") {
        i++;
        push();
        return fields;
      }
      if (ch === "|") {
        i++;
        push();
        continue;
      }
      text += ch;
      i++;
    }
    push();
    return fields;
  };
  return { text: null, children: parseFields() };
}

function layoutRecord(
  root: RecordField,
  horizontal: boolean,
  font: FontSpec,
  measure: MeasureTextFunction,
  context: { nodeName: string },
): { width: number; height: number; place: (x: number, y: number, w: number, h: number) => { cells: RecordCell[]; seps: string[] } } {
  const padX = 8;
  const padY = 4;
  const lineHeight = font.size * LINE_HEIGHT_FACTOR;

  interface Sized {
    field: RecordField;
    w: number;
    h: number;
    horizontal: boolean;
    children: Sized[];
    lines: TextLine[];
  }

  const size = (field: RecordField, isHorizontal: boolean): Sized => {
    if (field.text !== null) {
      const lines = splitLabelLines(field.text, context);
      const m = measureLines(lines, font, measure);
      return {
        field,
        w: m.width + padX * 2,
        h: Math.max(lineHeight, m.height) + padY * 2,
        horizontal: isHorizontal,
        children: [],
        lines,
      };
    }
    const children = field.children.map((c) => size(c, !isHorizontal));
    const w = isHorizontal ? children.reduce((s, c) => s + c.w, 0) : Math.max(0, ...children.map((c) => c.w));
    const h = isHorizontal ? Math.max(0, ...children.map((c) => c.h)) : children.reduce((s, c) => s + c.h, 0);
    return { field, w, h, horizontal: isHorizontal, children, lines: [] };
  };

  const sized = size(root, horizontal);
  const place = (x: number, y: number, w: number, h: number): { cells: RecordCell[]; seps: string[] } => {
    const cells: RecordCell[] = [];
    const seps: string[] = [];
    const visit = (node: Sized, nx: number, ny: number, nw: number, nh: number): void => {
      if (!node.children.length) {
        cells.push({ x: nx, y: ny, w: nw, h: nh, lines: node.lines });
        return;
      }
      const total = node.horizontal ? node.children.reduce((s, c) => s + c.w, 0) : node.children.reduce((s, c) => s + c.h, 0);
      let offset = 0;
      node.children.forEach((child, index) => {
        const share = total > 0 ? (node.horizontal ? child.w : child.h) / total : 1 / node.children.length;
        if (node.horizontal) {
          const cw = nw * share;
          visit(child, nx + offset, ny, cw, nh);
          offset += cw;
          if (index < node.children.length - 1) seps.push(`M${(nx + offset).toFixed(2)} ${ny.toFixed(2)}V${(ny + nh).toFixed(2)}`);
        } else {
          const ch = nh * share;
          visit(child, nx, ny + offset, nw, ch);
          offset += ch;
          if (index < node.children.length - 1) seps.push(`M${nx.toFixed(2)} ${(ny + offset).toFixed(2)}H${(nx + nw).toFixed(2)}`);
        }
      });
    };
    visit(sized, x, y, w, h);
    return { cells, seps };
  };
  return { width: sized.w, height: sized.h, place };
}

/* ------------------------------------------------------------------------ */
/* Nodes                                                                     */
/* ------------------------------------------------------------------------ */

/** Resolve a node's visual style and size from its DOT attributes. */
export function computeNodeVisual(
  node: NodeInfo,
  model: GraphModel,
  measure: MeasureTextFunction = measureTextWidth,
): NodeVisual {
  const a = node.attrs;
  const shape = (a.shape ?? "ellipse").toLowerCase();
  const { flags, lineWidth } = parseStyle(a.style);
  const invisible = flags.has("invis");
  const filled = flags.has("filled") || flags.has("radial") || flags.has("striped") || flags.has("wedged");
  const background = resolveColor(model.graphAttrs.bgcolor);
  const color = resolveColor(a.color);
  const strokeBase = color ?? THEME.ink;
  let fill = background && background !== "none" ? background : THEME.paper;
  if (filled) fill = resolveColor(a.fillcolor) ?? color ?? "#d3d3d3";
  let strokeWidth = parseNumber(a.penwidth, lineWidth ?? THEME.penWidth);
  if (flags.has("bold")) strokeWidth = Math.max(strokeWidth, 2);
  const font = createFont(a, THEME.nodeFontSize);
  const fontColor = resolveColor(a.fontcolor) ?? THEME.ink;
  const isHtml = node.htmlKeys.includes("label");
  const rankdir = (model.graphAttrs.rankdir ?? "TB").toUpperCase();

  const isRecord = (shape === "record" || shape === "mrecord") && !isHtml;
  const isPoint = shape === "point";
  const isPlain = shape === "plain" || shape === "plaintext" || shape === "none" || shape === "underline";
  const lines = isPoint ? [] : resolveLabelLines(a.label, isHtml, "\\N", { nodeName: node.id, graphName: model.name });
  const label = createTextBlock(lines, font, fontColor, measure);

  const minWidth = a.width !== undefined ? parseNumber(a.width, 0.75) * POINTS_PER_INCH : shape === "plain" ? 0 : 54;
  const minHeight = a.height !== undefined ? parseNumber(a.height, 0.5) * POINTS_PER_INCH : shape === "plain" ? 0 : 36;
  const fixed = (a.fixedsize ?? "").toLowerCase() === "true" || a.fixedsize === "shape";
  const margin = shape === "plain" ? [0, 0] : [10, 5];

  let width: number;
  let height: number;
  let recordCells: RecordCell[] | null = null;
  let recordSeparators: string[] = [];
  let record: ReturnType<typeof layoutRecord> | null = null;

  if (isPoint) {
    const size = a.width !== undefined || a.height !== undefined ? Math.max(minWidth, minHeight) : 8;
    width = height = size;
    if (!filled) fill = color ?? THEME.ink;
  } else if (isRecord) {
    record = layoutRecord(
      parseRecordLabel(a.label ?? "\\N"),
      !(rankdir === "LR" || rankdir === "RL"),
      font,
      measure,
      { nodeName: node.id },
    );
    width = fixed ? minWidth : Math.max(minWidth, record.width);
    height = fixed ? minHeight : Math.max(minHeight, record.height);
  } else {
    const [sx, sy] = SHAPE_SCALE[shape] ?? [1, 1];
    const innerW = label.width + margin[0] * 2;
    const innerH = Math.max(label.height, label.lines.length ? 0 : 0) + margin[1] * 2;
    width = fixed ? minWidth : Math.max(minWidth, innerW * sx);
    height = fixed ? minHeight : Math.max(minHeight, innerH * sy);
    if (SQUARE_SHAPES.has(shape)) {
      const size = Math.max(width, height);
      width = height = size;
    }
  }
  if (shape === "square" || shape === "msquare") {
    const size = Math.max(width, height);
    width = height = size;
  }

  const rounded = flags.has("rounded") || shape === "mrecord";
  const outline = createOutline(shape, width, height, rounded);
  const decorations = createShapeDecorations(shape, width, height);
  const peripheries = isPlain
    ? 0
    : Math.max(0, Math.round(parseNumber(a.peripheries, shape === "doublecircle" || shape === "doubleoctagon" ? 2 : shape === "tripleoctagon" ? 3 : 1)));

  const outlinePaths: string[] = [];
  if (peripheries > 0) {
    outlinePaths.push(decorations.outline ?? createOutlinePath(outline));
    for (let i = 1; i < peripheries; i++) outlinePaths.push(createOutlinePath(outline, i * 4));
  } else if (shape === "plaintext" || shape === "none" || shape === "plain" || shape === "underline") {
    // no outline
  }
  if (record) {
    const placed = record.place(-width / 2, -height / 2, width, height);
    recordCells = placed.cells;
    recordSeparators = placed.seps;
  }

  return {
    id: node.id,
    shape,
    width,
    height,
    outline,
    outlinePaths,
    detailPaths: [...decorations.details, ...recordSeparators],
    fill: isPlain && !filled ? "none" : fill,
    stroke: strokeBase,
    strokeWidth,
    dash: resolveDash(flags, strokeWidth),
    invisible,
    label,
    recordCells,
    recordSeparators,
    tooltip: a.tooltip ?? null,
    url: a.URL ?? a.href ?? null,
  };
}

/* ------------------------------------------------------------------------ */
/* Edges                                                                     */
/* ------------------------------------------------------------------------ */

/** Resolve an edge's visual style from its DOT attributes. */
export function computeEdgeVisual(
  edge: EdgeInfo,
  model: GraphModel,
  measure: MeasureTextFunction = measureTextWidth,
): EdgeVisual {
  const a = edge.attrs;
  const { flags, lineWidth } = parseStyle(a.style);
  let strokeWidth = parseNumber(a.penwidth, lineWidth ?? THEME.penWidth);
  if (flags.has("bold")) strokeWidth = Math.max(strokeWidth, 2);
  const color = resolveColor(a.color) ?? THEME.ink;
  const dir = (a.dir ?? (model.directed ? "forward" : "none")).toLowerCase();
  const head = (a.arrowhead ?? "normal").toLowerCase();
  const tail = (a.arrowtail ?? "normal").toLowerCase();
  const font = createFont(a, THEME.edgeFontSize);
  const fontColor = resolveColor(a.fontcolor) ?? THEME.inkMuted;
  const context = { tail: edge.tail, head: edge.head, directed: model.directed, graphName: model.name };
  const makeLabel = (key: string): TextBlock | null => {
    const raw = a[key];
    if (raw === undefined || raw === "") return null;
    const lines = resolveLabelLines(raw, edge.htmlKeys.includes(key), "", context);
    return createTextBlock(lines, font, fontColor, measure);
  };
  return {
    key: edge.key,
    color,
    strokeWidth,
    dash: resolveDash(flags, strokeWidth),
    invisible: flags.has("invis"),
    arrowHead: (dir === "forward" || dir === "both") && head !== "none" ? head : null,
    arrowTail: (dir === "back" || dir === "both") && tail !== "none" ? tail : null,
    arrowSize: Math.max(0.2, parseNumber(a.arrowsize, 1)),
    label: makeLabel("label") ?? makeLabel("xlabel"),
    headLabel: makeLabel("headlabel"),
    tailLabel: makeLabel("taillabel"),
  };
}

/* ------------------------------------------------------------------------ */
/* Clusters and graph                                                        */
/* ------------------------------------------------------------------------ */

/** Resolve a cluster's visual style. */
export function computeClusterVisual(
  cluster: ClusterInfo,
  model: GraphModel,
  measure: MeasureTextFunction = measureTextWidth,
): ClusterVisual {
  const a = { ...pickInheritedGraphAttrs(model.graphAttrs), ...cluster.attrs };
  const { flags, lineWidth } = parseStyle(a.style);
  const color = resolveColor(a.color);
  const pen = resolveColor(a.pencolor) ?? color ?? THEME.clusterStroke;
  let fill = resolveColor(a.bgcolor) ?? "none";
  if (flags.has("filled")) fill = resolveColor(a.fillcolor) ?? color ?? resolveColor(a.bgcolor) ?? "#d3d3d3";
  let strokeWidth = parseNumber(a.penwidth, lineWidth ?? 1);
  if (flags.has("bold")) strokeWidth = Math.max(strokeWidth, 2);
  const font = createFont(a, THEME.clusterFontSize);
  const fontColor = resolveColor(a.fontcolor) ?? THEME.inkMuted;
  const raw = cluster.attrs.label;
  const label =
    raw !== undefined && raw !== ""
      ? createTextBlock(
          resolveLabelLines(raw, cluster.htmlKeys.includes("label"), "", { graphName: cluster.id }),
          { ...font, weight: 600 },
          fontColor,
          measure,
        )
      : null;
  return {
    id: cluster.id,
    stroke: pen,
    fill,
    strokeWidth,
    dash: resolveDash(flags, strokeWidth),
    rounded: flags.has("rounded") || !a.style,
    invisible: flags.has("invis"),
    label,
    labelJust: ((a.labeljust ?? "l").toLowerCase()[0] as "l" | "r" | "c") || "l",
    labelLoc: (a.labelloc ?? "t").toLowerCase().startsWith("b") ? "b" : "t",
    depth: cluster.depth,
  };
}

function pickInheritedGraphAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["fontname", "fontsize", "fontcolor", "labeljust", "labelloc"]) {
    if (attrs[key] !== undefined) out[key] = attrs[key];
  }
  return out;
}

/** Resolve graph-level visual attributes. */
export function computeGraphVisual(model: GraphModel, measure: MeasureTextFunction = measureTextWidth): GraphVisual {
  const a = model.graphAttrs;
  const background = resolveColor(a.bgcolor);
  const font = createFont(a, 16);
  const raw = a.label;
  const label =
    raw !== undefined && raw !== ""
      ? createTextBlock(
          resolveLabelLines(raw, model.graphHtmlKeys.includes("label"), "", { graphName: model.name }),
          { ...font, weight: 600 },
          resolveColor(a.fontcolor) ?? THEME.ink,
          measure,
        )
      : null;
  const rankdir = (a.rankdir ?? "TB").toUpperCase();
  return {
    background: background && background !== "none" ? background : null,
    label,
    labelLoc: (a.labelloc ?? "b").toLowerCase().startsWith("t") ? "t" : "b",
    labelJust: ((a.labeljust ?? "c").toLowerCase()[0] as "l" | "r" | "c") || "c",
    rankdir: (["TB", "LR", "BT", "RL"].includes(rankdir) ? rankdir : "TB") as GraphVisual["rankdir"],
  };
}
