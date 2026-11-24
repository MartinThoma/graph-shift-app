import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { computeFitViewport, GraphCanvas, zoomViewportAt, type Selection } from "./canvas/GraphCanvas";
import { SceneBuilder } from "./canvas/scene";
import { DotEditor, type DotEditorHandle } from "./editor/DotEditor";
import { createExportFilename, createSvgExport, downloadSvg } from "./export/exportSvg";
import { LAYOUT_ENGINES, type LayoutEngine } from "./layout/initialLayout";
import { startAutoUpdate, type AutoUpdateController } from "./pwa/autoUpdate";
import type { Point } from "./render/shapes";
import { loadSession, saveSession, type Viewport } from "./state/storage";
import { GraphStore } from "./state/store";
import { AddNodePopover } from "./ui/AddNodePopover";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import {
  AddEdgeIcon,
  AddNodeIcon,
  DownloadIcon,
  ErrorIcon,
  FitIcon,
  HandTick,
  InstallIcon,
  RedoIcon,
  RemoveEdgeIcon,
  RemoveNodeIcon,
  ResetIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./ui/icons";

const EDITOR_WIDTH_KEY = "graph-shift:editor-width";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const COARSE_POINTER = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

interface PendingLayout {
  engine: LayoutEngine;
  reason: "engine" | "reset";
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function readEditorWidth(): number {
  try {
    const value = Number(localStorage.getItem(EDITOR_WIDTH_KEY));
    return Number.isFinite(value) && value >= 240 ? value : 440;
  } catch {
    return 440;
  }
}

function checkTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest?.(".cm-editor, input, textarea, select, [contenteditable='true']");
}

export function App() {
  const session = useMemo(() => loadSession(), []);
  const store = useMemo(() => new GraphStore(session?.history ?? null), [session]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const present = state.history.present;
  const builderRef = useRef(new SceneBuilder());
  const editorRef = useRef<DotEditorHandle>(null);

  const [viewport, setViewport] = useState<Viewport | null>(session?.viewport ?? null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mode, setMode] = useState<"select" | "add-edge">("select");
  const [edgeSource, setEdgeSource] = useState<string | null>(null);
  const [pendingLayout, setPendingLayout] = useState<PendingLayout | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [suggestedId, setSuggestedId] = useState("n1");
  const [notice, setNotice] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [editorWidth, setEditorWidth] = useState(readEditorWidth);
  const [mobilePane, setMobilePane] = useState<"editor" | "canvas">("canvas");
  const updaterRef = useRef<AutoUpdateController | null>(null);
  const fitRequested = useRef(viewport === null);

  const positions = state.dragPositions ?? present.positions;
  const scene = useMemo(
    () => (state.model && state.visuals ? builderRef.current.build(state.model, state.visuals, positions, present.routes) : null),
    [state.model, state.visuals, positions, present.routes],
  );
  const manualNodes = useMemo(() => new Set(present.manualNodes), [present.manualNodes]);

  // Drop selections that no longer exist.
  useEffect(() => {
    if (!state.model || !selection) return;
    if (selection.kind === "node" && !state.model.nodes.has(selection.id)) setSelection(null);
    if (selection.kind === "edge" && !state.model.edges.some((e) => e.key === selection.key)) setSelection(null);
  }, [state.model, selection]);

  /* -------------------------------------------------------------- */
  /* Viewport                                                        */
  /* -------------------------------------------------------------- */

  const fitView = useCallback(() => {
    if (!scene || !canvasSize.width) return;
    setViewport(computeFitViewport(scene.bounds, canvasSize));
  }, [scene, canvasSize]);

  useEffect(() => {
    if (fitRequested.current && scene && canvasSize.width > 0) {
      fitRequested.current = false;
      fitView();
    }
  }, [scene, canvasSize, fitView]);

  const effectiveViewport = viewport ?? { x: 0, y: 0, k: 1 };

  useEffect(() => {
    if (!canvasSize.width) return;
    const vp = effectiveViewport;
    store.setViewportCenter({ x: (canvasSize.width / 2 - vp.x) / vp.k, y: (canvasSize.height / 2 - vp.y) / vp.k });
  }, [store, canvasSize, effectiveViewport]);

  const zoomBy = (factor: number): void => {
    setViewport((vp) => zoomViewportAt(vp ?? { x: 0, y: 0, k: 1 }, factor, { x: canvasSize.width / 2, y: canvasSize.height / 2 }));
  };

  /* -------------------------------------------------------------- */
  /* Persistence & updates                                           */
  /* -------------------------------------------------------------- */

  const latest = useRef({ history: state.history, viewport });
  latest.current = { history: state.history, viewport };
  const flushSave = useCallback(() => {
    saveSession(latest.current.history, latest.current.viewport);
  }, []);

  useEffect(() => {
    const timer = setTimeout(flushSave, 400);
    return () => clearTimeout(timer);
  }, [state.history, viewport, flushSave]);

  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSave]);

  useEffect(() => {
    const controller = startAutoUpdate({
      version: __APP_VERSION__,
      onUpdateReady: () => setUpdateReady(true),
      onBeforeReload: flushSave,
    });
    updaterRef.current = controller;
    const onInstallPrompt = (event: Event): void => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      controller.dispose();
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [flushSave]);

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_WIDTH_KEY, String(Math.round(editorWidth)));
    } catch {
      // storage unavailable
    }
  }, [editorWidth]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  /* -------------------------------------------------------------- */
  /* Actions                                                         */
  /* -------------------------------------------------------------- */

  const requireEditable = (): boolean => {
    const problem = store.checkEditable();
    if (problem) setNotice(problem);
    return !problem;
  };

  const cancelEdgeMode = useCallback(() => {
    setMode("select");
    setEdgeSource(null);
  }, []);

  const startEdgeMode = (): void => {
    if (mode === "add-edge") {
      cancelEdgeMode();
      return;
    }
    if (!requireEditable()) return;
    setAddNodeOpen(false);
    setMode("add-edge");
    setEdgeSource(null);
  };

  const handlePickNode = (id: string): void => {
    if (!edgeSource) {
      setEdgeSource(id);
      return;
    }
    if (store.addEdge(edgeSource, id)) {
      const edges = store.getState().model?.edges ?? [];
      const created = [...edges].reverse().find((e) => e.tail === edgeSource && e.head === id);
      if (created) setSelection({ kind: "edge", key: created.key });
    }
    cancelEdgeMode();
  };

  const removeSelectedNode = (): void => {
    if (selection?.kind !== "node" || !requireEditable()) return;
    store.removeNode(selection.id);
    setSelection(null);
  };

  const removeSelectedEdge = (): void => {
    if (selection?.kind !== "edge" || !requireEditable()) return;
    store.removeEdge(selection.key);
    setSelection(null);
  };

  const removeSelection = (): void => {
    if (selection?.kind === "node") removeSelectedNode();
    else if (selection?.kind === "edge") removeSelectedEdge();
  };

  const applyLayout = (layout: PendingLayout): void => {
    if (layout.reason === "engine") store.setEngine(layout.engine);
    else store.resetLayout();
    fitRequested.current = true;
  };

  const requestLayout = (layout: PendingLayout): void => {
    if (present.hasManualChanges) setPendingLayout(layout);
    else applyLayout(layout);
  };

  const handleAddNodeAt = (position: Point): void => {
    if (!requireEditable()) return;
    const id = store.createNodeId();
    if (store.addNode(id, undefined, position)) setSelection({ kind: "node", id });
  };

  const handleAddNode = (id: string, label: string): string | null => {
    if (!requireEditable()) return "Fix the DOT error first.";
    if (!id.trim()) return "Enter an ID.";
    if (state.model?.nodes.has(id)) return `A node named “${id}” already exists.`;
    if (!store.addNode(id, label || undefined)) return "Could not add the node.";
    setSelection({ kind: "node", id });
    setAddNodeOpen(false);
    return null;
  };

  const handleNudge = (id: string, dx: number, dy: number): void => {
    const p = store.getRenderPositions()[id];
    if (!p) return;
    store.dragNode(id, { x: p.x + dx, y: p.y + dy });
    store.commitDrag([id]);
  };

  const handleDownload = (): void => {
    if (!scene || !state.model) return;
    const name = state.model.name;
    downloadSvg(createSvgExport(scene, name || "graph"), createExportFilename(name));
  };

  const handleUndo = (): void => {
    cancelEdgeMode();
    store.undo();
  };
  const handleRedo = (): void => {
    cancelEdgeMode();
    store.redo();
  };

  // Global shortcuts (the editor keeps its own undo for typing).
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (event: KeyboardEvent) => {
    if (pendingLayout || addNodeOpen) return;
    const mod = event.metaKey || event.ctrlKey;
    const typing = checkTypingTarget(event.target);
    if (mod && !typing && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if (mod && !typing && event.key.toLowerCase() === "y") {
      event.preventDefault();
      handleRedo();
      return;
    }
    if (typing) return;
    if (event.key === "Escape") {
      if (mode === "add-edge") cancelEdgeMode();
      else setSelection(null);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      removeSelection();
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => shortcutRef.current(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* -------------------------------------------------------------- */
  /* Splitter                                                        */
  /* -------------------------------------------------------------- */

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = editorWidth;
    const max = Math.max(300, window.innerWidth * 0.7);
    const onMove = (e: PointerEvent): void => setEditorWidth(Math.min(max, Math.max(260, startWidth + e.clientX - startX)));
    const onUp = (): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  /* -------------------------------------------------------------- */
  /* Derived text                                                    */
  /* -------------------------------------------------------------- */

  const model = state.model;
  const engineLabel = LAYOUT_ENGINES.find((e) => e.id === present.engine)?.label ?? present.engine;
  const pendingEngineLabel = pendingLayout ? LAYOUT_ENGINES.find((e) => e.id === pendingLayout.engine)?.label : "";
  const handCount = present.manualNodes.filter((id) => model?.nodes.has(id)).length;
  const edgeOp = model?.directed === false ? "—" : "→";
  const selectedEdge = selection?.kind === "edge" ? model?.edges.find((e) => e.key === selection.key) : undefined;

  const handCountText =
    present.hasManualChanges && model ? (
      <>
        <b>
          {handCount} of {model.nodes.size}
        </b>{" "}
        nodes placed by hand
      </>
    ) : null;
  let status: React.ReactNode;
  if (mode === "add-edge") {
    status = edgeSource ? (
      <>
        Add edge from <b>{edgeSource}</b>: {COARSE_POINTER ? "tap" : "click"} the target node (the same node makes a loop).
        {COARSE_POINTER ? "" : " Esc cancels."}
      </>
    ) : (
      <>
        Add edge: {COARSE_POINTER ? "tap" : "click"} the source node.{COARSE_POINTER ? "" : " Esc cancels."}
      </>
    );
  } else if (selection?.kind === "node") {
    status = (
      <>
        Selected <b>{selection.id}</b>
        {!COARSE_POINTER && (
          <>
            <span className="status-sep" />
            Arrow keys nudge; Delete removes
          </>
        )}
        {handCountText && (
          <>
            <span className="status-sep" />
            {handCountText}
          </>
        )}
      </>
    );
  } else if (selectedEdge) {
    status = (
      <>
        Selected edge <b>{selectedEdge.tail}</b> {edgeOp} <b>{selectedEdge.head}</b>
        {!COARSE_POINTER && (
          <>
            <span className="status-sep" />
            Delete removes
          </>
        )}
        {handCountText && (
          <>
            <span className="status-sep" />
            {handCountText}
          </>
        )}
      </>
    );
  } else if (handCountText) {
    status = handCountText;
  } else if (COARSE_POINTER) {
    status = <>Drag nodes to tidy the picture. Use the add buttons above to add nodes and edges.</>;
  } else {
    status = <>Drag nodes to tidy the picture. Double-click the sheet to add a node.</>;
  }

  const emptyMessage = !model ? (state.error ? "Fix the DOT source to see the graph." : null) : model.nodes.size === 0 ? "Empty graph. Add a node, or write DOT on the left." : null;

  return (
    <div className="app" data-pane={mobilePane}>
      <header className="toolbar" role="toolbar" aria-label="Graph actions">
        <div className="brand">
          <img src="./icons/icon.svg" alt="" width="22" height="22" />
          <span>Graph Shift</span>
        </div>

        <div className="group layout-group">
          <label className="field-label" htmlFor="layout-select">
            Layout
          </label>
          <select
            id="layout-select"
            value={present.engine}
            onChange={(e) => requestLayout({ engine: e.target.value as LayoutEngine, reason: "engine" })}
            title={LAYOUT_ENGINES.find((e) => e.id === present.engine)?.hint}
          >
            {LAYOUT_ENGINES.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>
          {present.hasManualChanges && (
            <span className="lock-state" title="Layouts will not move your nodes without asking">
              <HandTick />
              Placed by hand
            </span>
          )}
        </div>

        <div className="group">
          <button type="button" className="btn icon-only" onClick={handleUndo} disabled={!state.canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
            <UndoIcon />
          </button>
          <button
            type="button"
            className="btn icon-only"
            onClick={handleRedo}
            disabled={!state.canRedo}
            title={`Redo (${MOD}${IS_MAC ? "⇧Z" : "Y"})`}
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
        </div>

        <div className="group add-group">
          <button
            type="button"
            className="btn"
            aria-expanded={addNodeOpen}
            aria-haspopup="dialog"
            onClick={() => {
              if (!addNodeOpen && !requireEditable()) return;
              cancelEdgeMode();
              if (!addNodeOpen) setSuggestedId(store.createNodeId());
              setAddNodeOpen((open) => !open);
            }}
            title="Add node (or double-click the sheet)"
          >
            <AddNodeIcon />
            <span className="label">Add node</span>
          </button>
          <button type="button" className="btn" aria-pressed={mode === "add-edge"} onClick={startEdgeMode} title="Add edge: click source, then target">
            <AddEdgeIcon />
            <span className="label">Add edge</span>
          </button>
          {addNodeOpen && (
            <AddNodePopover suggestedId={suggestedId} onSubmit={handleAddNode} onClose={() => setAddNodeOpen(false)} />
          )}
        </div>

        <div className="group destructive-group">
          <button type="button" className="btn danger" onClick={removeSelectedNode} disabled={selection?.kind !== "node"} title="Remove the selected node and its edges (Delete)">
            <RemoveNodeIcon />
            <span className="label">Remove node</span>
          </button>
          <button type="button" className="btn danger" onClick={removeSelectedEdge} disabled={selection?.kind !== "edge"} title="Remove the selected edge (Delete)">
            <RemoveEdgeIcon />
            <span className="label">Remove edge</span>
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => requestLayout({ engine: present.engine, reason: "reset" })}
            disabled={!present.hasManualChanges}
            title={present.hasManualChanges ? `Lay out again with ${engineLabel}` : "Nothing placed by hand yet"}
          >
            <ResetIcon />
            <span className="label">Reset layout…</span>
          </button>
        </div>

        <div className="spacer" />

        {updateReady && (
          <button type="button" className="btn update" onClick={() => updaterRef.current?.applyUpdate()} title="A newer version is ready. Your work is saved.">
            Update available — Reload
          </button>
        )}
        {installEvent && (
          <button
            type="button"
            className="btn icon-only"
            onClick={() => {
              void installEvent.prompt();
              setInstallEvent(null);
            }}
            title="Install Graph Shift to use it offline as an app"
            aria-label="Install app"
          >
            <InstallIcon />
          </button>
        )}
        <button type="button" className="btn primary" onClick={handleDownload} disabled={!scene || !model?.nodes.size}>
          <DownloadIcon />
          <span className="label">Download SVG</span>
        </button>
      </header>

      <nav className="pane-tabs" aria-label="Panes">
        <button type="button" aria-pressed={mobilePane === "editor"} onClick={() => setMobilePane("editor")}>
          DOT source
          {state.error && <span className="tab-error" aria-label="has an error" />}
        </button>
        <button type="button" aria-pressed={mobilePane === "canvas"} onClick={() => setMobilePane("canvas")}>
          Graph
        </button>
      </nav>

      <main className="workspace" style={{ "--editor-width": `${editorWidth}px` } as React.CSSProperties}>
        <section className="editor-pane" aria-label="DOT editor">
          <div className="pane-head">
            <h2>DOT source</h2>
            {model && (
              <span className="meta">
                {model.strict ? "strict " : ""}
                {model.directed ? "digraph" : "graph"} · {model.nodes.size} {model.nodes.size === 1 ? "node" : "nodes"} · {model.edges.length}{" "}
                {model.edges.length === 1 ? "edge" : "edges"}
              </span>
            )}
          </div>
          <DotEditor ref={editorRef} value={present.dot} error={state.error} onChange={(text) => store.setDotFromEditor(text)} />
          {state.error && (
            <button type="button" className="error-slip" onClick={() => editorRef.current?.focusAt(state.error!.offset)}>
              <ErrorIcon />
              <span>
                {state.error.line > 0 && (
                  <b>
                    Line {state.error.line}, column {state.error.column}:{" "}
                  </b>
                )}
                {state.error.message}.{model ? " Showing the last valid graph." : ""}
              </span>
            </button>
          )}
        </section>

        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor"
          aria-valuenow={Math.round(editorWidth)}
          aria-valuemin={260}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setEditorWidth((w) => Math.max(260, w - 24));
            if (e.key === "ArrowRight") setEditorWidth((w) => Math.min(window.innerWidth * 0.7, w + 24));
          }}
        />

        <section className="canvas-pane" aria-label="Graph">
          <GraphCanvas
            scene={scene}
            viewport={effectiveViewport}
            onViewportChange={setViewport}
            selection={selection}
            onSelect={setSelection}
            manualNodes={manualNodes}
            mode={mode}
            edgeSource={edgeSource}
            onPickNode={handlePickNode}
            onDragNode={(id, p) => store.dragNode(id, p)}
            onCommitDrag={(ids) => store.commitDrag(ids)}
            onCancelDrag={() => store.cancelDrag()}
            onAddNodeAt={handleAddNodeAt}
            onNudge={handleNudge}
            onSizeChange={setCanvasSize}
            emptyMessage={emptyMessage}
          />
          <div className={`status${notice ? " is-notice" : ""}`} role="status" aria-live="polite">
            {notice ?? status}
          </div>
          <div className="zoom-controls" role="group" aria-label="Zoom">
            <button type="button" className="btn icon-only" onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className="btn zoom-level"
              onClick={() => setViewport((vp) => zoomViewportAt(vp ?? { x: 0, y: 0, k: 1 }, 1 / (vp?.k ?? 1), { x: canvasSize.width / 2, y: canvasSize.height / 2 }))}
              title="Reset zoom to 100%"
            >
              {Math.round(effectiveViewport.k * 100)}%
            </button>
            <button type="button" className="btn icon-only" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
              <ZoomInIcon />
            </button>
            <button type="button" className="btn icon-only" onClick={fitView} title="Fit graph to view" aria-label="Fit to view">
              <FitIcon />
            </button>
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={pendingLayout !== null}
        title="Replace hand-placed positions?"
        confirmLabel="Re-layout"
        cancelLabel="Keep positions"
        onCancel={() => setPendingLayout(null)}
        onConfirm={() => {
          if (pendingLayout) applyLayout(pendingLayout);
          setPendingLayout(null);
        }}
      >
        {pendingLayout?.reason === "engine" ? (
          <p>
            Switching to <b>{pendingEngineLabel}</b> lays out the whole graph again, so the {handCount} {handCount === 1 ? "node" : "nodes"} you placed by
            hand will move. You can undo this.
          </p>
        ) : (
          <p>
            Resetting lays out the whole graph again with <b>{engineLabel}</b>, so the {handCount} {handCount === 1 ? "node" : "nodes"} you placed by hand
            will move. You can undo this.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
