import { describe, expect, it } from "vitest";
import { createEdgeKey } from "../dot/model";
import { estimateTextWidth } from "../render/text";
import { GraphStore, type DocState } from "./store";
import { parseSession, serializeSession } from "./storage";

const DOT = "digraph {\n  a -> b;\n  b -> c;\n}\n";

function createStore(dot = DOT): GraphStore {
  const initial: DocState = { dot, engine: "hierarchical", positions: {}, routes: {}, manualNodes: [], hasManualChanges: false };
  return new GraphStore(initial, { measure: estimateTextWidth, immediate: true });
}

describe("GraphStore", () => {
  it("computes an initial layout for every node", () => {
    const store = createStore();
    expect(Object.keys(store.present.positions).sort()).toEqual(["a", "b", "c"]);
    expect(store.present.hasManualChanges).toBe(false);
  });

  it("dragging a node moves it, sets the manual flag and leaves the DOT text untouched", () => {
    const store = createStore();
    store.dragNode("a", { x: 500, y: 500 });
    expect(store.present.positions.a).not.toEqual({ x: 500, y: 500 });
    store.commitDrag(["a"]);
    expect(store.present.positions.a).toEqual({ x: 500, y: 500 });
    expect(store.present.hasManualChanges).toBe(true);
    expect(store.present.manualNodes).toEqual(["a"]);
    expect(store.present.dot).toBe(DOT);
  });

  it("undoing a drag restores the previous position without changing the text", () => {
    const store = createStore();
    const before = store.present.positions.a;
    store.dragNode("a", { x: 500, y: 500 });
    store.commitDrag(["a"]);
    store.undo();
    expect(store.present.positions.a).toEqual(before);
    expect(store.present.hasManualChanges).toBe(false);
    expect(store.present.dot).toBe(DOT);
    store.redo();
    expect(store.present.positions.a).toEqual({ x: 500, y: 500 });
  });

  it("text edits after a manual drag keep every existing node in place", () => {
    const store = createStore();
    store.dragNode("a", { x: 500, y: 500 });
    store.commitDrag(["a"]);
    const before = { ...store.present.positions };
    store.setDotFromEditor("digraph {\n  a -> b;\n  b -> c;\n  c -> d;\n}\n");
    for (const id of ["a", "b", "c"]) expect(store.present.positions[id]).toEqual(before[id]);
    expect(store.present.positions.d).toBeDefined();
  });

  it("text edits without manual changes re-run the layout", () => {
    const store = createStore();
    store.setDotFromEditor("digraph {\n  rankdir=LR;\n  a -> b;\n  b -> c;\n}\n");
    const { a, c } = store.present.positions;
    expect(c.x).toBeGreaterThan(a.x);
  });

  it("a syntax error keeps the last valid model and positions", () => {
    const store = createStore();
    const model = store.getState().model;
    const positions = store.present.positions;
    store.setDotFromEditor("digraph {\n  a -> ;\n}");
    expect(store.getState().error?.line).toBe(2);
    expect(store.getState().model).toBe(model);
    expect(store.present.positions).toEqual(positions);
  });

  it("adding a node while positions are manual places it without moving others or overlapping", () => {
    const store = createStore();
    store.dragNode("a", { x: 300, y: 300 });
    store.commitDrag(["a"]);
    const before = { ...store.present.positions };
    store.setViewportCenter({ x: 300, y: 300 });
    expect(store.addNode("n1")).toBe(true);
    expect(store.present.dot).toContain("n1;");
    for (const id of ["a", "b", "c"]) expect(store.present.positions[id]).toEqual(before[id]);
    const n1 = store.present.positions.n1;
    expect(Math.abs(n1.x - 300) > 40 || Math.abs(n1.y - 300) > 30).toBe(true);
  });

  it("adding and removing edges and nodes writes back to the DOT text and is undoable", () => {
    const store = createStore();
    expect(store.addEdge("c", "a")).toBe(true);
    expect(store.present.dot).toContain("c -> a;");
    expect(store.removeEdge(createEdgeKey("a", "b", 0))).toBe(true);
    expect(store.present.dot).not.toContain("a -> b");
    expect(store.removeNode("c")).toBe(true);
    expect(store.getState().model!.nodes.has("c")).toBe(false);
    store.undo();
    expect(store.getState().model!.nodes.has("c")).toBe(true);
    store.undo();
    store.undo();
    expect(store.present.dot).toBe(DOT);
  });

  it("removing a node keeps all remaining nodes at their current positions", () => {
    const store = createStore();
    store.dragNode("b", { x: 400, y: 50 });
    store.commitDrag(["b"]);
    const before = { ...store.present.positions };
    store.removeNode("c");
    expect(store.present.positions.a).toEqual(before.a);
    expect(store.present.positions.b).toEqual(before.b);
  });

  it("changing the layout recomputes positions and clears the manual flag", () => {
    const store = createStore();
    store.dragNode("a", { x: 999, y: 999 });
    store.commitDrag(["a"]);
    store.setEngine("circular");
    expect(store.present.engine).toBe("circular");
    expect(store.present.hasManualChanges).toBe(false);
    expect(store.present.positions.a).not.toEqual({ x: 999, y: 999 });
    store.undo();
    expect(store.present.positions.a).toEqual({ x: 999, y: 999 });
    expect(store.present.engine).toBe("hierarchical");
  });

  it("consecutive typing coalesces into one undo step", () => {
    let time = 1000;
    const store = new GraphStore(
      { dot: DOT, engine: "hierarchical", positions: {}, routes: {}, manualNodes: [], hasManualChanges: false },
      { measure: estimateTextWidth, immediate: true, now: () => time },
    );
    store.setDotFromEditor(DOT.replace("c;", "c; d;"));
    time += 300;
    store.setDotFromEditor(DOT.replace("c;", "c; d; e;"));
    store.undo();
    expect(store.present.dot).toBe(DOT);
  });

  it("structural edits are refused while the DOT text has an error", () => {
    const store = createStore();
    store.setDotFromEditor("digraph { a -> }");
    expect(store.addNode("x")).toBe(false);
    expect(store.checkEditable()).toMatch(/Fix the DOT error/);
  });

  it("restores a persisted session with positions and history intact", () => {
    const store = createStore();
    store.dragNode("a", { x: 123, y: 456 });
    store.commitDrag(["a"]);
    const raw = serializeSession(store.getState().history, { x: 1, y: 2, k: 1.5 });
    const session = parseSession(raw)!;
    const restored = new GraphStore(session.history, { measure: estimateTextWidth, immediate: true });
    expect(restored.present.positions.a).toEqual({ x: 123, y: 456 });
    expect(restored.present.hasManualChanges).toBe(true);
    expect(restored.getState().canUndo).toBe(true);
    expect(session.viewport).toEqual({ x: 1, y: 2, k: 1.5 });
  });

  it("rejects malformed persisted sessions", () => {
    expect(parseSession("{nope")).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, history: { present: { dot: 1 } } }))).toBeNull();
  });
});
