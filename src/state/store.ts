/**
 * The editing session: DOT text, node positions, manual-position lock and
 * undo/redo. Framework-free so it can be unit-tested; React subscribes via
 * useSyncExternalStore.
 */
import { buildGraphModel, type GraphModel } from "../dot/model";
import { DotSyntaxError } from "../dot/parser";
import {
  addEdgeToDot,
  addNodeToDot,
  createUniqueNodeId,
  removeEdgeFromDot,
  removeNodeFromDot,
} from "../dot/serializer";
import { computeLayout, type EdgeRoute, type LayoutEngine, type Size } from "../layout/initialLayout";
import { placeNewNodes } from "../layout/placement";
import { computeGraphVisuals, type GraphVisuals } from "../canvas/scene";
import type { Point } from "../render/shapes";
import type { MeasureTextFunction } from "../render/text";
import {
  checkCanRedo,
  checkCanUndo,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresent,
  undoHistory,
  type History,
} from "./history";

export interface DocState {
  dot: string;
  engine: LayoutEngine;
  /** Absolute node centers in canvas coordinates. */
  positions: Record<string, Point>;
  /** Waypoints for routed edges (hierarchical layout). */
  routes: Record<string, EdgeRoute>;
  /** Nodes the user placed by hand. */
  manualNodes: string[];
  /** Once true, layouts never overwrite positions without explicit confirmation. */
  hasManualChanges: boolean;
}

export interface DotError {
  message: string;
  line: number;
  column: number;
  offset: number;
}

export interface StoreState {
  history: History<DocState>;
  /** Last successfully parsed model (kept while the text has errors). */
  model: GraphModel | null;
  visuals: GraphVisuals | null;
  error: DotError | null;
  /** Transient positions while dragging (not in history). */
  dragPositions: Record<string, Point> | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped whenever the DOT text changes for a reason other than typing. */
  externalTextVersion: number;
}

export const DEFAULT_DOT = `digraph checkout {
  // Drag nodes to tidy the picture. Edges follow; this text stays as it is.
  rankdir=TB;
  node [shape=box, style=rounded];

  web [label="Web app"];
  api [label="API gateway"];

  subgraph cluster_services {
    label="Services";
    auth [label="Auth"];
    orders [label="Orders"];
  }

  db [label="Postgres", shape=cylinder];
  queue [label="Event queue"];
  mailer [label="Mailer"];

  web -> api;
  api -> auth;
  api -> orders;
  auth -> db;
  orders -> db;
  orders -> queue [label="events"];
  queue -> mailer;
  mailer -> mailer [label="retry"];
}
`;

const TYPING_COALESCE_MS = 1200;
const REBUILD_DELAY_MS = 180;

type Listener = () => void;

export interface StoreOptions {
  measure?: MeasureTextFunction;
  /** Synchronous rebuilds (tests). */
  immediate?: boolean;
  now?: () => number;
}

function createDotError(error: unknown): DotError {
  if (error instanceof DotSyntaxError) {
    return { message: error.message, line: error.line, column: error.column, offset: error.offset };
  }
  return { message: error instanceof Error ? error.message : String(error), line: 0, column: 0, offset: 0 };
}

function collectSizes(visuals: GraphVisuals): Map<string, Size> {
  const sizes = new Map<string, Size>();
  for (const [id, v] of visuals.nodes) sizes.set(id, { width: v.width, height: v.height });
  return sizes;
}

function collectEdgeLabelSizes(visuals: GraphVisuals): Map<string, Size> {
  const sizes = new Map<string, Size>();
  for (const [key, v] of visuals.edges) if (v.label) sizes.set(key, { width: v.label.width, height: v.label.height });
  return sizes;
}

export class GraphStore {
  private state: StoreState;
  private listeners = new Set<Listener>();
  private readonly measure?: MeasureTextFunction;
  private readonly immediate: boolean;
  private readonly now: () => number;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTypingAt = -Infinity;
  private viewportCenter: Point | null = null;

  constructor(initial: History<DocState> | DocState | null = null, options: StoreOptions = {}) {
    this.measure = options.measure;
    this.immediate = !!options.immediate;
    this.now = options.now ?? (() => Date.now());
    let history: History<DocState>;
    if (!initial) {
      history = createHistory<DocState>({
        dot: DEFAULT_DOT,
        engine: "hierarchical",
        positions: {},
        routes: {},
        manualNodes: [],
        hasManualChanges: false,
      });
    } else if ("present" in initial) {
      history = initial;
    } else {
      history = createHistory(initial);
    }
    this.state = {
      history,
      model: null,
      visuals: null,
      error: null,
      dragPositions: null,
      canUndo: false,
      canRedo: false,
      externalTextVersion: 0,
    };
    this.restorePresent(history, { keepHistory: true });
  }

  /* ---------------------------------------------------------------- */
  /* Subscription                                                      */
  /* ---------------------------------------------------------------- */

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): StoreState => this.state;

  private setState(patch: Partial<StoreState>): void {
    const next = { ...this.state, ...patch };
    next.canUndo = checkCanUndo(next.history);
    next.canRedo = checkCanRedo(next.history);
    this.state = next;
    for (const l of this.listeners) l();
  }

  get present(): DocState {
    return this.state.history.present;
  }

  /** Tell the store where the viewport center is (for placing new nodes). */
  setViewportCenter(point: Point | null): void {
    this.viewportCenter = point;
  }

  /* ---------------------------------------------------------------- */
  /* Derivation                                                        */
  /* ---------------------------------------------------------------- */

  private parse(dot: string): { model: GraphModel; visuals: GraphVisuals } | { error: DotError } {
    try {
      const model = buildGraphModel(dot);
      const visuals = computeGraphVisuals(model, this.measure);
      return { model, visuals };
    } catch (error) {
      return { error: createDotError(error) };
    }
  }

  /**
   * Compute positions for a (new) model. Without manual changes the selected
   * layout runs; with manual changes existing nodes keep their positions and
   * new nodes are placed without overlapping.
   */
  private reconcile(
    previous: DocState,
    dot: string,
    model: GraphModel,
    visuals: GraphVisuals,
    options: { forceLayout?: boolean; engine?: LayoutEngine; explicit?: Record<string, Point> } = {},
  ): DocState {
    const engine = options.engine ?? previous.engine;
    const sizes = collectSizes(visuals);
    const explicit = options.explicit ?? {};
    const hasExplicit = Object.keys(explicit).length > 0;
    const keepPositions = (previous.hasManualChanges || hasExplicit) && !options.forceLayout;

    if (!keepPositions) {
      const result = computeLayout(engine, {
        model,
        sizes,
        edgeLabelSizes: collectEdgeLabelSizes(visuals),
        rankdir: visuals.graph.rankdir,
      });
      return { dot, engine, positions: result.positions, routes: result.routes, manualNodes: [], hasManualChanges: false };
    }

    const positions: Record<string, Point> = {};
    for (const id of model.nodes.keys()) {
      if (explicit[id]) positions[id] = explicit[id];
      else if (previous.positions[id]) positions[id] = previous.positions[id];
    }
    const missing = [...model.nodes.keys()].filter((id) => !positions[id]);
    if (missing.length) {
      const neighbors = new Map<string, string[]>(missing.map((id) => [id, []]));
      for (const edge of model.edges) {
        if (neighbors.has(edge.tail) && edge.head !== edge.tail) neighbors.get(edge.tail)!.push(edge.head);
        if (neighbors.has(edge.head) && edge.head !== edge.tail) neighbors.get(edge.head)!.push(edge.tail);
      }
      const placed = placeNewNodes(
        missing.map((id) => ({ id, size: sizes.get(id)!, neighbors: neighbors.get(id)! })),
        positions,
        sizes,
        this.viewportCenter,
      );
      Object.assign(positions, placed);
    }
    const routes: Record<string, EdgeRoute> = {};
    const edgeKeys = new Set(model.edges.map((e) => e.key));
    for (const [key, route] of Object.entries(previous.routes)) if (edgeKeys.has(key)) routes[key] = route;
    const manualNodes = [...new Set([...previous.manualNodes, ...Object.keys(explicit)])].filter((id) => model.nodes.has(id));
    return { dot, engine, positions, routes, manualNodes, hasManualChanges: true };
  }

  /** Recompute the model for the present snapshot without changing positions. */
  private restorePresent(history: History<DocState>, options: { keepHistory: boolean }): void {
    const present = history.present;
    const parsed = this.parse(present.dot);
    if ("error" in parsed) {
      // Keep the last valid model (if any) so the canvas does not blank.
      this.setState({ history, error: parsed.error, dragPositions: null });
      if (!this.state.model) {
        // Nothing valid yet: try to find the most recent valid snapshot for display.
        for (let i = history.past.length - 1; i >= 0; i--) {
          const p = this.parse(history.past[i].dot);
          if (!("error" in p)) {
            this.setState({ model: p.model, visuals: p.visuals });
            break;
          }
        }
      }
      return;
    }
    const { model, visuals } = parsed;
    const allPositioned = [...model.nodes.keys()].every((id) => present.positions[id]);
    let next = present;
    if (!allPositioned) {
      next = this.reconcile(present, present.dot, model, visuals);
      if (present.hasManualChanges) next = { ...next, hasManualChanges: true };
    }
    const nextHistory = options.keepHistory || next !== present ? replacePresent(history, next) : history;
    this.setState({ history: nextHistory, model, visuals, error: null, dragPositions: null });
  }

  /* ---------------------------------------------------------------- */
  /* Text editing                                                      */
  /* ---------------------------------------------------------------- */

  /** Apply text typed in the editor. Consecutive typing coalesces into one undo step. */
  setDotFromEditor(dot: string): void {
    if (dot === this.present.dot) return;
    const now = this.now();
    const coalesce = now - this.lastTypingAt < TYPING_COALESCE_MS;
    this.lastTypingAt = now;
    const next = { ...this.present, dot };
    const history = coalesce ? replacePresent(this.state.history, next) : pushHistory(this.state.history, next);
    this.setState({ history });
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    if (this.immediate) {
      this.rebuild();
      return;
    }
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, REBUILD_DELAY_MS);
  }

  /** Run any pending re-parse now (before structural edits read the text). */
  flush(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
      this.rebuild();
    }
  }

  private rebuild(): void {
    const present = this.present;
    const parsed = this.parse(present.dot);
    if ("error" in parsed) {
      this.setState({ error: parsed.error });
      return;
    }
    const next = this.reconcile(present, present.dot, parsed.model, parsed.visuals);
    this.setState({
      history: replacePresent(this.state.history, next),
      model: parsed.model,
      visuals: parsed.visuals,
      error: null,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Structural edits (with DOT write-back)                            */
  /* ---------------------------------------------------------------- */

  private commitStructural(dot: string, options: { explicit?: Record<string, Point> } = {}): boolean {
    const parsed = this.parse(dot);
    if ("error" in parsed) return false;
    const next = this.reconcile(this.present, dot, parsed.model, parsed.visuals, options);
    this.lastTypingAt = -Infinity;
    this.setState({
      history: pushHistory(this.state.history, next),
      model: parsed.model,
      visuals: parsed.visuals,
      error: null,
      dragPositions: null,
      externalTextVersion: this.state.externalTextVersion + 1,
    });
    return true;
  }

  /** Structural edits need valid DOT; returns an error message otherwise. */
  checkEditable(): string | null {
    this.flush();
    return this.state.error ? "Fix the DOT error first; editing from the canvas needs valid DOT." : null;
  }

  /** Propose an unused node ID. */
  createNodeId(): string {
    this.flush();
    return this.state.model ? createUniqueNodeId(this.state.model) : "n1";
  }

  /** Add a node via the UI; `position` pins it (counts as a manual placement). */
  addNode(id: string, label?: string, position?: Point): boolean {
    if (this.checkEditable() || !this.state.model || this.state.model.nodes.has(id) || !id) return false;
    return this.commitStructural(addNodeToDot(this.present.dot, id, label), position ? { explicit: { [id]: position } } : {});
  }

  addEdge(tail: string, head: string): boolean {
    if (this.checkEditable() || !this.state.model) return false;
    const { nodes } = this.state.model;
    if (!nodes.has(tail) || !nodes.has(head)) return false;
    return this.commitStructural(addEdgeToDot(this.present.dot, tail, head));
  }

  removeNode(id: string): boolean {
    if (this.checkEditable() || !this.state.model?.nodes.has(id)) return false;
    return this.commitStructural(removeNodeFromDot(this.present.dot, id));
  }

  removeEdge(key: string): boolean {
    if (this.checkEditable() || !this.state.model?.edges.some((e) => e.key === key)) return false;
    return this.commitStructural(removeEdgeFromDot(this.present.dot, key));
  }

  /* ---------------------------------------------------------------- */
  /* Dragging                                                          */
  /* ---------------------------------------------------------------- */

  /** Move a node transiently while dragging (no history, no DOT change). */
  dragNode(id: string, position: Point): void {
    const base = this.state.dragPositions ?? this.present.positions;
    this.setState({ dragPositions: { ...base, [id]: position } });
  }

  /** Finish a drag: record the move as one undo step. DOT text is untouched. */
  commitDrag(movedIds: string[]): void {
    const drag = this.state.dragPositions;
    if (!drag) return;
    const changed = movedIds.filter((id) => {
      const before = this.present.positions[id];
      const after = drag[id];
      return before && after && (before.x !== after.x || before.y !== after.y);
    });
    if (!changed.length) {
      this.setState({ dragPositions: null });
      return;
    }
    this.lastTypingAt = -Infinity;
    const next: DocState = {
      ...this.present,
      positions: { ...this.present.positions, ...Object.fromEntries(changed.map((id) => [id, drag[id]])) },
      manualNodes: [...new Set([...this.present.manualNodes, ...changed])],
      hasManualChanges: true,
    };
    this.setState({ history: pushHistory(this.state.history, next), dragPositions: null });
  }

  cancelDrag(): void {
    if (this.state.dragPositions) this.setState({ dragPositions: null });
  }

  /* ---------------------------------------------------------------- */
  /* Layout                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Switch the initial layout. While manual changes exist this must only be
   * called after the user confirmed discarding them.
   */
  setEngine(engine: LayoutEngine): void {
    this.applyLayout(engine);
  }

  /** Recompute positions with the current layout, discarding manual positions. */
  resetLayout(): void {
    this.applyLayout(this.present.engine);
  }

  private applyLayout(engine: LayoutEngine): void {
    this.flush();
    const { model, visuals } = this.state;
    if (!model || !visuals) {
      this.setState({ history: pushHistory(this.state.history, { ...this.present, engine }) });
      return;
    }
    const next = this.reconcile(this.present, this.present.dot, model, visuals, { forceLayout: true, engine });
    this.lastTypingAt = -Infinity;
    this.setState({ history: pushHistory(this.state.history, next), dragPositions: null });
  }

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */

  undo(): void {
    this.flush();
    if (!checkCanUndo(this.state.history)) return;
    this.lastTypingAt = -Infinity;
    const history = undoHistory(this.state.history);
    const textChanged = history.present.dot !== this.present.dot;
    this.restorePresent(history, { keepHistory: false });
    if (textChanged) this.setState({ externalTextVersion: this.state.externalTextVersion + 1 });
  }

  redo(): void {
    this.flush();
    if (!checkCanRedo(this.state.history)) return;
    this.lastTypingAt = -Infinity;
    const history = redoHistory(this.state.history);
    const textChanged = history.present.dot !== this.present.dot;
    this.restorePresent(history, { keepHistory: false });
    if (textChanged) this.setState({ externalTextVersion: this.state.externalTextVersion + 1 });
  }

  /** Positions to render right now (drag overrides included). */
  getRenderPositions(): Record<string, Point> {
    return this.state.dragPositions ?? this.present.positions;
  }
}
