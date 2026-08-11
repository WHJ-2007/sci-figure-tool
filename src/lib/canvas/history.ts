import type { CanvasDocument } from "./types";

export interface HistoryState {
  past: CanvasDocument[];
  future: CanvasDocument[];
  limit: number;
}

// 无限撤销：不丢弃最旧快照，可一直撤销到最初状态
export const HISTORY_LIMIT = Infinity;

export function createHistory(limit = HISTORY_LIMIT): HistoryState {
  return { past: [], future: [], limit };
}

export function pushHistory(h: HistoryState, doc: CanvasDocument): HistoryState {
  const past = [...h.past, structuredClone(doc)];
  if (past.length > h.limit) past.shift();
  return { past, future: [], limit: h.limit };
}

export function undo(h: HistoryState, doc: CanvasDocument): { history: HistoryState; doc: CanvasDocument } | null {
  if (h.past.length === 0) return null;
  const past = [...h.past];
  const prev = past.pop()!;
  return { history: { past, future: [...h.future, structuredClone(doc)], limit: h.limit }, doc: structuredClone(prev) };
}

export function redo(h: HistoryState, doc: CanvasDocument): { history: HistoryState; doc: CanvasDocument } | null {
  if (h.future.length === 0) return null;
  const future = [...h.future];
  const next = future.pop()!;
  return { history: { past: [...h.past, structuredClone(doc)], future, limit: h.limit }, doc: structuredClone(next) };
}
