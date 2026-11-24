/** Linear undo/redo history of immutable snapshots. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a new present; the old present becomes undoable and redo is cleared. */
export function pushHistory<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  const past = [...history.past, history.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

/** Replace the present without creating an undo step (coalesced edits, derived updates). */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function checkCanUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function checkCanRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/** Step back; returns the same history when there is nothing to undo. */
export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  const past = history.past.slice(0, -1);
  const previous = history.past[history.past.length - 1];
  return { past, present: previous, future: [history.present, ...history.future] };
}

/** Step forward; returns the same history when there is nothing to redo. */
export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next, future };
}
