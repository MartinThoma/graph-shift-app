import { useEffect, useMemo, useState } from "react";
import type { GraphModel } from "../dot/model";
import { resolveColor } from "../render/colors";
import { parseStyle, THEME } from "../render/visuals";
import { CloseIcon } from "./icons";

/** Soft fills that keep ink text readable. */
export const FILL_PRESETS = ["#ffffff", "#f1f3f5", "#fff3bf", "#ffe8cc", "#ffe3e3", "#f3d9fa", "#e5dbff", "#d0ebff", "#c5f6fa", "#d3f9d8"];
/** Strong colors for text and borders. */
export const INK_PRESETS = ["#1c1f23", "#5b6168", "#c92a2a", "#d9480f", "#e67700", "#2b8a3e", "#0b7285", "#1864ab", "#5f3dc4", "#a61e4d"];

const COLOR_KEYS = ["color", "fillcolor", "fontcolor", "bgcolor", "pencolor"];

/** Every distinct color used in the graph (nodes, edges, clusters, graph), as #rrggbb. */
export function collectGraphColors(model: GraphModel): string[] {
  const values: string[] = [];
  const add = (attrs: Record<string, string>): void => {
    for (const key of COLOR_KEYS) if (attrs[key] !== undefined) values.push(attrs[key]);
  };
  add(model.graphAttrs);
  for (const node of model.nodes.values()) add(node.attrs);
  for (const edge of model.edges) add(edge.attrs);
  for (const cluster of model.clusters.values()) add(cluster.attrs);
  const out: string[] = [];
  for (const value of values) {
    const hex = convertColorToHex(resolveColor(value), "");
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

interface ColorFieldProps {
  label: string;
  value: string;
  presets: string[];
  used: string[];
  open: boolean;
  onToggle: () => void;
  onPick: (hex: string) => void;
  resetLabel: string;
  resetDisabled: boolean;
  onReset: () => void;
}

/** A color row: current swatch (opens a palette), reset button, and an inline palette. */
function ColorField({ label, value, presets, used, open, onToggle, onPick, resetLabel, resetDisabled, onReset }: ColorFieldProps) {
  const extra = used.filter((c) => !presets.includes(c)).slice(0, 20);
  const renderSwatch = (hex: string) => (
    <button
      key={hex}
      type="button"
      className="swatch"
      style={{ background: hex }}
      aria-pressed={hex === value}
      aria-label={`${label} ${hex}`}
      title={hex}
      onClick={() => onPick(hex)}
    />
  );
  return (
    <div className="color-field">
      <div className="color-row">
        <span>{label}</span>
        <button
          type="button"
          className="swatch-button"
          aria-label={`${label} color`}
          aria-expanded={open}
          title={`${label}: ${value}`}
          onClick={onToggle}
        >
          <span style={{ background: value }} />
        </button>
        <button type="button" className="btn" disabled={resetDisabled} onClick={onReset}>
          {resetLabel}
        </button>
      </div>
      {open && (
        <div className="palette" role="group" aria-label={`${label} colors`}>
          <span className="palette-title">Typical</span>
          <div className="swatches">{presets.map(renderSwatch)}</div>
          {extra.length > 0 && (
            <>
              <span className="palette-title">In this graph</span>
              <div className="swatches">{extra.map(renderSwatch)}</div>
            </>
          )}
          <label className="custom-color">
            <span className="palette-title">Custom</span>
            <input type="color" aria-label={`Custom ${label.toLowerCase()} color`} value={value} onChange={(e) => onPick(e.target.value)} />
            <code>{value}</code>
          </label>
        </div>
      )}
    </div>
  );
}

const SHAPES = ["box", "ellipse", "circle", "diamond", "cylinder", "note", "hexagon", "parallelogram", "component", "folder", "plaintext", "point"];

type Changes = Record<string, string | null>;

interface NodeInspectorProps {
  model: GraphModel;
  ids: string[];
  onChange: (changes: Changes) => void;
  onClose: () => void;
}

let colorContext: CanvasRenderingContext2D | null | undefined;

/** Convert any CSS color to #rrggbb for <input type="color">. */
export function convertColorToHex(color: string | null, fallback: string): string {
  if (!color || color === "none") return fallback;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(0, 7).toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  if (colorContext === undefined) colorContext = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!colorContext) return fallback;
  colorContext.fillStyle = "#000000";
  colorContext.fillStyle = color;
  const out = String(colorContext.fillStyle);
  return /^#[0-9a-f]{6}$/i.test(out) ? out : fallback;
}

/** Style flags with "filled" added or removed, as a DOT style value (null when empty). */
export function createStyleWithFilled(style: string | undefined, filled: boolean): string | null {
  const items = (style ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "filled");
  if (filled) items.push("filled");
  return items.length ? items.join(",") : null;
}

/** Panel to edit the selected node(s): label, shape and colors, written back to DOT. */
export function NodeInspector({ model, ids, onChange, onClose }: NodeInspectorProps) {
  const first = model.nodes.get(ids[0]);
  const single = ids.length === 1;
  const attrs = first?.attrs ?? {};
  const rawLabel = attrs.label ?? "";
  const [label, setLabel] = useState(rawLabel);
  const [openColor, setOpenColor] = useState<string | null>(null);
  const usedColors = useMemo(() => collectGraphColors(model), [model]);
  const toggleColor = (key: string): void => setOpenColor((current) => (current === key ? null : key));

  // Follow external changes (undo, DOT edits) unless the user is typing.
  useEffect(() => setLabel(rawLabel), [rawLabel, ids[0]]);

  if (!first) return null;
  const filled = parseStyle(attrs.style).flags.has("filled");
  const fill = filled ? resolveColor(attrs.fillcolor) ?? resolveColor(attrs.color) ?? "#d3d3d3" : null;
  const shapes = model.nodes.size && ids.map((id) => (model.nodes.get(id)?.attrs.shape ?? "ellipse").toLowerCase());
  const sameShape = shapes && shapes.every((s) => s === shapes[0]);
  const shape = shapes ? shapes[0] : "ellipse";
  const shapeOptions = SHAPES.includes(shape) ? SHAPES : [...SHAPES, shape];

  const commitLabel = (): void => {
    if (label === rawLabel) return;
    onChange({ label: label === "" ? null : label });
  };

  return (
    <aside className="inspector" aria-label={single ? `Node ${first.id}` : `${ids.length} nodes`}>
      <header>
        <h2>{single ? <code>{first.id}</code> : `${ids.length} nodes`}</h2>
        <button type="button" className="btn icon-only" onClick={onClose} aria-label="Close and clear selection" title="Clear selection (Esc)">
          <CloseIcon />
        </button>
      </header>

      {single && (
        <label className="field">
          <span>Label</span>
          <input
            value={label}
            placeholder={first.id}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitLabel();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setLabel(rawLabel);
                (e.target as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <small>Use \n for a line break. Empty shows the ID.</small>
        </label>
      )}

      <label className="field">
        <span>Shape</span>
        <select value={sameShape ? shape : ""} onChange={(e) => onChange({ shape: e.target.value })}>
          {!sameShape && (
            <option value="" disabled>
              Mixed
            </option>
          )}
          {shapeOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <ColorField
        label="Fill"
        value={convertColorToHex(fill, "#ffffff")}
        presets={FILL_PRESETS}
        used={usedColors}
        open={openColor === "fill"}
        onToggle={() => toggleColor("fill")}
        onPick={(hex) => onChange({ fillcolor: hex, style: createStyleWithFilled(attrs.style, true) })}
        resetLabel="None"
        resetDisabled={!filled}
        onReset={() => onChange({ fillcolor: null, style: createStyleWithFilled(attrs.style, false) })}
      />
      <ColorField
        label="Text"
        value={convertColorToHex(resolveColor(attrs.fontcolor), THEME.ink)}
        presets={INK_PRESETS}
        used={usedColors}
        open={openColor === "text"}
        onToggle={() => toggleColor("text")}
        onPick={(hex) => onChange({ fontcolor: hex })}
        resetLabel="Default"
        resetDisabled={attrs.fontcolor === undefined}
        onReset={() => onChange({ fontcolor: null })}
      />
      <ColorField
        label="Border"
        value={convertColorToHex(resolveColor(attrs.color), THEME.ink)}
        presets={INK_PRESETS}
        used={usedColors}
        open={openColor === "border"}
        onToggle={() => toggleColor("border")}
        onPick={(hex) => onChange({ color: hex })}
        resetLabel="Default"
        resetDisabled={attrs.color === undefined}
        onReset={() => onChange({ color: null })}
      />

      <p className="inspector-note">{single ? "Changes are written to the DOT source." : "Applies to every selected node. Drag any of them to move all."}</p>
    </aside>
  );
}
