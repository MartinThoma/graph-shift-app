import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { computeFitViewport, GraphCanvas, zoomViewportAt, type PointerTool, type Selection } from "./canvas/GraphCanvas";
import { SceneBuilder } from "./canvas/scene";
import { DotEditor, type DotEditorHandle } from "./editor/DotEditor";
import { createExportFilename, createSvgExport, downloadSvg } from "./export/exportSvg";
import { findIsolatedNodes, LAYOUT_ENGINES, type LayoutEngine } from "./layout/initialLayout";
import { startAutoUpdate, type AutoUpdateController } from "./pwa/autoUpdate";
import type { Point } from "./render/shapes";
import { loadSession, saveSession, type Viewport } from "./state/storage";
import { GraphStore } from "./state/store";
import { AddNodePopover } from "./ui/AddNodePopover";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { decodeShareData, parseShareHash } from "./share/shareLink";
import { AboutPopover } from "./ui/AboutPopover";
import { LayoutOptionsPopover } from "./ui/LayoutOptionsPopover";
import { SharePopover } from "./ui/SharePopover";
import { NodeInspector } from "./ui/NodeInspector";
import {
  AddEdgeIcon,
  AddNodeIcon,
  DownloadIcon,
  ErrorIcon,
  FitIcon,
  HandIcon,
  HandMarkIcon,
  HandTick,
  InfoIcon,
  InstallIcon,
  MarqueeIcon,
  OptionsIcon,
  RedoIcon,
  RemoveEdgeIcon,
  RemoveNodeIcon,
  ShareIcon,
  ResetIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./ui/icons";

const EDITOR_WIDTH_KEY = "graph-shift:editor-width";
const HAND_MARKS_KEY = "graph-shift:highlight-hand-placed";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const COARSE_POINTER = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

interface PendingLayout {
  engine: LayoutEngine;
  reason: "engine" | "reset" | "isolated";
  groupIsolated?: boolean;
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

function readHandMarksPreference(): boolean {
  try {
    return localStorage.getItem(HAND_MARKS_KEY) === "true";
  } catch {
    return false;
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
  const [pointerTool, setPointerTool] = useState<PointerTool>("pan");
  const [showHandMarks, setShowHandMarks] = useState(readHandMarksPreference);
  const [edgeSource, setEdgeSource] = useState<string | null>(null);
  const [pendingLayout, setPendingLayout] = useState<PendingLayout | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [layoutOptionsOpen, setLayoutOptionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeAbout = useCallback(() => setAboutOpen(false), []);
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
    if (selection.kind === "nodes") {
      const ids = selection.ids.filter((id) => state.model!.nodes.has(id));
      if (ids.length !== selection.ids.length) setSelection(ids.length ? { kind: "nodes", ids } : null);
    }
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
    try {
      localStorage.setItem(HAND_MARKS_KEY, String(showHandMarks));
    } catch {
      // storage unavailable
    }
  }, [showHandMarks]);

  // Open graphs from share links (#share=...), now and whenever the hash changes.
  useEffect(() => {
    const openFromHash = async (): Promise<void> => {
      const data = parseShareHash(window.location.hash);
      if (!data) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      try {
        const doc = await decodeShareData(data);
        store.importSharedDocument(doc);
        setSelection(null);
        fitRequested.current = true;
        setNotice("Opened a shared graph. Undo returns to your previous graph.");
      } catch (error) {
        setNotice(`Could not open the share link. ${error instanceof Error ? error.message : ""}`.trim());
      }
    };
    void openFromHash();
    const onHashChange = (): void => void openFromHash();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [store]);

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
    if (selection?.kind !== "nodes" || !requireEditable()) return;
    store.removeNodes(selection.ids);
    setSelection(null);
  };

  const removeSelectedEdge = (): void => {
    if (selection?.kind !== "edge" || !requireEditable()) return;
    store.removeEdge(selection.key);
    setSelection(null);
  };

  const removeSelection = (): void => {
    if (selection?.kind === "nodes") removeSelectedNode();
    else if (selection?.kind === "edge") removeSelectedEdge();
  };

  const applyLayout = (layout: PendingLayout): void => {
    if (layout.reason === "engine") store.setEngine(layout.engine);
    else if (layout.reason === "isolated") store.setGroupIsolated(layout.groupIsolated ?? true);
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
    if (store.addNode(id, undefined, position)) setSelection({ kind: "nodes", ids: [id] });
  };

  const handleAddNode = (id: string, label: string): string | null => {
    if (!requireEditable()) return "Fix the DOT error first.";
    if (!id.trim()) return "Enter an ID.";
    if (state.model?.nodes.has(id)) return `A node named “${id}” already exists.`;
    if (!store.addNode(id, label || undefined)) return "Could not add the node.";
    setSelection({ kind: "nodes", ids: [id] });
    setAddNodeOpen(false);
    return null;
  };

  const handleNudge = (ids: string[], dx: number, dy: number): void => {
    const current = store.getRenderPositions();
    const moves: Record<string, Point> = {};
    for (const id of ids) if (current[id]) moves[id] = { x: current[id].x + dx, y: current[id].y + dy };
    store.dragNodes(moves);
    store.commitDrag(Object.keys(moves));
  };

  const handleArrange = (engine: LayoutEngine): void => {
    if (selection?.kind !== "nodes") return;
    if (store.layoutSelection(selection.ids, engine)) {
      const label = LAYOUT_ENGINES.find((e) => e.id === engine)?.label ?? engine;
      setNotice(`Arranged ${selection.ids.length} nodes with ${label}. Undo puts them back.`);
    }
  };

  const handleInspectorChange = (changes: Record<string, string | null>): void => {
    if (selection?.kind !== "nodes" || !requireEditable()) return;
    store.setNodeAttributes(selection.ids, changes);
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
    const currentModel = store.getState().model;
    if (mod && event.key.toLowerCase() === "a" && currentModel) {
      event.preventDefault();
      setSelection(currentModel.nodes.size ? { kind: "nodes", ids: [...currentModel.nodes.keys()] } : null);
      return;
    }
    if (!mod && !event.altKey && event.key.toLowerCase() === "v") setPointerTool("select");
    else if (!mod && !event.altKey && event.key.toLowerCase() === "h") setPointerTool("pan");
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
  } else if (selection?.kind === "nodes") {
    status = (
      <>
        {selection.ids.length === 1 ? (
          <>
            Selected <b>{selection.ids[0]}</b>
          </>
        ) : (
          <>
            <b>{selection.ids.length} nodes</b> selected; drag one to move all
          </>
        )}
        {!COARSE_POINTER && (
          <>
            <span className="status-sep" />
            Shift+click adds or removes; arrows nudge; Delete removes
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
    status =
      pointerTool === "select" ? (
        <>Drag on the sheet to select an area. Space+drag or the middle mouse button pans.</>
      ) : (
        <>Drag nodes to tidy the picture. Shift+drag the sheet to select an area; double-click it to add a node.</>
      );
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
          <button
            type="button"
            className="btn icon-only"
            data-layout-options-toggle
            aria-expanded={layoutOptionsOpen}
            aria-haspopup="dialog"
            aria-label="Layout options"
            title="Layout options"
            onClick={() => setLayoutOptionsOpen((open) => !open)}
          >
            <OptionsIcon />
          </button>
          {layoutOptionsOpen && (
            <LayoutOptionsPopover
              groupIsolated={present.groupIsolated ?? true}
              isolatedCount={model ? findIsolatedNodes(model).length : 0}
              onChangeGroupIsolated={(value) => requestLayout({ engine: present.engine, reason: "isolated", groupIsolated: value })}
              onClose={() => setLayoutOptionsOpen(false)}
            />
          )}
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
          <button
            type="button"
            className="btn danger"
            onClick={removeSelectedNode}
            disabled={selection?.kind !== "nodes"}
            title="Remove the selected nodes and their edges (Delete)"
            aria-label={selection?.kind === "nodes" && selection.ids.length > 1 ? `Remove ${selection.ids.length} nodes` : "Remove node"}
          >
            <RemoveNodeIcon />
            <span className="label">{selection?.kind === "nodes" && selection.ids.length > 1 ? `Remove ${selection.ids.length} nodes` : "Remove node"}</span>
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
        <div className="group output-group">
          <button
            type="button"
            className="btn"
            data-share-toggle
            aria-expanded={shareOpen}
            aria-haspopup="dialog"
            onClick={() => setShareOpen((open) => !open)}
            title="Create a link that contains this graph"
          >
            <ShareIcon />
            <span className="label">Share</span>
          </button>
          <button type="button" className="btn primary" onClick={handleDownload} disabled={!scene || !model?.nodes.size}>
            <DownloadIcon />
            <span className="label">Download SVG</span>
          </button>
          <button
            type="button"
            className="btn icon-only about-toggle"
            data-about-toggle
            aria-expanded={aboutOpen}
            aria-haspopup="dialog"
            aria-label="About Graph Shift"
            title="Version, source code and feedback"
            onClick={() => setAboutOpen((open) => !open)}
          >
            <InfoIcon />
          </button>
          {shareOpen && (
            <SharePopover
              doc={{
                dot: present.dot,
                engine: present.engine,
                groupIsolated: present.groupIsolated,
                positions: present.positions,
                routes: present.routes,
                manualNodes: present.hasManualChanges ? present.manualNodes : [],
              }}
              onClose={closeShare}
            />
          )}
          {aboutOpen && (
            <AboutPopover
              version={__APP_VERSION__}
              onCheckForUpdates={() => updaterRef.current?.checkNow() ?? Promise.resolve("unavailable")}
              onClose={closeAbout}
            />
          )}
        </div>
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
            showHandMarks={showHandMarks}
            mode={mode}
            edgeSource={edgeSource}
            pointerTool={pointerTool}
            onPickNode={handlePickNode}
            onDragNodes={(moves) => store.dragNodes(moves)}
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
          {selection?.kind === "nodes" && mode === "select" && model && (
            <NodeInspector
              model={model}
              ids={selection.ids}
              onChange={handleInspectorChange}
              onArrange={handleArrange}
              onClose={() => setSelection(null)}
            />
          )}
          <div className="zoom-controls" role="group" aria-label="View">
            <div className="tool-toggle" role="group" aria-label="Drag on the sheet">
              <button
                type="button"
                className="btn icon-only"
                aria-pressed={pointerTool === "pan"}
                onClick={() => setPointerTool("pan")}
                title="Pan: dragging the sheet moves the view (H)"
                aria-label="Pan tool"
              >
                <HandIcon />
              </button>
              <button
                type="button"
                className="btn icon-only"
                aria-pressed={pointerTool === "select"}
                onClick={() => setPointerTool("select")}
                title="Select: dragging the sheet draws a selection rectangle (V)"
                aria-label="Rectangle select tool"
              >
                <MarqueeIcon />
              </button>
            </div>
            <button
              type="button"
              className="btn icon-only hand-marks-toggle"
              aria-pressed={showHandMarks}
              onClick={() => setShowHandMarks((on) => !on)}
              title={showHandMarks ? "Hide the markers on nodes placed by hand" : "Highlight nodes placed by hand"}
              aria-label="Highlight nodes placed by hand"
            >
              <HandMarkIcon />
            </button>
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
        {pendingLayout?.reason === "isolated" ? (
          <p>
            {pendingLayout.groupIsolated ? "Collecting unconnected nodes in a grid" : "Laying out unconnected nodes with the rest"} lays out the whole
            graph again, so the {handCount} {handCount === 1 ? "node" : "nodes"} you placed by hand will move. You can undo this.
          </p>
        ) : pendingLayout?.reason === "engine" ? (
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
