/**
 * Label text handling: DOT escape sequences, HTML labels and text measurement.
 */

export interface FontSpec {
  family: string;
  size: number;
  weight?: number;
  italic?: boolean;
}

export interface TextLine {
  text: string;
  align: "left" | "center" | "right";
}

export type MeasureTextFunction = (text: string, font: FontSpec) => number;

/** Default font stack used for graph labels (on screen and in exported SVG). */
export const GRAPH_FONT_FAMILY = "'Inter Variable', Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const LINE_HEIGHT_FACTOR = 1.25;

/** Map Graphviz/PostScript font names to CSS font stacks. */
export function resolveFontFamily(fontname: string | undefined): string {
  if (!fontname) return GRAPH_FONT_FAMILY;
  const lower = fontname.toLowerCase();
  if (lower.startsWith("times")) return "'Times New Roman', Times, serif";
  if (lower.startsWith("courier") || lower.includes("mono")) return "'JetBrains Mono', 'Courier New', Courier, monospace";
  if (lower.startsWith("helvetica") || lower.startsWith("arial")) return "Helvetica, Arial, sans-serif";
  if (lower === "sans" || lower === "sans-serif") return GRAPH_FONT_FAMILY;
  if (lower === "serif") return "Georgia, serif";
  return `${fontname.replace(/[-_](bold|italic|oblique|roman).*$/i, "")}, ${GRAPH_FONT_FAMILY}`;
}

/** Check whether a Graphviz font name implies bold weight. */
export function checkBoldFont(fontname: string | undefined): boolean {
  return !!fontname && /bold/i.test(fontname);
}

let measureContext: CanvasRenderingContext2D | null | undefined;
const measureCache = new Map<string, number>();

/** Measure text width in px using a canvas when available, else a heuristic. */
export function measureTextWidth(text: string, font: FontSpec): number {
  if (!text) return 0;
  const fontString = `${font.italic ? "italic " : ""}${font.weight ?? 400} ${font.size}px ${font.family}`;
  const cacheKey = `${fontString}\u0000${text}`;
  const cached = measureCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (measureContext === undefined) {
    measureContext = null;
    if (typeof document !== "undefined") {
      try {
        measureContext = document.createElement("canvas").getContext("2d");
      } catch {
        measureContext = null;
      }
    }
  }
  let width: number;
  if (measureContext) {
    measureContext.font = fontString;
    width = measureContext.measureText(text).width;
  } else {
    width = estimateTextWidth(text, font);
  }
  if (measureCache.size > 5000) measureCache.clear();
  measureCache.set(cacheKey, width);
  return width;
}

/** Approximate text width without a canvas (used in tests and workers). */
export function estimateTextWidth(text: string, font: FontSpec): number {
  let units = 0;
  for (const ch of text) {
    if (/[il.,:;'|!]/.test(ch)) units += 0.28;
    else if (/[mwMW]/.test(ch)) units += 0.85;
    else if (/[A-Z]/.test(ch)) units += 0.66;
    else if (ch === " ") units += 0.28;
    else units += 0.55;
  }
  const weightFactor = (font.weight ?? 400) >= 600 ? 1.06 : 1;
  return units * font.size * weightFactor;
}

/** Context for expanding `\N`, `\G`, `\E`, `\T`, `\H` in labels. */
export interface LabelContext {
  nodeName?: string;
  graphName?: string;
  tail?: string;
  head?: string;
  directed?: boolean;
}

/** Decode the few HTML entities that appear in DOT HTML labels. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Convert an HTML-like label to plain lines (tables become rows of cells). */
export function convertHtmlLabelToLines(html: string): TextLine[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<\/td\s*>/gi, "  ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, i, all) => line.length > 0 || (i > 0 && i < all.length - 1))
    .map((line) => ({ text: line, align: "center" as const }));
}

/** Split a DOT escString label into lines honoring `\n`, `\l`, `\r` and placeholders. */
export function splitLabelLines(label: string, context: LabelContext = {}): TextLine[] {
  const lines: TextLine[] = [];
  let current = "";
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (ch === "\\" && i + 1 < label.length) {
      const next = label[i + 1];
      i++;
      switch (next) {
        case "n":
          lines.push({ text: current, align: "center" });
          current = "";
          break;
        case "l":
          lines.push({ text: current, align: "left" });
          current = "";
          break;
        case "r":
          lines.push({ text: current, align: "right" });
          current = "";
          break;
        case "N":
          current += context.nodeName ?? "";
          break;
        case "G":
          current += context.graphName ?? "";
          break;
        case "T":
          current += context.tail ?? "";
          break;
        case "H":
          current += context.head ?? "";
          break;
        case "E":
          current += `${context.tail ?? ""}${context.directed ? "->" : "--"}${context.head ?? ""}`;
          break;
        case "L":
          break;
        default:
          current += next;
      }
      continue;
    }
    if (ch === "\n") {
      lines.push({ text: current, align: "center" });
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || lines.length === 0) lines.push({ text: current, align: "center" });
  return lines;
}

/** Resolve a label attribute to lines of text. */
export function resolveLabelLines(
  raw: string | undefined,
  isHtml: boolean,
  fallback: string,
  context: LabelContext,
): TextLine[] {
  if (raw === undefined) return splitLabelLines(fallback, context);
  if (isHtml) return convertHtmlLabelToLines(raw);
  return splitLabelLines(raw, context);
}

/** Measure the bounding box of a block of lines. */
export function measureLines(
  lines: TextLine[],
  font: FontSpec,
  measure: MeasureTextFunction = measureTextWidth,
): { width: number; height: number } {
  const lineHeight = font.size * LINE_HEIGHT_FACTOR;
  let width = 0;
  for (const line of lines) width = Math.max(width, measure(line.text, font));
  const nonEmpty = lines.length === 1 && lines[0].text === "" ? 0 : lines.length;
  return { width, height: nonEmpty * lineHeight };
}
