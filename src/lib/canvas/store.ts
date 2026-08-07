import { create } from "zustand";
import type { ArrowElement, CanvasDocument, CanvasElement, PenElement, PolylineElement, SectorElement, ToolType } from "./types";
import { layoutChart, niceScale, PLOT, type ChartSpec } from "./chartLayout";
import { elementBounds, anchorToward, shapeExitPoint } from "./geometry";
import { createHistory, pushHistory, undo as undoHistory, redo as redoHistory, type HistoryState } from "./history";
import {
  loadProjects,
  loadCurrentProjectId,
  makeProject,
  defaultProjectName,
  saveProjects,
  saveCurrentProject,
  saveView,
  loadView,
  type CanvasProject,
} from "./projects";
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

// 多选整体旋转：绕选中元素包围盒中心旋转 deg，返回新 doc（null = 未选中 ≥2 个元素）。
// 把选中集视为一个整体刚性旋转：相对位置不变、绕几何中心；位置随旋转（世界坐标），
// rotation 累加；polyline/pen 点列与箭头折点（相对坐标）同步旋转。
// 中心必须用 elementBounds（真实包围盒）——箭头负宽高/polyline/curve/sector/pen 的裸 x/width 会算错中心。
// 入历史与否由调用方决定（rotateSelection 一步撤销 / rotateSelectionFast 拖拽逐帧不入历史）。
function rotateSelected(doc: CanvasDocument, selection: string[], deg: number): CanvasDocument | null {
  if (selection.length < 2) return null;
  const targets = doc.elements.filter((e) => selection.includes(e.id));
  if (targets.length < 2) return null;
  const bs = targets.map((e) => elementBounds(e));
  const minX = Math.min(...bs.map((b) => b.x));
  const maxX = Math.max(...bs.map((b) => b.x + b.width));
  const minY = Math.min(...bs.map((b) => b.y));
  const maxY = Math.max(...bs.map((b) => b.y + b.height));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const nextDoc = structuredClone(doc);
  nextDoc.elements = nextDoc.elements.map((e) => {
    if (!selection.includes(e.id)) return e;
    const dx = e.x - cx;
    const dy = e.y - cy;
    const next = { ...e, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rotation: e.rotation + deg } as CanvasElement;
    if (e.type === "polyline" || e.type === "pen") {
      (next as PolylineElement | PenElement).points = e.points.map((p) => ({
        x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
        y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
      }));
    }
    if (e.type === "arrow" && e.midPoints) {
      (next as ArrowElement).midPoints = e.midPoints.map((m) => ({ ...m, x: m.x * cos - m.y * sin, y: m.x * sin + m.y * cos }));
    }
    return next;
  });
  return nextDoc;
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
  // 元素整体替换（画笔识别等）：fast=true 不入历史（拖拽中逐帧用），缺省入栈替换前快照（一步撤销复原）
  replaceElement: (id: string, el: CanvasElement, opts?: { fast?: boolean }) => void;
  // 多选共享编辑：一次历史把同一 patch 应用到多个元素（text/logic 同步重算宽高）
  updateElements: (ids: string[], patch: Partial<CanvasElement>) => void;
  deleteElements: (ids: string[]) => void;
  moveElements: (ids: string[], dx: number, dy: number) => void;
  reorderElements: (orderedIds: string[]) => void;
  rotateSelection: (deg: number) => void;
  rotateSelectionFast: (deg: number) => void;
  commitHistory: () => void;
  setSelection: (ids: string[]) => void;
  // 组合对象：把多个元素组合为整体（共享 groupId），或移除某组的组合标记
  groupElements: (ids: string[]) => void;
  ungroupElements: (groupId: string) => void;
  setTool: (t: ToolType) => void;
  setView: (v: { scale: number; ox: number; oy: number }) => void;
  setBackground: (bg: string | undefined) => void;
  setDoc: (doc: CanvasDocument) => void;
  applyChartEdit: (chartId: string, spec: ChartSpec, elements: CanvasElement[], replaceIds: string[]) => void;
  // C 图表公式化：拖动联动——拖动中只改数据+被拖元素几何（不入历史），松手后 recomputeChart 整图重排一步入栈
  updateChartDrag: (chartId: string, index: number, value: number) => void;
  // 饼图接缝拖动：拖动 slice index 的起始接缝到 angle，让该接缝精确落在鼠标处（内部接缝调比例、
  // 起始接缝整体旋转），不入历史，松手后 recomputeChart 一步入栈
  updateChartSeamDrag: (chartId: string, index: number, angle: number) => void;
  // baseline = 拖动前快照（交互层在指针按下时捕获）：入栈 baseline 使一步撤销回到拖动前
  recomputeChart: (chartId: string, baseline?: CanvasDocument) => void;
  detachChart: (chartId: string) => void;
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
  // 刷新恢复：进入页面回到上次离开时的画布（记录缺失/画布已删则回退第一张）
  const savedCurrentId = typeof window !== "undefined" ? loadCurrentProjectId(projects) : null;
  const currentId = savedCurrentId ?? projects[0].id;
  const current = projects.find((p) => p.id === currentId) ?? projects[0];
  const initial: CanvasStore = {
    doc: structuredClone(current.doc),
    selection: [],
    tool: "select",
    isGenerating: false,
    editingText: null,
    // 刷新恢复：进入页面恢复上次离开该画布时的视口（缩放/平移，独立键存储）
    view: loadView(current.id) ?? { ...EMPTY_VIEW },
    history: current.history,
    projects,
    currentProjectId: current.id,
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
          // 文本框：改字号/加粗/文字内容不再重算宽高——保留用户设定的框尺寸（可任意移动/缩放的框）；
          // 逻辑节点标题变长 → 框宽随标题扩展（左侧固定），保证"文字与框大小匹配"
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
    // 元素整体替换（画笔识别后把手写笔迹换成规整图形用）：保留 id/zIndex 与层级位置，
    // 入栈"替换前"快照 → 一步撤销回到手写笔迹；不入栈则拖拽中逐帧调用
    replaceElement: (id, el, { fast = false } = {}) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const i = doc.elements.findIndex((e) => e.id === id);
        if (i < 0) return {};
        const next = { ...structuredClone(el), id, zIndex: doc.elements[i].zIndex } as CanvasElement;
        doc.elements[i] = next;
        return fast
          ? { ...syncProject(s, doc, s.history) }
          : { ...syncProject(s, doc, pushHistory(s.history, s.doc)), selection: [id] };
      }),
    // 多选共享编辑：同一 patch 应用到多个元素、一次历史（text/logic 同步重算宽高，与 updateElement 一致）
    updateElements: (ids, patch) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => {
          if (!ids.includes(e.id)) return e;
          const next = { ...e, ...patch } as CanvasElement;
          // 文本框不重算宽高（保留框尺寸，与 updateElement 一致）；逻辑节点按标题/正文自动扩框
          if (next.type === "logic" && ("text" in patch || "body" in patch || "fontSize" in patch || "bold" in patch)) {
            const size = logicBoxSize(next.text, next.body, next.fontSize, next.bold);
            next.width = Math.max(next.width, size.width);
            next.height = Math.max(next.height, size.height);
          }
          return next;
        });
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
      }),
    // 组合为整体对象：给选中的多个元素打同一 groupId（一步撤销）
    groupElements: (ids) =>
      set((s) => {
        if (ids.length < 2) return {};
        const gid = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => (ids.includes(e.id) ? { ...e, groupId: gid } : e));
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)), selection: [...ids] };
      }),
    // 移除组合：清空该组全部元素的 groupId（一步撤销）
    ungroupElements: (groupId) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => (e.groupId === groupId ? { ...e, groupId: undefined } : e));
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
      }),
    // 层级排序：orderedIds 按"顶层在前"排列（第一个 zIndex 最高），未列入的元素保持原相对顺序接到尾部；
    // 一次排序 = 一步撤销（解决遮挡的拖拽排序在 drop 时调用一次）
    reorderElements: (orderedIds) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const byId = new Map(doc.elements.map((e) => [e.id, e]));
        const rest = doc.elements.filter((e) => !orderedIds.includes(e.id)).sort((x, y) => x.zIndex - y.zIndex);
        const list = orderedIds.filter((id) => byId.has(id)).concat(rest.map((e) => e.id));
        doc.elements = list.map((id, i) => ({ ...byId.get(id)!, zIndex: list.length - i }));
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
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
        const moved = new Set(ids);
        doc.elements = doc.elements.map((e) => {
          if (!ids.includes(e.id)) return e;
          if (e.type === "polyline" || e.type === "pen") {
            return { ...e, x: e.x + dx, y: e.y + dy, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
          }
          // 箭头折点为相对坐标，整体移动时自动跟随（x/y 平移即够）
          return { ...e, x: e.x + dx, y: e.y + dy };
        });
        // 锚点连接跟随：startId/endId 指向被移动元素的箭头，用源/目标最新位置精确重算端点
        // （与 connectElements 同款锚点逻辑——anchorToward 优先、其次 shapeExitPoint），
        // 保证移动节点后箭头仍精确贴在形状边缘上
        doc.elements = doc.elements.map((e) => {
          if (e.type !== "arrow") return e;
          const a = e as ArrowElement;
          if (!a.startId && !a.endId) return e;
          const sid = a.startId;
          const eid = a.endId;
          if (!(sid && moved.has(sid)) && !(eid && moved.has(eid))) return e;
          const sEl = sid ? doc.elements.find((x) => x.id === sid) : undefined;
          const tEl = eid ? doc.elements.find((x) => x.id === eid) : undefined;
          if (!sEl || !tEl) return e;
          const from: { x: number; y: number } = { x: sEl.x + sEl.width / 2, y: sEl.y + sEl.height / 2 };
          const to: { x: number; y: number } = { x: tEl.x + tEl.width / 2, y: tEl.y + tEl.height / 2 };
          if (from.x === to.x && from.y === to.y) return e;
          const p1 = anchorToward(sEl, to) ?? shapeExitPoint(sEl, from, to) ?? from;
          const p2 = anchorToward(tEl, from) ?? shapeExitPoint(tEl, from, to) ?? to;
          return { ...a, x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y } as CanvasElement;
        });
        // 整张图整体移动时同步 charts[chartId].at：否则编辑数据重排（recomputeChart/applyChartEdit）
        // 会按旧 at 生成，图表跳回移动前位置
        if (doc.charts) {
          for (const [cid, spec] of Object.entries(doc.charts)) {
            const members = doc.elements.filter((e) => e.chartId === cid);
            if (members.length === 0) continue;
            if (members.every((e) => ids.includes(e.id))) {
              spec.at = { ...(spec.at ?? {}), x: (spec.at?.x ?? 0) + dx, y: (spec.at?.y ?? 0) + dy };
            }
          }
        }
        return { ...syncProject(s, doc, s.history) };
      }),
    commitHistory: () => set((s) => ({ ...syncProject(s, s.doc, pushHistory(s.history, s.doc)) })),
    // 多选整体旋转：绕选中元素包围盒中心旋转，一步撤销；
    // 位置随旋转（世界坐标），rotation 累加；polyline 点列与箭头折点（相对坐标）同步旋转
    rotateSelection: (deg) =>
      set((s) => {
        const doc = rotateSelected(s.doc, s.selection, deg);
        if (!doc) return {};
        return { ...syncProject(s, doc, pushHistory(s.history, s.doc)) };
      }),
    // 旋转拖拽快速版：同 rotateSelection 但不入历史（手势按下时已 commitHistory 一次，逐帧调用不产生历史）
    rotateSelectionFast: (deg) =>
      set((s) => {
        const doc = rotateSelected(s.doc, s.selection, deg);
        if (!doc) return {};
        return { ...syncProject(s, doc, s.history) };
      }),

    setSelection: (ids) => set({ selection: [...ids] }),
    setTool: (t) => set({ tool: t }),
    setActivity: (a) => set({ activity: [...a] }),
    setView: (v) => {
      // 视口记忆：写独立 localStorage 键（不写回 projects 引用——视口变化不触发画布内容瞬时保存）
      saveView(get().currentProjectId, { ...v });
      return set({ view: { ...v } });
    },
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
    // 拖动联动（图形→数据）：拖动中实时改数据与被拖元素几何（不入历史）；
    // 松手后由 recomputeChart 整图重排并入栈（pushHistory 的 s.doc 是拖动前状态 → 一次拖动 = 一步撤销）
    updateChartDrag: (chartId, index, value) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const spec = doc.charts?.[chartId];
        if (!spec || !spec.data[index]) return {};
        spec.data[index].value = value;
        const total = spec.data.reduce((sum, d) => sum + d.value, 0);
        const max = niceScale(Math.max(...spec.data.map((d) => d.value), 1)).max;
        // 柱顶 y（拖动换算共用）：bar 与 bar-label 都要跟手，避免"松手后标签才跳到新柱顶"
        const by = PLOT.bottom - (value / max) * (PLOT.bottom - PLOT.top);
        doc.elements = doc.elements.map((e) => {
          if (e.bind?.chartId !== chartId || e.bind.index !== index) return e;
          if (e.type === "sector" && e.bind.role === "slice") {
            e.endAngle = e.startAngle + (value / total) * Math.PI * 2;
          } else if (e.type === "rect" && e.bind.role === "bar") {
            e.y = by;
            e.height = Math.max(1, PLOT.bottom - by);
          } else if (e.type === "text" && e.bind.role === "pie-label") {
            const pct = Math.round((value / total) * 100);
            e.text = spec.showValues ? `${Number(value.toFixed(2))}${spec.unit ?? ""} (${pct}%)` : `${pct}%`;
          } else if (e.type === "text" && e.bind.role === "bar-label") {
            e.text = String(Number(value.toFixed(2)));
            // 标签实时跟随柱顶（textEl 的 y = 柱顶上方 12px - 文字高一半）
            e.y = by - 12 - e.height / 2;
          }
          return e;
        });
        return { ...syncProject(s, doc, s.history) };
      }),
    // 饼图接缝拖动（图形→数据）：拖动 slice index 的起始接缝到 angle，让该接缝精确落在鼠标处。
    // 内部接缝（index>0）：调整前 index 个与后 n-index 个 slice 的比例（组内等比缩放、总和守恒）；
    // 起始接缝（index=0）：整体旋转 pieStart，使起始接缝跟手。不入历史，松手后 recomputeChart 一步入栈。
    // 注意：只原地更新现有元素几何（不替换 id），否则被拖元素脱离 DOM 导致后续 pointermove/up 冒泡中断。
    updateChartSeamDrag: (chartId, index, angle) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        const spec = doc.charts?.[chartId];
        if (!spec || spec.type !== "pie" || !spec.data[index]) return {};
        const total = spec.data.reduce((sum, d) => sum + d.value, 0);
        if (total <= 0) return {};
        const n = spec.data.length;
        const start = spec.pieStart ?? -Math.PI / 2;
        if (index === 0) {
          // 起始接缝：整体旋转（所有 slice 相对比例不变，被拖接缝即起始角跟手）
          spec.pieStart = angle;
        } else {
          // 内部接缝：目标 = 前 index 个 slice 的累计角度 = angle（相对起始角归一化到 [0, 2π)）
          let rel = angle - start;
          rel = rel - Math.floor(rel / (2 * Math.PI)) * 2 * Math.PI;
          if (rel < 0) rel += 2 * Math.PI;
          const beforeTotal = spec.data.slice(0, index).reduce((sum, d) => sum + d.value, 0);
          const afterTotal = total - beforeTotal;
          const targetBefore = Math.min(Math.max(total * (rel / (2 * Math.PI)), 0.5), total - 0.5);
          if (beforeTotal > 0) {
            const k = targetBefore / beforeTotal;
            for (let i = 0; i < index; i++) spec.data[i] = { ...spec.data[i], value: spec.data[i].value * k };
          }
          if (afterTotal > 0) {
            const k2 = (total - targetBefore) / afterTotal;
            for (let i = index; i < n; i++) spec.data[i] = { ...spec.data[i], value: spec.data[i].value * k2 };
          }
        }
        // 原地更新几何：按新 spec 计算每个 slice 的起止角，更新现有 sector/标签/图例（不替换 id）
        const els = layoutChart(spec, chartId);
        const neoByIndex = new Map<number, CanvasElement>();
        for (const e of els) {
          if (e.bind?.index !== undefined) neoByIndex.set(e.bind.index, e);
        }
        doc.elements = doc.elements.map((e) => {
          if (e.bind?.chartId !== chartId || e.bind.index === undefined) return e;
          const neo = neoByIndex.get(e.bind.index);
          if (!neo) return e;
          if (e.type === "sector" && neo.type === "sector") {
            return { ...e, startAngle: neo.startAngle, endAngle: neo.endAngle, innerRadius: (neo as SectorElement).innerRadius } as CanvasElement;
          }
          if (e.type === "text" && neo.type === "text" && e.bind.role === "pie-label") {
            return { ...e, text: neo.text } as CanvasElement;
          }
          return e;
        });
        return { ...syncProject(s, doc, s.history) };
      }),
    // 整图重排（数据→图形）：按 charts[chartId] 重新布局，替换全部绑定元素；
    // baseline（拖动前快照）存在时入栈 baseline → 一步撤销回到拖动前；一次手势 = 一步撤销
    recomputeChart: (chartId, baseline) =>
      set((s) => {
        const spec = s.doc.charts?.[chartId];
        if (!spec) return {};
        const doc = structuredClone(s.doc);
        const els = layoutChart(spec, chartId);
        let z = maxZIndex(doc.elements);
        const copies = els.map((e) => {
          const c = structuredClone(e);
          c.zIndex = ++z;
          return c;
        });
        const replaceIds = doc.elements.filter((e) => e.bind?.chartId === chartId).map((e) => e.id);
        doc.elements = [...doc.elements.filter((e) => !replaceIds.includes(e.id)), ...copies];
        return { ...syncProject(s, doc, pushHistory(s.history, baseline ?? s.doc)), selection: [] };
      }),
    // 解除图表关联：全部绑定元素移除 bind + chartId 变普通元素，charts 删除该图；
    // 单向操作不入撤销栈（规格明确不做撤销恢复关联）
    detachChart: (chartId) =>
      set((s) => {
        const doc = structuredClone(s.doc);
        doc.elements = doc.elements.map((e) => {
          if (e.bind?.chartId !== chartId) return e;
          const c = structuredClone(e);
          delete c.bind;
          delete c.chartId;
          return c;
        });
        if (doc.charts) {
          const next = { ...doc.charts };
          delete next[chartId];
          doc.charts = next;
        }
        return { ...syncProject(s, doc, s.history), selection: s.selection };
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
    // AI 生成完成：入栈"生成前基线"（快照中间态不入栈，undo 一步回到生成前），再替换为最终画布；
    // 本轮 AI 新增的元素自动打同一 groupId → 生成的图标/整图 = 可拆分的组合整体
    // （与用户手动"组合为整体对象"一致：单击任一组内元素整组选中/移动，属性面板可移除组合拆分；
    // 图表绑定元素不参与——图表有独立的整图选择与数据编辑）
    applyAIResult: (doc, baseline) =>
      set((s) => {
        const next = structuredClone(doc);
        next.elements = mergePreserved(s.doc, s.aiLockedIds, s.aiBaselineIds, next.elements);
        const baseIds = new Set(baseline.elements.map((e) => e.id));
        const fresh = next.elements.filter((e) => !baseIds.has(e.id) && !e.chartId && !e.bind);
        if (fresh.length >= 2) {
          const gid = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const freshIds = new Set(fresh.map((e) => e.id));
          next.elements = next.elements.map((e) => (freshIds.has(e.id) ? { ...e, groupId: gid } : e));
        }
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
            // 画布切换一律清空 AI 锁定/基线：上一画布残留的生成会话不得污染新画布
            aiLockedIds: [],
            aiBaselineIds: [],
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
            aiLockedIds: [],
            aiBaselineIds: [],
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
        aiLockedIds: [],
        aiBaselineIds: [],
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
          aiLockedIds: [],
          aiBaselineIds: [],
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
          // 恢复该画布上次的视口（独立键存储，无记录则回到默认视图）
          view: loadView(id) ?? { ...EMPTY_VIEW },
          selection: [],
          editingText: null,
          aiLockedIds: [],
          aiBaselineIds: [],
        };
      }),
  };
  return initial;
});

// 画布内容/项目变化 → 300ms 防抖持久化（history 不入存储，saveProjects 内部剥除）；
// 顺带记住当前画布 id——刷新后回到上次离开的画布
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useCanvasStore.subscribe((s) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveProjects(s.projects);
    saveCurrentProject(s.currentProjectId);
  }, 300);
});
