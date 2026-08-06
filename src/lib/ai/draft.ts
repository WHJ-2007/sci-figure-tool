import { CANVAS_WIDTH, CANVAS_HEIGHT, clampRect, shapeExitPoint, anchorToward, type Point } from "@/lib/canvas/geometry";
import { makeElement, estimateTextSize, logicBoxSize } from "@/lib/canvas/elements";
import { layoutGraph } from "@/lib/canvas/graphLayout";
import { layoutMindMap } from "@/lib/canvas/mindMapLayout";
import type { MindMapBranch } from "@/lib/canvas/mindMapLayout";
import { layoutChart } from "@/lib/canvas/chartLayout";
import type { ChartSpec } from "@/lib/canvas/chartLayout";
import type { CanvasDocument, CanvasElement, ElementType } from "@/lib/canvas/types";

// updateElement 只接受白名单内的属性键，防止绕过工具层 schema 直接注入任意属性
const PATCH_KEYS = ["x", "y", "width", "height", "fill", "stroke", "strokeWidth", "rotation", "text", "body", "fontSize", "opacity", "bold", "italic", "align", "fontFamily", "curvature", "radius", "startAngle", "endAngle", "head", "zIndex", "fillOpacity", "strokeOpacity", "shadow"] as const;

// 属性键 → 人话名：活动文案不再暴露裸键（如 "fill"），直接说改了什么
const PATCH_NAMES: Record<string, string> = {
  x: "位置", y: "位置", width: "宽度", height: "高度",
  fill: "填充色", stroke: "边框色", strokeWidth: "线宽",
  rotation: "旋转", text: "文字内容", body: "正文", fontSize: "字号",
  opacity: "透明度", bold: "加粗", italic: "斜体", align: "对齐",
  fontFamily: "字体", curvature: "弯曲度", radius: "半径",
  startAngle: "起始角度", endAngle: "结束角度",
  head: "箭头样式", zIndex: "层级",
  fillOpacity: "填充透明度", strokeOpacity: "边框透明度", shadow: "阴影",
};

export interface PendingConfirm {
  id: string;
  description: string;
  apply: () => void;
}

// AI 输出里反斜杠+n 字面（模型把换行转义成 "\\n"）→ 真换行；只替换转义串，不动已存在的真换行
function unescapeNewlines(s: string): string {
  return s.replace(/\\n/g, "\n");
}

export interface CreateArgs {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  body?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  fontFamily?: string;
  head?: "none" | "single" | "double";
}

export class DraftCanvas {
  elements: CanvasElement[] = [];
  charts: Record<string, ChartSpec> = {};
  private activity: string[] = [];
  private onChange: (() => void) | undefined;
  private pendingConfirms: PendingConfirm[] = [];
  private newCanvasFlag = false;
  private touchedIds = new Set<string>();

  constructor(elements: CanvasElement[], charts: Record<string, ChartSpec> = {}, onChange?: () => void) {
    this.elements = structuredClone(elements);
    this.charts = structuredClone(charts);
    this.onChange = onChange;
  }

  private touch(id: string) {
    this.touchedIds.add(id);
  }

  // 本轮 AI 触及（创建/修改/删除）过的元素 id，供前端锁定与快照合并
  takeTouched(): string[] {
    const out = [...this.touchedIds];
    this.touchedIds.clear();
    return out;
  }

  private changed() {
    this.onChange?.();
  }

  setOnChange(cb: (() => void) | undefined) {
    this.onChange = cb;
  }

  // 画布级操作挂起列表（当前仅 newCanvas）：主生成结束后由 runAgent 上报，用户确认后经 /api/chat/confirm 逐个 apply
  get pending(): PendingConfirm[] {
    return this.pendingConfirms;
  }

  // 文字元素统一置顶：AI 生成的文字标注应始终显示在模块框之上，不被不透明填充遮挡
  private ensureTextOnTop() {
    const sorted = [...this.elements].sort((a, b) => a.zIndex - b.zIndex);
    let z = 0;
    const next: CanvasElement[] = [];
    for (const e of sorted) if (e.type !== "text") next.push({ ...e, zIndex: ++z });
    for (const e of sorted) if (e.type === "text") next.push({ ...e, zIndex: ++z });
    this.elements = next;
  }

  serialize(): CanvasDocument {
    return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, elements: this.elements, charts: this.charts };
  }

  flushActivity(): string[] {
    const out = [...this.activity];
    this.activity = [];
    return out;
  }

  createElement(args: CreateArgs): { ok: boolean; id?: string; error?: string } {
    const allowed: ElementType[] = ["rect", "ellipse", "triangle", "diamond", "hexagon", "star", "cross", "donut", "half", "arrow", "polyline", "text", "logic"];
    if (!allowed.includes(args.type as ElementType)) return { ok: false, error: `未知元素类型: ${args.type}` };
    const w = Math.max(8, Number(args.width) || 8);
    const h = Math.max(8, Number(args.height) || 8);
    const r = clampRect({ x: args.x, y: args.y, width: w, height: h }, CANVAS_WIDTH, CANVAS_HEIGHT);
    const maxZ = this.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    let el: CanvasElement;
    if (args.type === "text" || args.type === "logic") {
      el = makeElement(args.type as "text" | "logic", r.x, r.y, r.width, r.height, {
        text: args.text === undefined ? (args.type === "logic" ? "逻辑" : "文字") : unescapeNewlines(args.text),
        body: args.body === undefined ? undefined : unescapeNewlines(args.body),
        fill: args.fill ?? "#2f2f2f",
        fontSize: args.fontSize,
        bold: args.bold,
        italic: args.italic,
        align: args.align,
        fontFamily: args.fontFamily,
        zIndex: maxZ + 1,
      });
    } else {
      el = makeElement(args.type as ElementType | "rounded", r.x, r.y, r.width, r.height, {
        fill: args.fill,
        stroke: args.stroke,
        strokeWidth: args.strokeWidth,
        rotation: args.rotation,
        head: args.type === "arrow" ? args.head : undefined,
        zIndex: maxZ + 1,
      });
    }
    this.elements.push(el);
    this.touch(el.id);
    this.ensureTextOnTop();
    if ("text" in el) {
      const style = `${el.bold ? "加粗 " : ""}${el.fontSize ?? 14}px`;
      this.activity.push(`在 (${Math.round(r.x)}, ${Math.round(r.y)}) 创建${typeName(el.type)}「${el.text}」（${style}）`);
    } else {
      this.activity.push(`在 (${Math.round(r.x)}, ${Math.round(r.y)}) 创建${typeName(el.type)}（${Math.round(r.width)}×${Math.round(r.height)}）`);
    }
    this.changed();
    return { ok: true, id: el.id };
  }

  updateElement(args: { id: string; patch: Record<string, unknown> }): { ok: boolean; error?: string } {
    const idx = this.elements.findIndex((e) => e.id === args.id);
    if (idx < 0) return { ok: false, error: `元素不存在: ${args.id}` };
    const e = this.elements[idx];
    const patch = Object.fromEntries(PATCH_KEYS.filter((k) => k in args.patch).map((k) => [k, args.patch[k]]));
    // 换行转义修复：AI 的 patch 里 text/body 若带 "\\n" 字面，先转回真换行再应用
    if (typeof patch.text === "string") patch.text = unescapeNewlines(patch.text);
    if (typeof patch.body === "string") patch.body = unescapeNewlines(patch.body);
    const next = { ...e, ...patch } as CanvasElement;
    // 文字/逻辑节点内容变化自动重算尺寸：文字按内容重算宽高，逻辑节点标题变长时框宽随标题扩展（与客户端行为一致）
    if (next.type === "text" && ("text" in patch || "fontSize" in patch || "bold" in patch)) {
      const size = estimateTextSize(next.text, next.fontSize, next.bold);
      next.width = size.width;
      next.height = size.height;
    }
    if (next.type === "logic" && ("text" in patch || "body" in patch || "fontSize" in patch || "bold" in patch)) {
      const size = logicBoxSize(next.text, next.body, next.fontSize, next.bold);
      next.width = Math.max(next.width, size.width);
      next.height = Math.max(next.height, size.height);
    }
    next.width = Math.max(4, next.width);
    next.height = Math.max(4, next.height);
    next.x = Math.min(Math.max(next.x, 0), CANVAS_WIDTH - next.width);
    next.y = Math.min(Math.max(next.y, 0), CANVAS_HEIGHT - next.height);
    this.touch(e.id);
    this.elements[idx] = next;
    this.ensureTextOnTop();
    // 文案取自白名单过滤后的 patch 键，按映射名去重：{x, y} 同映射"位置"只出现一次，zIndex 等系统字段不出现
    const changed = [...new Set(Object.keys(patch).map((k) => PATCH_NAMES[k] ?? k))].join("、");
    this.activity.push(`修改${titleOf(e)}：${changed}`);
    this.changed();
    return { ok: true };
  }

  deleteElement(args: { id: string }): { ok: boolean; error?: string } {
    const idx = this.elements.findIndex((e) => e.id === args.id);
    if (idx < 0) return { ok: false, error: `元素不存在: ${args.id}` };
    // 元素删除直接执行：仅画布级操作（新建画布）才需用户确认
    this.applyDelete(args.id);
    return { ok: true };
  }

  private applyDelete(id: string) {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx >= 0) {
      const el = this.elements[idx];
      this.elements.splice(idx, 1);
      this.touch(el.id);
      this.activity.push(`删除${titleOf(el)}`);
    }
    this.ensureTextOnTop();
    this.changed();
  }

  listElements() {
    return this.elements.map((e) => ({
      id: e.id,
      type: e.type,
      x: Math.round(e.x),
      y: Math.round(e.y),
      width: Math.round(e.width),
      height: Math.round(e.height),
      text: "text" in e ? e.text : undefined,
      body: "body" in e ? e.body : undefined,
      fill: e.fill,
      stroke: e.stroke,
      rotation: e.rotation,
      head: e.type === "arrow" ? e.head : undefined,
      zIndex: e.zIndex,
    }));
  }

  // 自动连接：从源形状边缘精确指向目标形状边缘的箭头（AI 无需手算坐标）
  connectElements(args: { sourceId: string; targetId: string; stroke?: string; strokeWidth?: number; head?: "none" | "single" | "double" }): { ok: boolean; id?: string; error?: string } {
    const s = this.elements.find((e) => e.id === args.sourceId);
    const t = this.elements.find((e) => e.id === args.targetId);
    if (!s) return { ok: false, error: `源元素不存在: ${args.sourceId}` };
    if (!t) return { ok: false, error: `目标元素不存在: ${args.targetId}` };
    const connectable: ElementType[] = ["rect", "ellipse", "triangle", "diamond", "hexagon", "text", "logic"];
    if (!connectable.includes(s.type) || !connectable.includes(t.type)) {
      return { ok: false, error: "只能连接形状、文字或逻辑节点（箭头/折线不能作为连接端点）" };
    }
    const from: Point = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const to: Point = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    if (from.x === to.x && from.y === to.y) return { ok: false, error: "两个元素中心重合，无法连接" };
    // 逻辑节点优先用自带锚点：出口/入口选朝向对方中心的锚点，箭头精确对接锚点
    const p1 = anchorToward(s, to) ?? shapeExitPoint(s, from, to) ?? from;
    const p2 = anchorToward(t, from) ?? shapeExitPoint(t, from, to) ?? to;
    const maxZ = this.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const el = makeElement("arrow", p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, {
      stroke: args.stroke ?? "#2f2f2f",
      strokeWidth: args.strokeWidth,
      head: args.head,
      startId: s.id,
      endId: t.id,
      zIndex: maxZ + 1,
    });
    this.elements.push(el);
    this.touch(el.id);
    this.ensureTextOnTop();
    this.activity.push(`连线：${titleOf(s)} → ${titleOf(t)}`);
    this.changed();
    return { ok: true, id: el.id };
  }

  // 声明式一键布局：AI 只声明节点（标题/正文/填充）与连接关系，坐标交给 dagre 分层布局，
  // 节点一律创建为逻辑节点（自带 4 锚点），边用 connectElements 精确对接锚点
  applyGraph(args: {
    nodes: { id: string; text: string; body?: string; fill?: string; width?: number; height?: number }[];
    edges: { from: string; to: string }[];
    direction?: "TB" | "LR";
  }): { ok: boolean; error?: string } {
    if (args.nodes.length === 0) return { ok: false, error: "节点列表不能为空" };
    const ids = new Set(args.nodes.map((n) => n.id));
    for (const e of args.edges) {
      if (!ids.has(e.from)) return { ok: false, error: `边引用了不存在的节点: ${e.from}` };
      if (!ids.has(e.to)) return { ok: false, error: `边引用了不存在的节点: ${e.to}` };
    }
    const fontSize = 14;
    const sized = args.nodes.map((n) => {
      const text = n.text || n.id;
      const s = logicBoxSize(text, n.body, fontSize);
      return {
        id: n.id,
        text,
        body: n.body,
        fill: n.fill,
        width: Math.max(Number(n.width) || 0, s.width),
        height: Math.max(Number(n.height) || 0, s.height),
      };
    });
    const pos = layoutGraph(
      sized.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      args.edges,
      args.direction ?? "TB",
      60
    );
    const idMap = new Map<string, string>();
    for (const n of sized) {
      const p = pos.get(n.id)!;
      const r = this.createElement({
        type: "logic",
        x: p.x,
        y: p.y,
        width: n.width,
        height: n.height,
        text: n.text,
        body: n.body,
        fill: n.fill ?? "#eef4ff",
        fontSize,
      });
      idMap.set(n.id, r.id!);
    }
    for (const e of args.edges) {
      this.connectElements({ sourceId: idMap.get(e.from)!, targetId: idMap.get(e.to)! });
    }
    this.activity.push(`完成流程图：${sized.length} 个节点、${args.edges.length} 条连线，已自动对齐`);
    return { ok: true };
  }

  // 布局引擎产物直接入草稿（引擎坐标已规划且可能为负偏移，如向上的坐标轴箭头），不钳制
  private pushElement(el: CanvasElement) {
    this.elements.push(el);
    this.touch(el.id);
    this.ensureTextOnTop();
    this.changed();
  }

  // 声明式思维导图：AI 只声明主题与分支层级，放射布局引擎产出元素（中心主题 + 曲线分支 + 关键词）
  applyMindMap(args: { topic: string; topicBody?: string; branches: MindMapBranch[] }): { ok: boolean; error?: string } {
    const topic = (args.topic ?? "").trim();
    if (!topic) return { ok: false, error: "主题不能为空" };
    if (!args.branches || args.branches.length === 0) return { ok: false, error: "至少需要一个一级分支" };
    if (args.branches.length > 8) return { ok: false, error: "一级分支过多（最多 8 个）" };
    // 深度校验：子分支关键词为空会在画布上产生空白节点（z.string() 接受 ""），关键词由 AI 生成，此校验仅为兜底
    const hasEmptyKeyword = (bs: MindMapBranch[]): boolean =>
      bs.some((b) => !b.keyword.trim() || hasEmptyKeyword(b.children ?? []));
    if (hasEmptyKeyword(args.branches)) return { ok: false, error: "分支关键词不能为空" };
    const els = layoutMindMap({
      topic,
      topicBody: args.topicBody,
      branches: args.branches,
    });
    for (const el of els) this.pushElement(el);
    const nodes = els.filter((e) => e.type === "logic" || e.type === "text").length;
    const curves = els.filter((e) => e.type === "curve").length;
    this.activity.push(`思维导图已生成：主题「${topic}」+ ${args.branches.length} 个一级分支（${nodes} 个关键词、${curves} 条分支线）`);
    return { ok: true };
  }

  // 声明式图表：AI 只声明类型与数据，图表引擎自动计算坐标轴/刻度/图形/标签/图例
  applyChart(args: ChartSpec): { ok: boolean; error?: string } {
    const types = ["bar", "line", "pie", "scatter"];
    if (!types.includes(args.type)) return { ok: false, error: `不支持的图表类型: ${args.type}` };
    if (!args.data || args.data.length === 0) return { ok: false, error: "数据不能为空" };
    if (args.data.length > 12) return { ok: false, error: "数据项过多（最多 12 项）" };
    if (args.data.some((d) => !Number.isFinite(d.value) || d.value < 0)) return { ok: false, error: "数值必须是非负数字" };
    // 空标签会在画布上产生空白刻度/图例（z.string() 接受 ""），与 applyMindMap 空关键词兜底精神一致
    if (args.data.some((d) => !d.label.trim())) return { ok: false, error: "分类标签不能为空" };
    // 全零数据（如饼图）静默空成功：引擎按 total<=0 返回空图形，必须显式拒绝
    if (args.data.reduce((s, d) => s + d.value, 0) <= 0) return { ok: false, error: "数据总和必须大于 0" };
    const chartId = `c-${Math.random().toString(36).slice(2, 10)}`;
    const els = layoutChart(args).map((el) => ({ ...el, chartId }) as CanvasElement);
    for (const el of els) this.pushElement(el);
    this.charts[chartId] = structuredClone(args);
    this.activity.push(`图表已生成：${chartTypeName(args.type)}（${args.data.length} 项数据）`);
    return { ok: true };
  }

  clear(): { ok: boolean; note?: string } {
    // 空画布清空无破坏性，直接跳过
    if (this.elements.length === 0) {
      this.activity.push("画布已是空的");
      return { ok: true };
    }
    // 清空 = 删除元素，不再挂起确认（仅画布级操作才需确认）
    this.applyClear();
    return { ok: true };
  }

  private applyClear() {
    // 清空前 touch 全部被移除元素：确认流回发的快照 touched 需包含它们，
    // 前端才把这些 id 加锁，mergePreserved 才不会被当作"用户本地新增"保留
    const removed = this.elements;
    this.elements = [];
    for (const el of removed) this.touch(el.id);
    this.ensureTextOnTop();
    this.activity.push("清空画布");
    this.changed();
  }

  newCanvas(): { ok: boolean; note?: string } {
    // 重复挂起去重：新建画布已在等待确认时不重复挂起
    if (this.pendingConfirms.some((p) => p.id === "new-canvas")) return { ok: true, note: "新建画布已在等待确认" };
    this.pendingConfirms.push({
      id: "new-canvas",
      description: "新建空白画布并切换到它",
      apply: () => this.applyNewCanvas(),
    });
    return { ok: true, note: "新建画布已挂起，等待用户确认" };
  }

  private applyNewCanvas() {
    // 与 applyClear 同理 touch 被移除元素（防御性）：若未来事件顺序变化把旧元素并入新画布，
    // 这些 id 已在快照 touched 中加锁，可被正确丢弃
    const removed = this.elements;
    this.elements = [];
    for (const el of removed) this.touch(el.id);
    this.ensureTextOnTop();
    this.activity.push("新建画布");
    this.newCanvasFlag = true;
    this.changed();
  }

  takeNewCanvasFlag(): boolean {
    const f = this.newCanvasFlag;
    this.newCanvasFlag = false;
    return f;
  }
}

function titleOf(el: CanvasElement): string {
  return "text" in el && el.text ? `「${el.text}」` : typeName(el.type);
}

function typeName(t: string): string {
  const map: Record<string, string> = {
    rect: "矩形", ellipse: "椭圆", triangle: "三角形", diamond: "菱形",
    hexagon: "六边形", star: "五角星", cross: "十字", donut: "圆环", half: "半圆",
    arrow: "箭头", polyline: "折线", text: "文字", logic: "逻辑节点",
    curve: "曲线", sector: "扇形",
  };
  return map[t] ?? t;
}

function chartTypeName(t: string): string {
  const map: Record<string, string> = { bar: "柱状图", line: "折线图", pie: "饼图", scatter: "散点图" };
  return map[t] ?? t;
}
