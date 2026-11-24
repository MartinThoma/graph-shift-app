/** localStorage persistence of the editing session. */
import { checkLayoutEngine } from "../layout/initialLayout";
import type { History } from "./history";
import type { DocState } from "./store";

export const STORAGE_KEY = "graph-shift:session:v1";
const PERSISTED_HISTORY = 50;

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface PersistedSession {
  version: 1;
  history: History<DocState>;
  viewport: Viewport | null;
  savedAt: number;
}

function checkDocState(value: unknown): value is DocState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.dot === "string" &&
    checkLayoutEngine(v.engine) &&
    typeof v.positions === "object" &&
    v.positions !== null &&
    typeof v.routes === "object" &&
    v.routes !== null &&
    Array.isArray(v.manualNodes) &&
    typeof v.hasManualChanges === "boolean"
  );
}

/** Serialize the session (history trimmed to keep storage small). */
export function serializeSession(history: History<DocState>, viewport: Viewport | null): string {
  const session: PersistedSession = {
    version: 1,
    history: {
      past: history.past.slice(-PERSISTED_HISTORY),
      present: history.present,
      future: history.future.slice(0, PERSISTED_HISTORY),
    },
    viewport,
    savedAt: Date.now(),
  };
  return JSON.stringify(session);
}

/** Parse and validate a stored session; returns null for anything malformed. */
export function parseSession(raw: string | null): PersistedSession | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PersistedSession;
    if (data?.version !== 1 || !data.history || !checkDocState(data.history.present)) return null;
    const past = Array.isArray(data.history.past) ? data.history.past.filter(checkDocState) : [];
    const future = Array.isArray(data.history.future) ? data.history.future.filter(checkDocState) : [];
    const vp = data.viewport;
    const viewport =
      vp && [vp.x, vp.y, vp.k].every((n) => typeof n === "number" && Number.isFinite(n)) && vp.k > 0 ? vp : null;
    return { version: 1, history: { past, present: data.history.present, future }, viewport, savedAt: data.savedAt ?? 0 };
  } catch {
    return null;
  }
}

export function loadSession(storage: Storage | null = getStorage()): PersistedSession | null {
  try {
    return parseSession(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Save the session; returns false when storage is unavailable or full. */
export function saveSession(history: History<DocState>, viewport: Viewport | null, storage: Storage | null = getStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeSession(history, viewport));
    return true;
  } catch {
    // Quota exceeded: retry without history.
    try {
      storage.setItem(STORAGE_KEY, serializeSession({ past: [], present: history.present, future: [] }, viewport));
      return true;
    } catch {
      return false;
    }
  }
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
