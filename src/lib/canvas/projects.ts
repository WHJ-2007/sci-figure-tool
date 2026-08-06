import type { CanvasDocument } from "./types";
import { createHistory, type HistoryState } from "./history";

export interface CanvasProject {
  id: string;
  name: string;
  doc: CanvasDocument;
  history: HistoryState;
}

const STORAGE_KEY = "sci-figure.projects.v1";
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;

// localStorage 只存 [{id,name,doc}]，history 不持久化（刷新后撤销栈为空）
export function saveProjects(projects: CanvasProject[]) {
  try {
    const slim = projects.map(({ id, name, doc }) => ({ id, name, doc }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    // 容量不足（大图片 dataURL 超 localStorage 配额）静默降级：画布数据仍在内存
  }
}

export function loadProjects(): CanvasProject[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as { id: string; name: string; doc: CanvasDocument }[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((p) => ({ id: p.id, name: p.name, doc: p.doc, history: createHistory() }));
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
