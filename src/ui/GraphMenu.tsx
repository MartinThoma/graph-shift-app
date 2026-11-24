import { useEffect, useRef, useState } from "react";
import type { GraphMeta } from "../state/library";
import { PlusIcon, TrashIcon } from "./icons";
import { useDismiss } from "./useDismiss";

interface GraphMenuProps {
  graph: GraphMeta;
  graphs: GraphMeta[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (name: string) => void;
  onDelete: (graph: GraphMeta) => void;
  onClose: () => void;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", or a date for older edits. */
export function formatEditedTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return RELATIVE.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return RELATIVE.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return RELATIVE.format(-days, "day");
  return new Date(timestamp).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

/** Rename the current graph, switch to another one, create or delete graphs. */
export function GraphMenu({ graph, graphs, onSwitch, onCreate, onRename, onDelete, onClose }: GraphMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(graph.name);
  useDismiss(rootRef, onClose, "[data-graph-toggle]");
  useEffect(() => setName(graph.name), [graph.name]);

  const commitName = (): void => {
    const trimmed = name.trim();
    if (!trimmed) setName(graph.name);
    else if (trimmed !== graph.name) onRename(trimmed);
  };

  const sorted = [...graphs].sort((a, b) => b.updatedAt - a.updatedAt);
  const now = Date.now();
  return (
    <div ref={rootRef} className="popover graph-menu" role="dialog" aria-label="Graphs">
      <label>
        <span>Name</span>
        <input
          value={name}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitName();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </label>
      <dl className="about-facts graph-facts">
        <dt>ID</dt>
        <dd>
          <code>{graph.id}</code>
        </dd>
      </dl>
      <p className="form-hint">
        {graph.autoName ? "The name follows the DOT graph name until you change it here. " : ""}
        The ID never changes. Share links carry it, so opening one again finds this graph.
      </p>

      <div className="graph-list-head">
        <h2 id="graph-list-title">
          {graphs.length} {graphs.length === 1 ? "graph" : "graphs"} in this browser
        </h2>
        <button
          type="button"
          className="btn"
          onClick={() => {
            onCreate();
            onClose();
          }}
        >
          <PlusIcon />
          <span className="label">New graph</span>
        </button>
      </div>
      <ul className="graph-list" aria-labelledby="graph-list-title">
        {sorted.map((g) => {
          const current = g.id === graph.id;
          return (
            <li key={g.id} className="graph-row" aria-current={current ? "true" : undefined}>
              <button
                type="button"
                className="graph-open"
                onClick={() => {
                  if (!current) onSwitch(g.id);
                  onClose();
                }}
                aria-label={current ? `${g.name} (open)` : `Open “${g.name}”, edited ${formatEditedTime(g.updatedAt, now)}`}
                title={current ? "The graph you are editing" : `Open “${g.name}”`}
              >
                <span className="graph-name">{g.name}</span>
                <span className="graph-time">{current ? "open" : formatEditedTime(g.updatedAt, now)}</span>
              </button>
              <button
                type="button"
                className="btn icon-only graph-delete"
                disabled={graphs.length === 1}
                onClick={() => onDelete(g)}
                aria-label={`Delete “${g.name}”`}
                title={graphs.length === 1 ? "The only graph can't be deleted" : `Delete “${g.name}”…`}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
