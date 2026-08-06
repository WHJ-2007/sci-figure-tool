import { create } from "zustand";
import type { CanvasDocument, CanvasElement, ToolType } from "./types";
import type { ChartSpec } from "./chartLayout";
import { createHistory, pushHistory, undo as undoHistory, redo as redoHistory, type HistoryState } from "./history";
import { loadProjects, makeProject, defaultProjectName, saveProjects, type CanvasProject } from "./projects";
import { estimateTextSize, logicBoxSize } from "./elements";

function maxZIndex(elements: CanvasElement[]): number {
  let max = 0;
  for (const e of elements) if (e.zIndex > max) max = e.zIndex;
  return max;
}

// 非阻塞生成：AI 快照只含服务端 draft 的元素；用户生成中本地新增的元素（非基线、非 AI 触碰、不在快照）
// 必须保留，否则每个 snapshot 会把用户刚画的元素冲掉
function mergePreserved(current: CanvasDocument, locked: string[], baseline: string[], snapshot: CanvasElement[]): CanvasElement[] {
  const snapshotIds = new Set(snapshot.map((e) => e.id));
  const base = new Set(baseline);
  const lock = new Set(locked);
  const preserved = current.elements.filter((e) => !snapshotIds.has(e.id) && !base.has(e.id) && !lock.has(e.id));
  return [...preserved, ...snapshot];
}

// 顶层 doc/history 语义 = 当前项目；所有画布内容变更经此写回 projects（供持久化）。
// restoredProjects 在任意内容变更时清空：新操作打断「重新删除已恢复画布」的重做链
function syncProject(
  s: Pick<CanvasStore, "projects" | "currentProjectId" | "doc" | "history">,
  doc: CanvasDocument,
  history: HistoryState
) {
  return {
    doc,
    history,
    projects: s.projects.map((p) => (p.id === s.currentProjectId ? { ...p, doc, history } : p)),
    restoredProjects: [] as DeletedProject[],
  };
}

// 删除的画布（撤销恢复用）：wasCurrent 记录删除时是否处于当前画布，
// 恢复时若删除的是当前画布则切回（用户删除后被迫切走，undo 应把视野带回来）
interface DeletedProject {
  project: CanvasProject;
  idx: number;
  wasCurrent: boolean;
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
  aiLockedIds: string[];
  aiBaselineIds: string[];
  deletedProjects: DeletedProject[];
  restoredProjects: DeletedProject[];
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
  setBackground: (bg: string | undefined) => void;
  setDoc: (doc: CanvasDocument) => void;
  applyChartEdit: (chartId: string, spec: ChartSpec, elements: CanvasElement[], replaceIds: string[]) => void;
  applyAISnapshot: (doc: CanvasDocument) => void;
  applyAIResult: (doc: CanvasDocument, baseline: CanvasDocument) => void;
  setAiLocked: (ids: string[]) => void;
  setAiBaseline: (ids: string[]) => void;
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
    aiLockedIds: [],
    aiBaselineIds: [],
    deletedProjects: [],
    restoredProjects: [],

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
          if (next.type === "logic" && ("text" in patch || "body" in patch || "fontSize" in patch || "bold" in patch)) {
            const size = logicBoxSize(next.text, next.body, next.fontSize, next.bold);
            return {
              ...next,
              width: Math.max(next.width, size.width),
              height: Math.max(next.height, size.height),
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
          // 箭头折点为相对坐标，整体移动时自动跟随（x/y 平移即够）
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
    // 画布样式（右键画布菜单）：一步撤销，随画布持久化
    setBackground: (bg) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        if (bg) doc.background = bg;
        else delete doc.background;
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
      }),
    // 图表数据编辑（手动生成/编辑共用）：替换指定 chartId 的旧元素 + 登记 spec，一次手势 = 一步撤销
    applyChartEdit: (chartId, spec, elements, replaceIds) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        let z = maxZIndex(doc.elements);
        const copies = elements.map((e) => {
          const c = structuredClone(e);
          c.zIndex = ++z;
          return c;
        });
        doc.elements = [...doc.elements.filter((e) => !replaceIds.includes(e.id)), ...copies];
        doc.charts = { ...(doc.charts ?? {}), [chartId]: spec };
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)), selection: [] };
      }),
    setAiLocked: (ids) => set({ aiLockedIds: [...ids] }),
    setAiBaseline: (ids) => set({ aiBaselineIds: [...ids] }),
    // AI 生成中的中间快照：替换画布但不入撤销栈，生成完成后的 applyAIResult 才作为整体一步；
    // 快照只含 AI 草稿元素，合并保留用户生成中本地新增的元素（非基线、非 AI 触碰、不在快照）
    applyAISnapshot: (doc) =>
      set((s) => {
        const next = structuredClone(doc);
        next.elements = mergePreserved(s.doc, s.aiLockedIds, s.aiBaselineIds, next.elements);
        return { ...syncProject(s, next, s.history), selection: [], editingText: null };
      }),
    // AI 生成完成：入栈"生成前基线"（快照中间态不入栈，undo 一步回到生成前），再替换为最终画布
    applyAIResult: (doc, baseline) =>
      set((s) => {
        const next = structuredClone(doc);
        next.elements = mergePreserved(s.doc, s.aiLockedIds, s.aiBaselineIds, next.elements);
        return { ...syncProject(s, next, pushHistory(s.history, baseline)), selection: [], editingText: null };
      }),
    undo: () =>
      set((s) => {
        // 画布级撤销优先：恢复最近删除的画布到原位（删除的是当前画布则切回），入恢复栈供 redo
        const d = s.deletedProjects;
        if (d.length > 0) {
          const entry = d[d.length - 1];
          const projects = [...s.projects];
          projects.splice(Math.min(entry.idx, projects.length), 0, entry.project);
          const base: Partial<CanvasStore> = {
            projects,
            deletedProjects: d.slice(0, -1),
            restoredProjects: [...s.restoredProjects, entry],
          };
          if (!entry.wasCurrent) return base;
          return {
            ...base,
            currentProjectId: entry.project.id,
            doc: structuredClone(entry.project.doc),
            history: entry.project.history,
            selection: [],
            editingText: null,
          };
        }
        const r = undoHistory(s.history, s.doc);
        return r ? { ...syncProject(s, r.doc, r.history) } : {};
      }),
    redo: () =>
      set((s) => {
        // 画布级重做优先：重新删除最近恢复的画布，回到删除状态（删除的是当前画布则再切走）
        const r = s.restoredProjects;
        if (r.length > 0) {
          const entry = r[r.length - 1];
          const idx = s.projects.findIndex((p) => p.id === entry.project.id);
          if (idx < 0) return {};
          const projects = s.projects.filter((p) => p.id !== entry.project.id);
          const base: Partial<CanvasStore> = {
            projects,
            restoredProjects: r.slice(0, -1),
            deletedProjects: [...s.deletedProjects, { ...entry, idx }],
          };
          // 是否切换按当前状态判断：undo 后用户可能已切到其他画布，redo 不该把他拽走
          if (entry.project.id !== s.currentProjectId) return base;
          const next = projects[Math.min(idx, projects.length - 1)];
          return {
            ...base,
            currentProjectId: next.id,
            doc: structuredClone(next.doc),
            history: next.history,
            selection: [],
            editingText: null,
          };
        }
        const rr = redoHistory(s.history, s.doc);
        return rr ? { ...syncProject(s, rr.doc, rr.history) } : {};
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
        restoredProjects: [],
      }));
      return id;
    },
    renameProject: (id, name) =>
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)), restoredProjects: [] })),
    deleteProject: (id) =>
      set((s) => {
        if (s.projects.length <= 1) return {};
        const idx = s.projects.findIndex((p) => p.id === id);
        if (idx < 0) return {};
        const target = s.projects[idx];
        const wasCurrent = id === s.currentProjectId;
        const projects = s.projects.filter((p) => p.id !== id);
        // 删除入恢复栈（undo 可恢复）；新的删除打断已恢复画布的重做链
        const base: Partial<CanvasStore> = {
          projects,
          deletedProjects: [...s.deletedProjects, { project: target, idx, wasCurrent }],
          restoredProjects: [],
        };
        if (!wasCurrent) return base;
        const next = projects[Math.min(idx, projects.length - 1)];
        return {
          ...base,
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
