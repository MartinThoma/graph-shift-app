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

describe("GraphStore: multi-node editing", () => {
  it("dragging a group moves all selected nodes by the same offset as one undo step", () => {
    const store = createStore();
    const { a, b } = store.present.positions;
    store.dragNodes({ a: { x: a.x + 50, y: a.y + 20 }, b: { x: b.x + 50, y: b.y + 20 } });
    store.commitDrag(["a", "b"]);
    expect(store.present.positions.a).toEqual({ x: a.x + 50, y: a.y + 20 });
    expect(store.present.positions.b.x - store.present.positions.a.x).toBe(b.x - a.x);
    expect(store.present.manualNodes.sort()).toEqual(["a", "b"]);
    store.undo();
    expect(store.present.positions.a).toEqual(a);
    expect(store.present.positions.b).toEqual(b);
  });

  it("removing several nodes is one undo step", () => {
    const store = createStore();
    expect(store.removeNodes(["a", "c"])).toBe(true);
    expect([...store.getState().model!.nodes.keys()]).toEqual(["b"]);
    store.undo();
    expect(store.present.dot).toBe(DOT);
  });

  it("node attribute changes write back to DOT, and quick repeats coalesce into one undo step", () => {
    let time = 0;
    const store = new GraphStore(
      { dot: DOT, engine: "hierarchical", positions: {}, routes: {}, manualNodes: [], hasManualChanges: false },
      { measure: estimateTextWidth, immediate: true, now: () => time },
    );
    store.setNodeAttributes(["a"], { fillcolor: "#111111", style: "filled" });
    time += 200;
    store.setNodeAttributes(["a"], { fillcolor: "#222222", style: "filled" });
    expect(store.present.dot).toContain('a [fillcolor="#222222", style=filled];');
    expect(store.getState().model!.nodes.get("a")!.attrs.fillcolor).toBe("#222222");
    store.undo();
    expect(store.present.dot).toBe(DOT);
  });

  it("node attribute changes keep hand-placed positions", () => {
    const store = createStore();
    store.dragNode("a", { x: 400, y: 400 });
    store.commitDrag(["a"]);
    store.setNodeAttributes(["a", "b"], { label: "A much longer label" });
    expect(store.present.positions.a).toEqual({ x: 400, y: 400 });
    expect(store.getState().visuals!.nodes.get("b")!.width).toBeGreaterThan(80);
  });
});

describe("GraphStore: layout control", () => {
  it("arranging a selection is one undo step, marks those nodes as placed by hand and leaves others alone", () => {
    const store = createStore("digraph {\n  a -> b;\n  b -> c;\n  c -> d;\n  x -> y;\n}\n");
    const before = { ...store.present.positions };
    expect(store.layoutSelection(["a", "b", "c"], "circular")).toBe(true);
    expect(store.present.positions.x).toEqual(before.x);
    expect(store.present.positions.d).toEqual(before.d);
    expect(store.present.hasManualChanges).toBe(true);
    expect(store.present.manualNodes.sort()).toEqual(["a", "b", "c"]);
    store.undo();
    expect(store.present.positions).toEqual(before);
  });

  it("switching the unconnected-node grid lays out again and is undoable", () => {
    const store = createStore("digraph {\n  a -> b;\n  x;\n}\n");
    expect(store.present.groupIsolated ?? true).toBe(true);
    store.setGroupIsolated(false);
    expect(store.present.groupIsolated).toBe(false);
    store.undo();
    expect(store.present.groupIsolated ?? true).toBe(true);
  });
});

describe("GraphStore: shared graphs", () => {
  it("opening a shared graph is one undo step away from the previous work", () => {
    const store = createStore();
    store.importSharedDocument({ dot: "graph { x -- y }", engine: "circular" });
    expect(store.present.dot).toBe("graph { x -- y }");
    expect(store.present.engine).toBe("circular");
    expect(Object.keys(store.present.positions).sort()).toEqual(["x", "y"]);
    store.undo();
    expect(store.present.dot).toBe(DOT);
  });

  it("shared hand-placed positions are kept exactly", () => {
    const store = createStore();
    store.importSharedDocument({
      dot: "digraph { p -> q }",
      engine: "hierarchical",
      positions: { p: { x: 5, y: 7 }, q: { x: 300, y: 7 } },
      manualNodes: ["q"],
    });
    expect(store.present.positions).toEqual({ p: { x: 5, y: 7 }, q: { x: 300, y: 7 } });
    expect(store.present.hasManualChanges).toBe(true);
  });
});
