import { useEffect, useState } from "react";
import type { GraphModel } from "../dot/model";
import { resolveColor } from "../render/colors";
import { parseStyle, THEME } from "../render/visuals";
import { CloseIcon } from "./icons";

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

      <div className="color-row">
        <span>Fill</span>
        <input
          type="color"
          aria-label="Fill color"
          value={convertColorToHex(fill, "#ffffff")}
          onChange={(e) => onChange({ fillcolor: e.target.value, style: createStyleWithFilled(attrs.style, true) })}
        />
        <button
          type="button"
          className="btn"
          disabled={!filled}
          onClick={() => onChange({ fillcolor: null, style: createStyleWithFilled(attrs.style, false) })}
        >
          None
        </button>
      </div>

      <div className="color-row">
        <span>Text</span>
        <input
          type="color"
          aria-label="Text color"
          value={convertColorToHex(resolveColor(attrs.fontcolor), THEME.ink)}
          onChange={(e) => onChange({ fontcolor: e.target.value })}
        />
        <button type="button" className="btn" disabled={attrs.fontcolor === undefined} onClick={() => onChange({ fontcolor: null })}>
          Default
        </button>
      </div>

      <div className="color-row">
        <span>Border</span>
        <input
          type="color"
          aria-label="Border color"
          value={convertColorToHex(resolveColor(attrs.color), THEME.ink)}
          onChange={(e) => onChange({ color: e.target.value })}
        />
        <button type="button" className="btn" disabled={attrs.color === undefined} onClick={() => onChange({ color: null })}>
          Default
        </button>
      </div>

      <p className="inspector-note">{single ? "Changes are written to the DOT source." : "Applies to every selected node. Drag any of them to move all."}</p>
    </aside>
  );
}
