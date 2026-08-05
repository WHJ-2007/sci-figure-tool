import { create } from "zustand";
import type { CanvasDocument, CanvasElement, ToolType } from "./types";
import { createHistory, pushHistory, undo as undoHistory, redo as redoHistory, type HistoryState } from "./history";
import { loadProjects, makeProject, defaultProjectName, saveProjects, type CanvasProject } from "./projects";
import { estimateTextSize } from "./elements";

function maxZIndex(elements: CanvasElement[]): number {
  let max = 0;
  for (const e of elements) if (e.zIndex > max) max = e.zIndex;
  return max;
}

// 顶层 doc/history 语义 = 当前项目；所有画布内容变更经此写回 projects（供持久化）
function syncProject(
  s: Pick<CanvasStore, "projects" | "currentProjectId" | "doc" | "history">,
  doc: CanvasDocument,
  history: HistoryState
) {
  return {
    doc,
    history,
    projects: s.projects.map((p) => (p.id === s.currentProjectId ? { ...p, doc, history } : p)),
  };
}

const EMPTY_VIEW = { scale: 1, ox: 0, oy: 0 };

export interface CanvasStore {
  doc: CanvasDocument;
  selection: string[];
  tool: ToolType;
  isGenerating: boolean;
  editingText: string | null;
  view: { scale: number; ox: number; oy: number };
  history: HistoryState;
  projects: CanvasProject[];
  currentProjectId: string;
  activity: string[];
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
  setActivity: (a: string[]) => void;
  undo: () => void;
  redo: () => void;
  createProject: () => string;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setCurrentProject: (id: string) => void;
}

export const useCanvasStore = create<CanvasStore>()((set, get) => {
  const saved = typeof window !== "undefined" ? loadProjects() : null;
  const projects = saved ?? [makeProject("画布 1")];
  const initial: CanvasStore = {
    doc: structuredClone(projects[0].doc),
    selection: [],
    tool: "select",
    isGenerating: false,
    editingText: null,
    view: { ...EMPTY_VIEW },
    history: projects[0].history,
    projects,
    currentProjectId: projects[0].id,
    activity: [],

    addElement: (e) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const copy = structuredClone(e);
        copy.zIndex = maxZIndex(doc.elements) + 1;
        doc.elements = [...doc.elements, copy];
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
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
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
      }),
    updateElement: (id, patch) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        let changed = false;
        doc.elements = doc.elements.map((e) => {
          if (e.id !== id) return e;
          changed = true;
          const next = { ...e, ...patch } as CanvasElement;
          // 文字内容/字号/加粗变化 → 重算文字宽高（选中框与视觉一致）；
          // 逻辑节点标题变长 → 框宽随标题扩展（左侧固定），保证"文字与框大小匹配"
          if (next.type === "text" && ("text" in patch || "fontSize" in patch || "bold" in patch)) {
            const size = estimateTextSize(next.text, next.fontSize, next.bold);
            return { ...next, width: size.width, height: size.height };
          }
          if (next.type === "logic" && ("text" in patch || "fontSize" in patch || "bold" in patch)) {
            const size = estimateTextSize(next.text, next.fontSize, next.bold);
            return {
              ...next,
              width: Math.max(next.width, size.width + 16),
              height: Math.max(next.height, size.height + 10),
            };
          }
          return next;
        });
        if (!changed) return { doc };
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
      }),
    updateElementFast: (id, patch) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CanvasElement) : e));
        return { ...syncProject(s, doc, s.history) };
      }),
    deleteElements: (ids) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const count = doc.elements.length;
        doc.elements = doc.elements.filter((e) => !ids.includes(e.id));
        if (doc.elements.length === count) return { doc };
        return {
          ...syncProject(s, doc, pushHistory(s.history, s.doc)),
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
        return { ...syncProject(s, doc, s.history) };
      }),
    commitHistory: () => set((s) => ({ ...syncProject(s, s.doc, pushHistory(s.history, s.doc)) })),

    setSelection: (ids) => set({ selection: [...ids] }),
    setTool: (t) => set({ tool: t }),
    setActivity: (a) => set({ activity: [...a] }),
    setView: (v) => set({ view: { ...v } }),
    setEditingText: (id) => set({ editingText: id }),
    setGenerating: (v) => set({ isGenerating: v }),
    setDoc: (doc) =>
      set((s) => ({ ...syncProject(s, structuredClone(doc), pushHistory(s.history, s.doc)), selection: [], editingText: null })),
    // AI 生成中的中间快照：替换画布但不入撤销栈，生成完成后的 applyAIResult 才作为整体一步
    applyAISnapshot: (doc) =>
      set((s) => ({ ...syncProject(s, structuredClone(doc), s.history), selection: [], editingText: null })),
    // AI 生成完成：入栈"生成前基线"（快照中间态不入栈，undo 一步回到生成前），再替换为最终画布
    applyAIResult: (doc, baseline) =>
      set((s) => ({
        ...syncProject(s, structuredClone(doc), pushHistory(s.history, baseline)),
        selection: [],
        editingText: null,
      })),
    undo: () =>
      set((s) => {
        const r = undoHistory(s.history, s.doc);
        return r ? { ...syncProject(s, r.doc, r.history) } : {};
      }),
    redo: () =>
      set((s) => {
        const r = redoHistory(s.history, s.doc);
        return r ? { ...syncProject(s, r.doc, r.history) } : {};
      }),

    createProject: () => {
      const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const name = defaultProjectName(get().projects);
      set((s) => ({
        projects: [...s.projects, { id, name, doc: { width: 1600, height: 1000, elements: [] }, history: createHistory() }],
        currentProjectId: id,
        doc: { width: 1600, height: 1000, elements: [] },
        history: createHistory(),
        selection: [],
        editingText: null,
        view: { ...EMPTY_VIEW },
      }));
      return id;
    },
    renameProject: (id, name) =>
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)) })),
    deleteProject: (id) =>
      set((s) => {
        if (s.projects.length <= 1) return {};
        const idx = s.projects.findIndex((p) => p.id === id);
        if (idx < 0) return {};
        const projects = s.projects.filter((p) => p.id !== id);
        if (id !== s.currentProjectId) return { projects };
        const next = projects[Math.min(idx, projects.length - 1)];
        return {
          projects,
          currentProjectId: next.id,
          doc: structuredClone(next.doc),
          history: next.history,
          selection: [],
          editingText: null,
        };
      }),
    setCurrentProject: (id) =>
      set((s) => {
        const p = s.projects.find((x) => x.id === id);
        if (!p) return {};
        return {
          currentProjectId: id,
          doc: structuredClone(p.doc),
          history: p.history,
          selection: [],
          editingText: null,
        };
      }),
  };
  return initial;
});

// 画布内容/项目变化 → 300ms 防抖持久化（history 不入存储，saveProjects 内部剥除）
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useCanvasStore.subscribe((s) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProjects(s.projects), 300);
});
