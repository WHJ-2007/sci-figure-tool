import type { CanvasDocument } from "./types";
import { createHistory, type HistoryState } from "./history";

export interface CanvasProject {
  id: string;
  name: string;
  doc: CanvasDocument;
  history: HistoryState;
  // 上次离开该画布时的视口（缩放/平移），切换画布或刷新后恢复
  view?: { scale: number; ox: number; oy: number };
}

const STORAGE_KEY = "sci-figure.projects.v1";
// 上次离开时的画布 id：刷新后恢复到原画布（与项目数据分开存，避免全量重写）
const CURRENT_KEY = "sci-figure.current-project.v1";
// 各画布的视口（缩放/平移）：独立键存储——视口变化不写回 projects（避免触发瞬时保存误判）
const VIEW_KEY = "sci-figure.views.v1";
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;

// localStorage 只存 [{id,name,doc,view}]，history 不持久化（刷新后撤销栈为空）
export function saveProjects(projects: CanvasProject[]) {
  try {
    const slim = projects.map(({ id, name, doc, view }) => ({ id, name, doc, view }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    // 容量不足（大图片 dataURL 超 localStorage 配额）静默降级：画布数据仍在内存
  }
}

export function loadProjects(): CanvasProject[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as { id: string; name: string; doc: CanvasDocument; view?: { scale: number; ox: number; oy: number } }[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((p) => ({ id: p.id, name: p.name, doc: p.doc, view: p.view, history: createHistory() }));
  } catch {
    return null;
  }
}

export function saveCurrentProject(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // 容量/隐私模式异常静默降级：下次打开默认回到第一张画布
  }
}

// 返回上次离开时的画布 id；记录缺失或指向已删除的画布时返回 null（回退默认第一张）
export function loadCurrentProjectId(projects: CanvasProject[]): string | null {
  try {
    const id = localStorage.getItem(CURRENT_KEY);
    if (!id) return null;
    return projects.some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

// localStorage 里是否已有画布数据（容量超限被静默降级时返回 false——此时刷新会生成新随机画布 id，
// 按画布 id 存储的对话键 chatThreads-{id} 全部失配导致历史对话"消失"，需要从文件备份恢复）
export function hasStoredProjects(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

// 画布视口记忆：每个画布记住上次的缩放/平移（独立 localStorage 键，
// 不与 projects 同存——视口变化不触发画布内容保存）
export function saveView(projectId: string, view: { scale: number; ox: number; oy: number }) {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, { scale: number; ox: number; oy: number }>) : {};
    map[projectId] = view;
    localStorage.setItem(VIEW_KEY, JSON.stringify(map));
  } catch {
    // 容量/隐私模式异常静默降级：下次打开回到默认视口
  }
}

export function loadView(projectId: string): { scale: number; ox: number; oy: number } | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { scale: number; ox: number; oy: number }>;
    return map[projectId] ?? null;
  } catch {
    return null;
  }
}

export function makeProject(name: string): CanvasProject {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    doc: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, elements: [] },
    history: createHistory(),
  };
}

export function defaultProjectName(existing: CanvasProject[]): string {
  let max = 0;
  for (const p of existing) {
    const m = /^画布\s*(\d+)$/.exec(p.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `画布 ${max + 1}`;
}
