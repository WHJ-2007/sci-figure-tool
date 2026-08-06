import { CANVAS_WIDTH, CANVAS_HEIGHT, clampRect, shapeExitPoint, anchorToward, type Point } from "@/lib/canvas/geometry";
import { makeElement, estimateTextSize, logicBoxSize } from "@/lib/canvas/elements";
import { layoutGraph } from "@/lib/canvas/graphLayout";
import { layoutMindMap } from "@/lib/canvas/mindMapLayout";
import type { MindMapBranch } from "@/lib/canvas/mindMapLayout";
import { layoutChart } from "@/lib/canvas/chartLayout";
import type { ChartSpec } from "@/lib/canvas/chartLayout";
import type { CanvasDocument, CanvasElement, ElementType } from "@/lib/canvas/types";

// updateElement 只接受白名单内的属性键，防止绕过工具层 schema 直接注入任意属性
const PATCH_KEYS = ["x", "y", "width", "height", "fill", "stroke", "strokeWidth", "rotation", "text", "body", "fontSize", "opacity", "bold", "italic", "align", "fontFamily", "curvature", "radius", "startAngle", "endAngle"] as const;

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
}

export class DraftCanvas {
  elements: CanvasElement[] = [];
  private activity: string[] = [];
  private onChange: (() => void) | undefined;
  private newCanvasFlag = false;

  constructor(elements: CanvasElement[], onChange?: () => void) {
    this.elements = structuredClone(elements);
    this.onChange = onChange;
  }

  private changed() {
    this.onChange?.();
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
    return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, elements: this.elements };
  }

  flushActivity(): string[] {
    const out = [...this.activity];
    this.activity = [];
    return out;
  }

  createElement(args: CreateArgs): { ok: boolean; id?: string; error?: string } {
    const allowed: ElementType[] = ["rect", "ellipse", "triangle", "diamond", "hexagon", "arrow", "polyline", "text", "logic"];
    if (!allowed.includes(args.type as ElementType)) return { ok: false, error: `未知元素类型: ${args.type}` };
    const w = Math.max(8, Number(args.width) || 8);
    const h = Math.max(8, Number(args.height) || 8);
    const r = clampRect({ x: args.x, y: args.y, width: w, height: h }, CANVAS_WIDTH, CANVAS_HEIGHT);
    const maxZ = this.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    let el: CanvasElement;
    if (args.type === "text" || args.type === "logic") {
      el = makeElement(args.type as "text" | "logic", r.x, r.y, r.width, r.height, {
        text: args.text ?? (args.type === "logic" ? "逻辑" : "文字"),
        body: args.body,
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
        zIndex: maxZ + 1,
      });
    }
    this.elements.push(el);
    this.ensureTextOnTop();
    this.activity.push(`创建${typeName(el.type)} (${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)}×${Math.round(r.height)})${"text" in el ? `：${el.text}` : ""}`);
    this.changed();
    return { ok: true, id: el.id };
  }

  updateElement(args: { id: string; patch: Record<string, unknown> }): { ok: boolean; error?: string } {
    const idx = this.elements.findIndex((e) => e.id === args.id);
    if (idx < 0) return { ok: false, error: `元素不存在: ${args.id}` };
    const e = this.elements[idx];
    const patch = Object.fromEntries(PATCH_KEYS.filter((k) => k in args.patch).map((k) => [k, args.patch[k]]));
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
    this.elements[idx] = next;
    this.ensureTextOnTop();
    const changed = Object.keys(args.patch).join(", ");
    this.activity.push(`修改元素 ${e.id.slice(0, 6)}：${changed}`);
    this.changed();
    return { ok: true };
  }

  deleteElement(args: { id: string }): { ok: boolean; error?: string } {
    const idx = this.elements.findIndex((e) => e.id === args.id);
    if (idx < 0) return { ok: false, error: `元素不存在: ${args.id}` };
    this.elements.splice(idx, 1);
    this.ensureTextOnTop();
    this.activity.push(`删除元素 ${args.id.slice(0, 6)}`);
    this.changed();
    return { ok: true };
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
      fill: e.fill,
      stroke: e.stroke,
      rotation: e.rotation,
    }));
  }

  // 自动连接：从源形状边缘精确指向目标形状边缘的箭头（AI 无需手算坐标）
  connectElements(args: { sourceId: string; targetId: string; stroke?: string; strokeWidth?: number }): { ok: boolean; id?: string; error?: string } {
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
      startId: s.id,
      endId: t.id,
      zIndex: maxZ + 1,
    });
    this.elements.push(el);
    this.ensureTextOnTop();
    this.activity.push(`连接 ${s.id.slice(0, 6)} → ${t.id.slice(0, 6)}`);
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
    this.activity.push(`自动布局绘制 ${sized.length} 个节点、${args.edges.length} 条连线（${args.direction ?? "TB"}）`);
    return { ok: true };
  }

  // 布局引擎产物直接入草稿（引擎坐标已规划且可能为负偏移，如向上的坐标轴箭头），不钳制
  private pushElement(el: CanvasElement) {
    this.elements.push(el);
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
  applyChart(args: { type: "bar" | "line" | "pie" | "scatter"; title?: string; xLabel?: string; yLabel?: string; data: { label: string; value: number; series?: string }[] }): { ok: boolean; error?: string } {
    const types = ["bar", "line", "pie", "scatter"];
    if (!types.includes(args.type)) return { ok: false, error: `不支持的图表类型: ${args.type}` };
    if (!args.data || args.data.length === 0) return { ok: false, error: "数据不能为空" };
    if (args.data.length > 12) return { ok: false, error: "数据项过多（最多 12 项）" };
    if (args.data.some((d) => !Number.isFinite(d.value) || d.value < 0)) return { ok: false, error: "数值必须是非负数字" };
    const els = layoutChart({ type: args.type, title: args.title, xLabel: args.xLabel, yLabel: args.yLabel, data: args.data });
    for (const el of els) this.pushElement(el);
    this.activity.push(`图表已生成：${chartTypeName(args.type)}（${args.data.length} 项数据）`);
    return { ok: true };
  }

  clear() {
    this.elements = [];
    this.activity.push("清空画布");
    this.changed();
    return { ok: true };
  }

  newCanvas() {
    this.elements = [];
    this.activity.push("新建画布");
    this.newCanvasFlag = true;
    this.changed();
    return { ok: true };
  }

  takeNewCanvasFlag(): boolean {
    const f = this.newCanvasFlag;
    this.newCanvasFlag = false;
    return f;
  }
}

function typeName(t: string): string {
  const map: Record<string, string> = {
    rect: "矩形", ellipse: "椭圆", triangle: "三角形", diamond: "菱形",
    hexagon: "六边形", arrow: "箭头", polyline: "折线", text: "文字", logic: "逻辑节点",
    curve: "曲线", sector: "扇形",
  };
  return map[t] ?? t;
}

function chartTypeName(t: string): string {
  const map: Record<string, string> = { bar: "柱状图", line: "折线图", pie: "饼图", scatter: "散点图" };
  return map[t] ?? t;
}
