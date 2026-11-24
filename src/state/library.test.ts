import { describe, expect, it } from "vitest";
import { createHistory } from "./history";
import {
  addGraph,
  checkGraphId,
  createDefaultName,
  createGraphId,
  createGraphKey,
  createUniqueName,
  decideSharedOpen,
  deriveAutoName,
  initializeLibrary,
  LIBRARY_KEY,
  loadGraphSession,
  loadLibrary,
  parseLibrary,
  removeGraph,
  replaceGraphContent,
  saveGraphSession,
  touchGraph,
  type GraphMeta,
} from "./library";
import { serializeSession, STORAGE_KEY } from "./storage";
import { createDocStateFromShared, DEFAULT_DOT, type DocState } from "./store";

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

function createDoc(dot: string, extra: Partial<DocState> = {}): DocState {
  return { ...createDocStateFromShared({ dot, engine: "hierarchical" }), ...extra };
}

function createMeta(id: string, name: string, updatedAt = 1): GraphMeta {
  return { id, name, createdAt: 1, updatedAt };
}

describe("Graph library", () => {
  it("A pre-library session becomes the first graph, and the old key is removed only after the move.", () => {
    const storage = createMemoryStorage();
    const history = createHistory(createDoc("digraph billing { a -> b }"));
    storage.setItem(STORAGE_KEY, serializeSession(history, { x: 1, y: 2, k: 1 }));
    const library = initializeLibrary(storage, 1000);
    expect(library.graphs).toHaveLength(1);
    expect(library.graphs[0].name).toBe("billing");
    expect(library.activeId).toBe(library.graphs[0].id);
    const session = loadGraphSession(library.activeId, storage)!;
    expect(session.history.present.dot).toBe("digraph billing { a -> b }");
    expect(session.viewport).toEqual({ x: 1, y: 2, k: 1 });
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    // A second start finds the library and keeps the same ID.
    expect(initializeLibrary(storage).activeId).toBe(library.activeId);
  });

  it("Edits a tab of the old version saved after the migration are added as a graph, not lost.", () => {
    const storage = createMemoryStorage();
    const library = initializeLibrary(storage);
    const sample = loadGraphSession(library.activeId, storage)!.history;
    // The old tab saves the unchanged sample again: nothing new to keep.
    storage.setItem(STORAGE_KEY, serializeSession(sample, null));
    expect(initializeLibrary(storage).graphs).toHaveLength(1);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    // The old tab saves real edits: they become a graph of their own.
    storage.setItem(STORAGE_KEY, serializeSession(createHistory(createDoc("digraph checkout { late -> edit }")), null));
    const next = initializeLibrary(storage);
    expect(next.graphs.map((g) => g.name)).toEqual(["checkout", "checkout 2"]);
    expect(loadGraphSession(next.activeId, storage)!.history.present.dot).toBe("digraph checkout { late -> edit }");
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("A first start without any saved data opens the sample graph.", () => {
    const storage = createMemoryStorage();
    const library = initializeLibrary(storage);
    expect(library.graphs[0].name).toBe("checkout");
    expect(loadGraphSession(library.activeId, storage)!.history.present.dot).toBe(DEFAULT_DOT);
  });

  it("Graph IDs are random URL-safe strings made without crypto.randomUUID.", () => {
    let counter = 0;
    const id = createGraphId((bytes) => bytes.map(() => counter++));
    expect(id).toBe("0123456789ab");
    expect(checkGraphId(createGraphId())).toBe(true);
    expect(createGraphId()).not.toBe(createGraphId());
    expect(checkGraphId("../../x")).toBe(false);
    expect(checkGraphId("ab")).toBe(false);
  });

  it("Default names come from the DOT graph name, and new names never repeat an existing one.", () => {
    expect(createDefaultName("digraph checkout { a }")).toBe("checkout");
    expect(createDefaultName("digraph { a }")).toBe("Untitled graph");
    expect(createDefaultName("not dot")).toBe("Untitled graph");
    const graphs = [createMeta("aaaa", "Untitled graph"), createMeta("bbbb", "untitled graph 2")];
    expect(createUniqueName("Untitled graph", graphs)).toBe("Untitled graph 3");
    expect(createUniqueName("checkout", graphs)).toBe("checkout");
  });

  it("A malformed stored index is ignored and bad entries are dropped.", () => {
    expect(parseLibrary("{nope")).toBeNull();
    expect(parseLibrary(JSON.stringify({ version: 1, graphs: [] }))).toBeNull();
    const parsed = parseLibrary(
      JSON.stringify({ version: 1, activeId: "zzzz", graphs: [createMeta("aaaa", "A"), { id: "../x", name: "bad" }, createMeta("aaaa", "dup")] }),
    )!;
    expect(parsed.graphs.map((g) => g.name)).toEqual(["A"]);
    expect(parsed.activeId).toBe("aaaa");
  });

  it("Index changes re-read storage, so a graph another tab added is kept.", () => {
    const storage = createMemoryStorage();
    const library = initializeLibrary(storage);
    const stale = library;
    // Another tab adds a graph.
    addGraph(library, { name: "From link", history: createHistory(createDoc("digraph { x }")) }, storage);
    // This tab, still holding the stale index, renames its own graph.
    const next = touchGraph(stale, stale.graphs[0], { name: "Renamed" }, storage);
    expect(next.graphs.map((g) => g.name).sort()).toEqual(["From link", "Renamed"]);
    expect(loadLibrary(storage)!.graphs).toHaveLength(2);
  });

  it("Adding a graph keeps a free link ID but never reuses a taken one.", () => {
    const storage = createMemoryStorage();
    const library = initializeLibrary(storage);
    const added = addGraph(library, { id: "shared-id-1", name: "Shared", history: createHistory(createDoc("digraph { x }")) }, storage);
    expect(added.meta.id).toBe("shared-id-1");
    expect(added.library.activeId).toBe("shared-id-1");
    const again = addGraph(added.library, { id: "shared-id-1", name: "Copy", history: createHistory(createDoc("digraph { y }")) }, storage);
    expect(again.meta.id).not.toBe("shared-id-1");
    expect(loadGraphSession("shared-id-1", storage)!.history.present.dot).toBe("digraph { x }");
  });

  it("Deleting the open graph removes its session and opens the most recently edited other graph.", () => {
    const storage = createMemoryStorage();
    let library = initializeLibrary(storage);
    const first = library.activeId;
    library = addGraph(library, { name: "Old", history: createHistory(createDoc("digraph { o }")) }, storage, 50).library;
    library = addGraph(library, { name: "Recent", history: createHistory(createDoc("digraph { r }")) }, storage, 5_000_000_000_000).library;
    const recent = library.activeId;
    library = touchGraph(library, library.graphs.find((g) => g.id === first)!, { updatedAt: 10 }, storage);
    library = removeGraph(library, recent, storage);
    expect(storage.getItem(createGraphKey(recent))).toBeNull();
    expect(library.graphs.map((g) => g.name).sort()).toEqual(["Old", "checkout"]);
    expect(library.activeId).toBe(library.graphs.find((g) => g.name === "Old")!.id);
    expect(JSON.parse(storage.getItem(LIBRARY_KEY)!).graphs).toHaveLength(2);
  });
});

describe("Graph names", () => {
  it("An auto-named graph follows its DOT graph name, stays unique, and keeps its name while the text has an error.", () => {
    const meta = { ...createMeta("aaaa", "checkout"), autoName: true };
    const others = [meta, createMeta("bbbb", "billing")];
    expect(deriveAutoName(meta, "roadmap", others)).toBe("roadmap");
    expect(deriveAutoName(meta, "billing", others)).toBe("billing 2");
    expect(deriveAutoName(meta, "", others)).toBe("Untitled graph");
    expect(deriveAutoName(meta, "checkout", others)).toBeNull();
    expect(deriveAutoName(meta, null, others)).toBeNull();
  });

  it("A renamed graph keeps its name when the DOT graph name changes.", () => {
    const meta = { ...createMeta("aaaa", "My architecture"), autoName: false };
    expect(deriveAutoName(meta, "roadmap", [meta])).toBeNull();
  });

  it("The auto-name flag survives storage.", () => {
    const parsed = parseLibrary(JSON.stringify({ version: 1, activeId: "aaaa", graphs: [{ ...createMeta("aaaa", "A"), autoName: true }] }))!;
    expect(parsed.graphs[0].autoName).toBe(true);
  });
});

describe("Opening share links in the library", () => {
  const library = { version: 1 as const, activeId: "mine0001", graphs: [createMeta("mine0001", "Mine")] };
  const stored = createDoc("digraph { a -> b }", { positions: { a: { x: 1.2, y: 2 }, b: { x: 50, y: 60 } }, manualNodes: ["a"], hasManualChanges: true });

  it("A link without an ID, or with an unknown one, adds a new graph.", () => {
    expect(decideSharedOpen(library, { dot: "digraph { a }", engine: "hierarchical" }, () => stored)).toEqual({ kind: "add" });
    expect(decideSharedOpen(library, { id: "other001", dot: "digraph { a }", engine: "hierarchical" }, () => stored)).toEqual({ kind: "add" });
  });

  it("A link to a graph this browser has with the same content just opens it.", () => {
    const doc = {
      id: "mine0001",
      name: "Their name",
      dot: "digraph { a -> b }",
      engine: "hierarchical" as const,
      positions: { b: { x: 50, y: 60 }, a: { x: 1, y: 2 } },
      routes: {},
      manualNodes: ["a"],
    };
    expect(decideSharedOpen(library, doc, () => stored)).toMatchObject({ kind: "switch" });
  });

  it("A link to a graph this browser has with different content asks before replacing.", () => {
    const doc = { id: "mine0001", dot: "digraph { a -> b -> c }", engine: "hierarchical" as const };
    expect(decideSharedOpen(library, doc, () => stored)).toMatchObject({ kind: "conflict", meta: { id: "mine0001" } });
    expect(decideSharedOpen(library, { ...doc, dot: "digraph { a -> b }" }, () => stored)).toMatchObject({ kind: "conflict" });
  });

  it("Replacing a graph with shared content keeps the old content one undo step away.", () => {
    const storage = createMemoryStorage();
    saveGraphSession("mine0001", createHistory(stored), null, storage);
    replaceGraphContent("mine0001", { dot: "digraph { z }", engine: "radial" }, storage);
    const history = loadGraphSession("mine0001", storage)!.history;
    expect(history.present.dot).toBe("digraph { z }");
    expect(history.present.engine).toBe("radial");
    expect(history.past.at(-1)!.dot).toBe("digraph { a -> b }");
  });
});
