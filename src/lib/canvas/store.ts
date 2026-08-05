import { create } from "zustand";
import type { CanvasDocument, CanvasElement, ToolType } from "./types";
import { createHistory, pushHistory, undo as undoHistory, redo as redoHistory, type HistoryState } from "./history";

function maxZIndex(elements: CanvasElement[]): number {
  let max = 0;
  for (const e of elements) if (e.zIndex > max) max = e.zIndex;
  return max;
}

export interface CanvasStore {
  doc: CanvasDocument;
  selection: string[];
  tool: ToolType;
  isGenerating: boolean;
  editingText: string | null;
  view: { scale: number; ox: number; oy: number };
  history: HistoryState;
  addElement: (e: CanvasElement) => void;
  addElements: (list: CanvasElement[]) => void;
  updateElement: (id: string, patch: Partial<CanvasElement>) => void;
  updateElementFast: (id: string, patch: Partial<CanvasElement>) => void;
  deleteElements: (ids: string[]) => void;
  moveElements: (ids: string[], dx: number, dy: number) => void;
  commitHistory: () => void;
  setSelection: (ids: string[]) => void;
  setTool: (t: ToolType) => void;
  setView: (v: { scale: number; ox: number; oy: number }) => void;
  setDoc: (doc: CanvasDocument) => void;
  applyAISnapshot: (doc: CanvasDocument) => void;
  applyAIResult: (doc: CanvasDocument, baseline: CanvasDocument) => void;
  setGenerating: (v: boolean) => void;
  setEditingText: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
}

export const useCanvasStore = create<CanvasStore>()((set) => {
  const initial: CanvasStore = {
    doc: { width: 1600, height: 1000, elements: [] },
    selection: [],
    tool: "select",
    isGenerating: false,
    editingText: null,
    view: { scale: 1, ox: 0, oy: 0 },
    history: createHistory(),

    addElement: (e) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const copy = structuredClone(e);
        copy.zIndex = maxZIndex(doc.elements) + 1;
        doc.elements = [...doc.elements, copy];
        return { history: pushHistory(s.history, s.doc), doc };
      }),
    addElements: (list) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        let z = maxZIndex(doc.elements);
        const copies = list.map((e) => {
          const copy = structuredClone(e);
          copy.zIndex = ++z;
          return copy;
        });
        doc.elements = [...doc.elements, ...copies];
        return { history: pushHistory(s.history, s.doc), doc };
      }),
    updateElement: (id, patch) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        let changed = false;
        doc.elements = doc.elements.map((e) => {
          if (e.id !== id) return e;
          changed = true;
          return { ...e, ...patch } as CanvasElement;
        });
        return changed ? { history: pushHistory(s.history, s.doc), doc } : { doc };
      }),
    updateElementFast: (id, patch) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CanvasElement) : e));
        return { doc };
      }),
    deleteElements: (ids) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const count = doc.elements.length;
        doc.elements = doc.elements.filter((e) => !ids.includes(e.id));
        if (doc.elements.length === count) return { doc };
        return {
          history: pushHistory(s.history, s.doc),
          doc,
          selection: [],
          editingText: s.editingText && ids.includes(s.editingText) ? null : s.editingText,
        };
      }),
    moveElements: (ids, dx, dy) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => {
          if (!ids.includes(e.id)) return e;
          if (e.type === "polyline") {
            return { ...e, x: e.x + dx, y: e.y + dy, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
          }
          return { ...e, x: e.x + dx, y: e.y + dy };
        });
        return { doc };
      }),
    commitHistory: () => set((s) => ({ history: pushHistory(s.history, s.doc) })),

    setSelection: (ids) => set({ selection: [...ids] }),
    setTool: (t) => set({ tool: t }),
    setView: (v) => set({ view: { ...v } }),
    setEditingText: (id) => set({ editingText: id }),
    setGenerating: (v) => set({ isGenerating: v }),
    setDoc: (doc) =>
      set((s) => ({ history: pushHistory(s.history, s.doc), doc: structuredClone(doc), selection: [], editingText: null })),
    // AI 生成中的中间快照：替换画布但不入撤销栈，生成完成后的 applyAIResult 才作为整体一步
    applyAISnapshot: (doc) =>
      set(() => ({ doc: structuredClone(doc), selection: [], editingText: null })),
    // AI 生成完成：入栈"生成前基线"（快照中间态不入栈，undo 一步回到生成前），再替换为最终画布
    applyAIResult: (doc, baseline) =>
      set((s) => ({
        history: pushHistory(s.history, baseline),
        doc: structuredClone(doc),
        selection: [],
        editingText: null,
      })),
    undo: () =>
      set((s) => {
        const r = undoHistory(s.history, s.doc);
        return r ? { history: r.history, doc: r.doc } : {};
      }),
    redo: () =>
      set((s) => {
        const r = redoHistory(s.history, s.doc);
        return r ? { history: r.history, doc: r.doc } : {};
      }),
  };
  return initial;
});
