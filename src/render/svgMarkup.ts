/**
 * SVG markup for scene primitives. Used both by the interactive canvas (as
 * inner markup of positioned groups) and by the standalone SVG export.
 */
import type { ClusterPrim, EdgePrim, GraphLabelPrim, Scene } from "../canvas/scene";
import { LINE_HEIGHT_FACTOR } from "./text";
import { THEME, type NodeVisual, type TextBlock } from "./visuals";

/** Escape text for XML content and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const n = (value: number): string => (Math.round(value * 100) / 100).toString();

function formatFontAttributes(block: TextBlock): string {
  const parts = [`font-family="${escapeXml(block.font.family)}"`, `font-size="${n(block.font.size)}"`];
  if ((block.font.weight ?? 400) !== 400) parts.push(`font-weight="${block.font.weight}"`);
  if (block.font.italic) parts.push(`font-style="italic"`);
  return parts.join(" ");
}

/**
 * Render a text block centered on (cx, cy), or starting at cx when align is "start".
 * Baselines are computed explicitly so all SVG renderers agree.
 */
export function renderTextBlockMarkup(
  block: TextBlock,
  cx: number,
  cy: number,
  options: { align?: "center" | "start"; halo?: string | null } = {},
): string {
  if (!block.lines.length) return "";
  const lineHeight = block.font.size * LINE_HEIGHT_FACTOR;
  const top = cy - (block.lines.length * lineHeight) / 2;
  const left = options.align === "start" ? cx : cx - block.width / 2;
  const right = left + block.width;
  const center = left + block.width / 2;
  const halo = options.halo
    ? ` stroke="${escapeXml(options.halo)}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`
    : "";
  const out: string[] = [];
  block.lines.forEach((line, i) => {
    if (!line.text) return;
    const baseline = top + lineHeight * (i + 0.5) + block.font.size * 0.35;
    let x = center;
    let anchor = "middle";
    if (line.align === "left") {
      x = left;
      anchor = "start";
    } else if (line.align === "right") {
      x = right;
      anchor = "end";
    } else if (options.align === "start" && block.lines.length === 1) {
      x = left;
      anchor = "start";
    }
    out.push(
      `<text x="${n(x)}" y="${n(baseline)}" text-anchor="${anchor}" ${formatFontAttributes(block)} fill="${escapeXml(block.color)}"${halo}>${escapeXml(line.text)}</text>`,
    );
  });
  return out.join("");
}

/** Render a node in local coordinates (centered at 0,0). */
export function renderNodeMarkup(visual: NodeVisual): string {
  if (visual.invisible) return "";
  const parts: string[] = [];
  const stroke = escapeXml(visual.stroke);
  const dash = visual.dash ? ` stroke-dasharray="${visual.dash}"` : "";
  const fill = escapeXml(visual.fill);
  if (visual.shape === "point") {
    const r = visual.width / 2;
    parts.push(`<circle r="${n(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(visual.strokeWidth)}"/>`);
    return parts.join("");
  }
  visual.outlinePaths.forEach((d, i) => {
    parts.push(
      `<path d="${d}" fill="${i === 0 ? fill : "none"}" stroke="${stroke}" stroke-width="${n(visual.strokeWidth)}"${dash} stroke-linejoin="round"/>`,
    );
  });
  if (!visual.outlinePaths.length && visual.fill !== "none") {
    parts.push(`<rect x="${n(-visual.width / 2)}" y="${n(-visual.height / 2)}" width="${n(visual.width)}" height="${n(visual.height)}" fill="${fill}"/>`);
  }
  for (const d of visual.detailPaths) {
    parts.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${n(visual.strokeWidth)}"${dash}/>`);
  }
  if (visual.recordCells) {
    for (const cell of visual.recordCells) {
      parts.push(renderTextBlockMarkup({ ...visual.label, lines: cell.lines, width: cell.w - 16 }, cell.x + cell.w / 2, cell.y + cell.h / 2));
    }
  } else {
    // Text in shapes like triangles sits slightly lower.
    const offset =
      visual.shape === "triangle"
        ? visual.height * 0.12
        : visual.shape === "invtriangle"
          ? -visual.height * 0.12
          : visual.shape === "cylinder"
            ? Math.min(8, visual.height / 6) / 2
            : 0;
    parts.push(renderTextBlockMarkup(visual.label, 0, offset));
  }
  return parts.join("");
}

/** Render an edge in absolute coordinates. */
export function renderEdgeMarkup(prim: EdgePrim, halo: string | null): string {
  const { visual, geometry } = prim;
  if (visual.invisible) return "";
  const color = escapeXml(visual.color);
  const dash = visual.dash ? ` stroke-dasharray="${visual.dash}"` : "";
  const parts = [
    `<path d="${geometry.path}" fill="none" stroke="${color}" stroke-width="${n(visual.strokeWidth)}"${dash} stroke-linecap="round"/>`,
  ];
  for (const arrow of [geometry.headArrow, geometry.tailArrow]) {
    if (!arrow) continue;
    parts.push(
      arrow.filled
        ? `<path d="${arrow.d}" fill="${color}" stroke="${color}" stroke-width="${n(Math.min(1, visual.strokeWidth))}" stroke-linejoin="round"/>`
        : `<path d="${arrow.d}" fill="${escapeXml(halo ?? THEME.paper)}" stroke="${color}" stroke-width="${n(visual.strokeWidth)}" stroke-linejoin="round"/>`,
    );
  }
  if (visual.label) {
    const at = prim.labelAt ?? geometry.labelAnchor;
    parts.push(renderTextBlockMarkup(visual.label, at.x, at.y, { align: prim.labelAt ? "center" : geometry.labelAlign, halo }));
  }
  if (visual.headLabel) parts.push(renderTextBlockMarkup(visual.headLabel, geometry.headLabelAnchor.x, geometry.headLabelAnchor.y, { halo }));
  if (visual.tailLabel) parts.push(renderTextBlockMarkup(visual.tailLabel, geometry.tailLabelAnchor.x, geometry.tailLabelAnchor.y, { halo }));
  return parts.join("");
}

/** Render a cluster box (labels are drawn separately, above the edges). */
export function renderClusterMarkup(prim: ClusterPrim): string {
  const { visual, rect } = prim;
  if (visual.invisible) return "";
  const dash = visual.dash ? ` stroke-dasharray="${visual.dash}"` : "";
  const r = visual.rounded ? 6 : 0;
  return `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" rx="${r}" fill="${escapeXml(visual.fill)}" stroke="${escapeXml(visual.stroke)}" stroke-width="${n(visual.strokeWidth)}"${dash}/>`;
}

/** Render a cluster label with a halo so edges passing underneath stay readable. */
export function renderClusterLabelMarkup(prim: ClusterPrim, paper: string): string {
  const { visual, rect } = prim;
  if (visual.invisible || !visual.label) return "";
  const label = visual.label;
  const fallbackY = visual.labelLoc === "t" ? rect.y + 10 + label.height / 2 : rect.y + rect.h - 10 - label.height / 2;
  const fallbackX =
    visual.labelJust === "r" ? rect.x + rect.w - 10 - label.width / 2 : visual.labelJust === "c" ? rect.x + rect.w / 2 : rect.x + 10 + label.width / 2;
  const { x, y } = prim.labelAt ?? { x: fallbackX, y: fallbackY };
  const halo = visual.fill !== "none" ? visual.fill : paper;
  return renderTextBlockMarkup(label, x, y, { halo });
}

export function renderGraphLabelMarkup(prim: GraphLabelPrim): string {
  return renderTextBlockMarkup(prim.block, prim.x, prim.y);
}

export const EXPORT_MARGIN = 16;

/** Serialize a whole scene as a standalone SVG document (no UI overlays). */
export function renderSceneSvg(scene: Scene, title = "graph"): string {
  const b = scene.bounds;
  const x = b.x - EXPORT_MARGIN;
  const y = b.y - EXPORT_MARGIN;
  const w = Math.max(1, b.w + EXPORT_MARGIN * 2);
  const h = Math.max(1, b.h + EXPORT_MARGIN * 2);
  const halo = scene.background ?? THEME.paper;
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${escapeXml(scene.background ?? THEME.paper)}"/>`,
    `<g class="clusters">${scene.clusters.map(renderClusterMarkup).join("")}</g>`,
    `<g class="edges">${scene.edges.map((e) => `<g class="edge">${renderEdgeMarkup(e, halo)}</g>`).join("")}</g>`,
    `<g class="cluster-labels">${scene.clusters.map((c) => renderClusterLabelMarkup(c, halo)).join("")}</g>`,
    `<g class="nodes">${scene.nodes
      .map((node) => `<g class="node" transform="translate(${n(node.x)} ${n(node.y)})">${renderNodeMarkup(node.visual)}</g>`)
      .join("")}</g>`,
  ];
  if (scene.graphLabel) parts.push(renderGraphLabelMarkup(scene.graphLabel));
  parts.push(`</svg>`);
  return parts.join("\n");
}
