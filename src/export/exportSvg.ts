/** SVG export: serialize the current scene and trigger a download. */
import type { Scene } from "../canvas/scene";
import { renderSceneSvg } from "../render/svgMarkup";

export const EXPORT_FILENAME = "graph-shift.svg";

/** Build the standalone SVG document for the scene. */
export function createSvgExport(scene: Scene, title: string): string {
  return renderSceneSvg(scene, title || "graph");
}

/** Create a safe filename from the graph name. */
export function createExportFilename(graphName: string): string {
  const base = graphName.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return base ? `${base}.svg` : EXPORT_FILENAME;
}

/** Trigger a browser download of the SVG text. */
export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
