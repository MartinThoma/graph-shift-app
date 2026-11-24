/**
 * The graph library: several graphs per browser, each with a stable ID and a
 * user-editable name. The index (names, timestamps, last active graph) lives
 * under one key; every graph's session (history and viewport) under its own
 * key, so saves stay small and a full storage only affects one graph.
 *
 * Every index change re-reads the stored index first, so a second tab that
 * added a graph (e.g. from a share link) is never dropped.
 */
import { buildGraphModel } from "../dot/model";
import { checkSameSharedContent, createSharedDocument, type SharedDocument } from "../share/shareLink";
import { createHistory, pushHistory, type History } from "./history";
import { parseSession, saveSessionTo, STORAGE_KEY as LEGACY_SESSION_KEY, type PersistedSession, type Viewport } from "./storage";
import { createDocStateFromShared, DEFAULT_DOT, type DocState } from "./store";

export const LIBRARY_KEY = "graph-shift:library:v1";
export const GRAPH_KEY_PREFIX = "graph-shift:graph:v1:";
export const DEFAULT_GRAPH_NAME = "Untitled graph";
export const EMPTY_GRAPH_DOT = "digraph {\n  \n}\n";
const MAX_NAME_LENGTH = 120;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 12;

export interface GraphMeta {
  /** Stable for the graph's lifetime; renaming never changes it, and share links carry it. */
  id: string;
  name: string;
  /** The name follows the DOT graph name until the user renames the graph. */
  autoName?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Library {
  version: 1;
  /** The graph opened on the next start. */
  activeId: string;
  graphs: GraphMeta[];
}

/**
 * A random ID from `crypto.getRandomValues`, which (unlike `crypto.randomUUID`)
 * also exists on plain-HTTP LAN addresses.
 */
export function createGraphId(fillRandom: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = fillRandom(new Uint8Array(ID_LENGTH));
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

/** IDs from storage or links are untrusted: short, URL-safe characters only. */
export function checkGraphId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(value);
}

/** Trim and shorten a name; returns "" for a blank one. */
export function normalizeGraphName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** A name for a graph without one: its DOT name (`digraph checkout`), else "Untitled graph". */
export function createDefaultName(dot: string): string {
  try {
    return normalizeGraphName(buildGraphModel(dot).name) || DEFAULT_GRAPH_NAME;
  } catch {
    return DEFAULT_GRAPH_NAME;
  }
}

/**
 * The name an auto-named graph should carry for its (valid) DOT graph name,
 * kept unique against the other graphs; null when it should stay as it is.
 */
export function deriveAutoName(meta: GraphMeta, dotName: string | null, graphs: GraphMeta[]): string | null {
  if (!meta.autoName || dotName === null) return null;
  const name = createUniqueName(normalizeGraphName(dotName) || DEFAULT_GRAPH_NAME, graphs.filter((g) => g.id !== meta.id));
  return name === meta.name ? null : name;
}

/** `base`, or `base 2`, `base 3`, … whichever no other graph uses yet. */
export function createUniqueName(base: string, graphs: GraphMeta[]): string {
  const taken = new Set(graphs.map((g) => g.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function createGraphKey(id: string): string {
  return GRAPH_KEY_PREFIX + id;
}

function checkGraphMeta(value: unknown): value is GraphMeta {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return checkGraphId(v.id) && typeof v.name === "string" && typeof v.createdAt === "number" && typeof v.updatedAt === "number";
}

/** Parse and validate a stored index; null for anything unusable. */
export function parseLibrary(raw: string | null): Library | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Library>;
    if (data?.version !== 1 || !Array.isArray(data.graphs)) return null;
    const seen = new Set<string>();
    const graphs: GraphMeta[] = [];
    for (const g of data.graphs) {
      if (!checkGraphMeta(g) || seen.has(g.id)) continue;
      seen.add(g.id);
      graphs.push({
        id: g.id,
        name: normalizeGraphName(g.name) || DEFAULT_GRAPH_NAME,
        ...(g.autoName === true ? { autoName: true } : {}),
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      });
    }
    if (!graphs.length) return null;
    const activeId = graphs.some((g) => g.id === data.activeId) ? data.activeId! : graphs[0].id;
    return { version: 1, activeId, graphs };
  } catch {
    return null;
  }
}

export function getStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readItem(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeItem(storage: Storage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadLibrary(storage: Storage | null = getStorage()): Library | null {
  return parseLibrary(readItem(storage, LIBRARY_KEY));
}

export function saveLibrary(library: Library, storage: Storage | null = getStorage()): boolean {
  return writeItem(storage, LIBRARY_KEY, JSON.stringify(library));
}

export function loadGraphSession(id: string, storage: Storage | null = getStorage()): PersistedSession | null {
  return parseSession(readItem(storage, createGraphKey(id)));
}

export function saveGraphSession(
  id: string,
  history: History<DocState>,
  viewport: Viewport | null,
  storage: Storage | null = getStorage(),
): boolean {
  return saveSessionTo(createGraphKey(id), history, viewport, storage);
}

function createFreshLibrary(storage: Storage | null, now: number): Library {
  const legacy = parseSession(readItem(storage, LEGACY_SESSION_KEY));
  const id = createGraphId();
  const history = legacy?.history ?? createHistory<DocState>(createDocStateFromShared({ dot: DEFAULT_DOT, engine: "hierarchical" }));
  const meta: GraphMeta = {
    id,
    name: createDefaultName(history.present.dot),
    autoName: true,
    createdAt: legacy?.savedAt || now,
    updatedAt: legacy?.savedAt || now,
  };
  const library: Library = { version: 1, activeId: id, graphs: [meta] };
  // Remove the single-graph session only once its replacement is stored.
  if (saveGraphSession(id, history, legacy?.viewport ?? null, storage) && saveLibrary(library, storage) && legacy) {
    try {
      storage?.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // keep it; it is migrated again only if the index disappears
    }
  }
  return library;
}

/**
 * A tab still running a pre-library version keeps saving to the old key after
 * the migration. Bring such edits in as their own graph (unless a graph already
 * has exactly that text), so updating never loses work.
 */
function importLegacySession(library: Library, storage: Storage | null, now: number): Library {
  const legacy = parseSession(readItem(storage, LEGACY_SESSION_KEY));
  if (!legacy) return library;
  const dot = legacy.history.present.dot;
  const known = library.graphs.some((g) => loadGraphSession(g.id, storage)?.history.present.dot === dot);
  let next = library;
  if (!known) {
    const name = createUniqueName(createDefaultName(dot), library.graphs);
    next = addGraph(library, { name, autoName: true, history: legacy.history, viewport: legacy.viewport }, storage, now).library;
  }
  try {
    storage?.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // storage unavailable
  }
  return next;
}

/** Load the index, migrating a pre-library session (or starting with the sample graph) when there is none. */
export function initializeLibrary(storage: Storage | null = getStorage(), now = Date.now()): Library {
  const library = loadLibrary(storage);
  return library ? importLegacySession(library, storage, now) : createFreshLibrary(storage, now);
}

/**
 * Change the index: re-read what is stored (another tab may have changed it),
 * apply `change`, save, and return the result.
 */
export function updateLibrary(fallback: Library, change: (library: Library) => Library, storage: Storage | null = getStorage()): Library {
  const next = change(loadLibrary(storage) ?? fallback);
  saveLibrary(next, storage);
  return next;
}

/** Store a new graph and make it the active one. With storage full, nothing is added (`saved: false`). */
export function addGraph(
  fallback: Library,
  input: { id?: string; name: string; autoName?: boolean; history: History<DocState>; viewport?: Viewport | null },
  storage: Storage | null = getStorage(),
  now = Date.now(),
): { library: Library; meta: GraphMeta; saved: boolean } {
  let id = input.id && checkGraphId(input.id) ? input.id : createGraphId();
  const current = loadLibrary(storage) ?? fallback;
  while (current.graphs.some((g) => g.id === id)) id = createGraphId();
  const meta: GraphMeta = {
    id,
    name: normalizeGraphName(input.name) || DEFAULT_GRAPH_NAME,
    ...(input.autoName ? { autoName: true } : {}),
    createdAt: now,
    updatedAt: now,
  };
  if (!saveGraphSession(id, input.history, input.viewport ?? null, storage)) return { library: current, meta, saved: false };
  const library = updateLibrary(fallback, (lib) => ({ ...lib, activeId: id, graphs: [...lib.graphs.filter((g) => g.id !== id), meta] }), storage);
  return { library, meta, saved: true };
}

/** Remove a graph and its session. The active graph moves to the most recently edited remaining one. */
export function removeGraph(fallback: Library, id: string, storage: Storage | null = getStorage()): Library {
  try {
    storage?.removeItem(createGraphKey(id));
  } catch {
    // storage unavailable
  }
  return updateLibrary(
    fallback,
    (lib) => {
      const graphs = lib.graphs.filter((g) => g.id !== id);
      const activeId = lib.activeId !== id ? lib.activeId : ([...graphs].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? "");
      return { ...lib, graphs, activeId };
    },
    storage,
  );
}

/** Record a graph in the index (re-adding it if another tab removed it) with a new timestamp and/or name. */
export function touchGraph(
  fallback: Library,
  meta: GraphMeta,
  patch: Partial<Pick<GraphMeta, "name" | "autoName" | "updatedAt">>,
  storage: Storage | null = getStorage(),
): Library {
  return updateLibrary(
    fallback,
    (lib) => {
      const existing = lib.graphs.find((g) => g.id === meta.id) ?? meta;
      const next = { ...existing, ...patch };
      const graphs = lib.graphs.some((g) => g.id === meta.id) ? lib.graphs.map((g) => (g.id === meta.id ? next : g)) : [...lib.graphs, next];
      return { ...lib, graphs };
    },
    storage,
  );
}

export type SharedOpenDecision =
  | { kind: "add" }
  | { kind: "switch"; meta: GraphMeta }
  | { kind: "conflict"; meta: GraphMeta };

/**
 * What opening a share link does: a graph this browser doesn't have is added;
 * a graph it has with the same content is just opened; a graph it has with
 * different content needs the user's decision.
 */
export function decideSharedOpen(library: Library, doc: SharedDocument, loadPresent: (id: string) => DocState | null): SharedOpenDecision {
  const meta = doc.id ? library.graphs.find((g) => g.id === doc.id) : undefined;
  if (!meta) return { kind: "add" };
  const present = loadPresent(meta.id);
  if (present && checkSameSharedContent(createSharedDocument(present), doc)) return { kind: "switch", meta };
  return { kind: "conflict", meta };
}

/** Replace a stored graph's content with a shared one as a new undo step (the old content stays one undo away). */
export function replaceGraphContent(id: string, doc: SharedDocument, storage: Storage | null = getStorage()): boolean {
  const session = loadGraphSession(id, storage);
  const next = createDocStateFromShared(doc);
  const history = session ? pushHistory(session.history, next) : createHistory(next);
  return saveGraphSession(id, history, null, storage);
}
