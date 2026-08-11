import { CANVAS_WIDTH, CANVAS_HEIGHT, clampRect, shapeExitPoint, anchorToward, type Point } from "@/lib/canvas/geometry";
import { makeElement, estimateTextSize, logicBoxSize } from "@/lib/canvas/elements";
import { latexToUnicode } from "@/lib/canvas/formula";
import { layoutGraph } from "@/lib/canvas/graphLayout";
import { layoutMindMap } from "@/lib/canvas/mindMapLayout";
import type { MindMapBranch } from "@/lib/canvas/mindMapLayout";
import { layoutChart } from "@/lib/canvas/chartLayout";
import type { ChartSpec } from "@/lib/canvas/chartLayout";
import type { CanvasDocument, CanvasElement, ElementType } from "@/lib/canvas/types";
import { auditScientificFigure, correctScientificFigure, hasScientificFigure, type ScientificQualityReport } from "./scientificQuality";

// updateElement 只接受白名单内的属性键，防止绕过工具层 schema 直接注入任意属性
const PATCH_KEYS = ["x", "y", "width", "height", "fill", "stroke", "strokeWidth", "dash", "rotation", "rx", "text", "body", "fontSize", "opacity", "bold", "italic", "align", "fontFamily", "curvature", "radius", "startAngle", "endAngle", "head", "midPoints", "zIndex", "fillOpacity", "strokeOpacity", "shadow", "flipH", "flipV"] as const;

// 属性键 → 人话名：活动文案不再暴露裸键（如 "fill"），直接说改了什么
const PATCH_NAMES: Record<string, string> = {
  x: "位置", y: "位置", width: "宽度", height: "高度",
  fill: "填充色", stroke: "边框色", strokeWidth: "线宽",
  rotation: "旋转", rx: "圆角弧度", text: "文字内容", body: "正文", fontSize: "字号",
  opacity: "透明度", bold: "加粗", italic: "斜体", align: "对齐",
  fontFamily: "字体", curvature: "弯曲度", radius: "半径",
  startAngle: "起始角度", endAngle: "结束角度",
  head: "箭头样式", zIndex: "层级",
  fillOpacity: "填充透明度", strokeOpacity: "边框透明度", shadow: "阴影",
  flipH: "水平镜像", flipV: "垂直镜像",
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

// 科研图中的说明文字必须在确定宽度内排版；不能依赖 SVG 自动换行（它不会自动换行）。
function wrapTextToWidth(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of unescapeNewlines(text).split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const char of paragraph) {
      const candidate = line + char;
      if (line && estimateTextSize(candidate, fontSize, bold).width > maxWidth) {
        lines.push(line.trimEnd());
        line = char.trimStart();
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

function textLinesSize(lines: string[], fontSize: number, bold = false): { width: number; height: number } {
  return {
    width: Math.max(...lines.map((line) => estimateTextSize(line, fontSize, bold).width), 8),
    height: Math.max(lines.length, 1) * fontSize * 1.4,
  };
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
  dash?: number[];
  fillOpacity?: number;
  strokeOpacity?: number;
  rotation?: number;
  rx?: number; // 圆角弧度（rect/rounded 用）
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  fontFamily?: string;
  head?: "none" | "single" | "double";
  midPoints?: { x: number; y: number; smooth?: boolean }[]; // 箭头折点（相对坐标）
  points?: { x: number; y: number }[]; // polyline 点列（世界坐标）
  scientificRole?: NonNullable<CanvasElement["scientificRole"]>;
  scientificId?: string;
  scientificRegionId?: string;
}

export type MechanismCompartmentKind = "extracellular" | "membrane" | "cytoplasm" | "nucleus" | "organelle" | "custom";
export type MechanismNodeRole = "ligand" | "receptor" | "protein" | "kinase" | "complex" | "small-molecule" | "gene" | "output";
export type MechanismEdgeRelation = "activation" | "inhibition" | "binding" | "translocation" | "indirect";

export interface MechanismArgs {
  title?: string;
  compartments: { id: string; label: string; kind?: MechanismCompartmentKind; fill?: string }[];
  nodes: {
    id: string;
    text: string;
    compartment: string;
    role?: MechanismNodeRole;
    detail?: string;
    badge?: string;
    fill?: string;
  }[];
  edges: {
    from: string;
    to: string;
    relation?: MechanismEdgeRelation;
    label?: string;
  }[];
}

export type ScientificDomain = "ai" | "machine-learning" | "cybersecurity" | "big-data" | "general";
export type ScientificLayout = "pipeline" | "layered-lr" | "layered-tb";
export type ScientificNodeRole =
  | "data" | "tensor" | "process" | "model" | "neural-network" | "storage"
  | "service" | "decision" | "metric" | "user" | "network" | "threat"
  | "defense" | "output";
export type ScientificEdgeRelation =
  | "data-flow" | "control-flow" | "dependency" | "feedback"
  | "attack" | "defense" | "trust" | "association";

export interface ScientificDiagramArgs {
  title: string;
  subtitle?: string;
  domain?: ScientificDomain;
  layout?: ScientificLayout;
  groups?: { id: string; label: string; semantic?: "input" | "processing" | "model" | "storage" | "security" | "evaluation" | "output" | "control"; fill?: string }[];
  nodes: {
    id: string;
    text: string;
    role: ScientificNodeRole;
    group?: string;
    detail?: string;
    badge?: string;
    fill?: string;
  }[];
  edges: { from: string; to: string; relation?: ScientificEdgeRelation; label?: string }[];
  notes?: { text: string; target?: string; tone?: "neutral" | "positive" | "warning" | "critical" }[];
}

export type CNNStageOperation = "convolution" | "pooling" | "activation" | "normalization";
export interface CNNArchitectureArgs {
  title?: string;
  subtitle?: string;
  inputLabel?: string;
  inputShape?: string;
  stages?: {
    label: string;
    operation: CNNStageOperation;
    channels?: number | string;
    spatial?: string;
    kernel?: string;
    detail?: string;
  }[];
  denseUnits?: number | string;
  classes?: string[];
  notes?: string[];
}

export type PenMotifKind = "neural-network" | "feature-map" | "shield-lock" | "data-stream" | "cloud" | "server-cluster" | "attention" | "model-chip" | "agent-loop" | "custom";
export interface PenMotifArgs {
  kind: PenMotifKind;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke?: string;
  accent?: string;
  label?: string;
  scientificId?: string;
  regionId?: string;
  strokes?: { x: number; y: number }[][];
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

  private tagScientific(id: string | undefined, role: NonNullable<CanvasElement["scientificRole"]>, scientificId?: string, regionId?: string) {
    if (!id) return;
    const element = this.elements.find((e) => e.id === id);
    if (!element) return;
    element.scientificRole = role;
    if (scientificId) element.scientificId = scientificId;
    if (regionId) element.scientificRegionId = regionId;
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

  hasScientificFigure(): boolean {
    return hasScientificFigure(this.elements);
  }

  auditScientificFigure(): ScientificQualityReport {
    return auditScientificFigure(this.serialize());
  }

  correctScientificFigure(maxIterations = 2): { ok: boolean; before: ScientificQualityReport; after: ScientificQualityReport; corrections: string[] } {
    const before = this.auditScientificFigure();
    let current = before;
    const corrections: string[] = [];
    for (let iteration = 0; iteration < Math.max(1, Math.min(4, maxIterations)) && !current.passed; iteration++) {
      const corrected = correctScientificFigure(this.serialize(), current);
      if (!corrected.corrections.length) break;
      this.elements = corrected.document.elements;
      corrected.corrections.forEach((item) => corrections.push(item));
      for (const element of this.elements) if (element.scientificRole) this.touch(element.id);
      current = this.auditScientificFigure();
    }
    if (corrections.length) {
      this.ensureTextOnTop();
      this.activity.push(`科研质量纠错：完成 ${corrections.length} 项对象级修复`);
      this.changed();
    }
    return { ok: current.passed, before, after: current, corrections };
  }

  flushActivity(): string[] {
    const out = [...this.activity];
    this.activity = [];
    return out;
  }

  // 画笔语义图元：文本模型只选择含义和边界框，确定性模板负责把归一化笔迹
  // 转成可编辑的 pen 点列。既保留画笔的自由轮廓，也避免模型盲猜数十个像素坐标。
  applyPenMotif(args: PenMotifArgs): { ok: boolean; ids?: string[]; error?: string } {
    const width = Math.max(56, Math.min(420, args.width));
    const height = Math.max(48, Math.min(300, args.height));
    const x = Math.max(12, Math.min(args.x, CANVAS_WIDTH - width - 12));
    const y = Math.max(12, Math.min(args.y, CANVAS_HEIGHT - height - 12));
    const ink = args.stroke ?? "#334b5f";
    const accent = args.accent ?? "#4f72c9";
    const ids: string[] = [];
    const point = (px: number, py: number) => ({ x: x + px * width, y: y + py * height });
    const pen = (points: { x: number; y: number }[], color = ink, strokeWidth = 2) => {
      if (points.length < 2) return;
      const result = this.createElement({
        type: "pen", x, y, width, height, points, stroke: color, strokeWidth,
        scientificRole: "decoration", scientificId: args.scientificId, scientificRegionId: args.regionId,
      });
      if (result.id) ids.push(result.id);
    };
    const shape = (type: "rect" | "ellipse", sx: number, sy: number, sw: number, sh: number, fill: string, stroke = ink, rx?: number) => {
      const result = this.createElement({
        type, x: x + sx * width, y: y + sy * height, width: sw * width, height: sh * height,
        fill, stroke, strokeWidth: 1.6, rx, scientificRole: "decoration",
        scientificId: args.scientificId, scientificRegionId: args.regionId,
      });
      if (result.id) ids.push(result.id);
    };
    const polygon = (coords: [number, number][], color = ink, strokeWidth = 2) => pen([...coords, coords[0]].map(([px, py]) => point(px, py)), color, strokeWidth);

    if (args.kind === "custom") {
      if (!args.strokes?.length) return { ok: false, error: "custom 画笔图元至少需要一条归一化笔迹" };
      for (const stroke of args.strokes.slice(0, 16)) {
        pen(stroke.slice(0, 80).map((p) => point(Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y)))));
      }
    } else if (args.kind === "neural-network") {
      const layers = [[0.14, [0.28, 0.72]], [0.5, [0.18, 0.5, 0.82]], [0.86, [0.3, 0.7]]] as const;
      for (let i = 0; i < layers.length - 1; i++) for (const ay of layers[i][1]) for (const by of layers[i + 1][1]) pen([point(layers[i][0], ay), point(layers[i + 1][0], by)], "#9aacbd", 1.2);
      layers.forEach(([lx, ys], li) => ys.forEach((ly) => shape("ellipse", lx - 0.045, ly - 0.07, 0.09, 0.14, li === 1 ? "#e9e5ff" : "#e8f3ff", accent)));
    } else if (args.kind === "feature-map") {
      for (let i = 3; i >= 0; i--) {
        const o = i * 0.055;
        polygon([[0.18 + o, 0.18 - o], [0.78 + o, 0.18 - o], [0.66 + o, 0.78 - o], [0.06 + o, 0.78 - o]], i === 0 ? accent : "#7890a5", i === 0 ? 2.4 : 1.5);
      }
      pen([point(0.22, 0.35), point(0.61, 0.35), point(0.54, 0.62), point(0.15, 0.62), point(0.22, 0.35)], "#9b84d8", 1.2);
    } else if (args.kind === "shield-lock") {
      pen([[0.5, 0.06], [0.84, 0.2], [0.78, 0.62], [0.5, 0.92], [0.22, 0.62], [0.16, 0.2], [0.5, 0.06]].map(([px, py]) => point(px, py)), accent, 2.6);
      pen([point(0.38, 0.48), point(0.38, 0.37), point(0.42, 0.29), point(0.5, 0.26), point(0.58, 0.29), point(0.62, 0.37), point(0.62, 0.48)], ink, 2);
      shape("rect", 0.32, 0.46, 0.36, 0.28, "#edf3ff", ink, 8);
      pen([point(0.5, 0.54), point(0.5, 0.65)], accent, 2.4);
    } else if (args.kind === "data-stream") {
      for (let lane = 0; lane < 3; lane++) {
        const base = 0.27 + lane * 0.23;
        const pts = Array.from({ length: 13 }, (_, i) => point(0.04 + i * 0.075, base + Math.sin(i * 0.9 + lane) * 0.08));
        pen(pts, lane === 1 ? accent : "#7890a5", lane === 1 ? 2.5 : 1.6);
      }
      polygon([[0.89, 0.42], [0.98, 0.5], [0.89, 0.58]], accent, 2.2);
    } else if (args.kind === "cloud") {
      pen([[0.18, 0.72], [0.1, 0.65], [0.09, 0.53], [0.15, 0.43], [0.27, 0.4], [0.31, 0.24], [0.44, 0.15], [0.58, 0.2], [0.65, 0.34], [0.78, 0.32], [0.9, 0.42], [0.92, 0.58], [0.83, 0.72], [0.18, 0.72]].map(([px, py]) => point(px, py)), accent, 2.4);
      for (const px of [0.3, 0.5, 0.7]) pen([point(px, 0.48), point(px, 0.63)], "#8da1b3", 1.5);
    } else if (args.kind === "server-cluster") {
      for (let row = 0; row < 3; row++) {
        shape("rect", 0.18, 0.1 + row * 0.27, 0.64, 0.2, row === 1 ? "#e9efff" : "#f3f6f8", row === 1 ? accent : ink, 6);
        shape("ellipse", 0.68, 0.16 + row * 0.27, 0.05, 0.08, row === 1 ? accent : "#9bb0bf", "none");
      }
      pen([point(0.1, 0.2), point(0.1, 0.8), point(0.18, 0.8)], accent, 2);
    } else if (args.kind === "attention") {
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        const strength = (row + col * 2) % 4;
        const fills = ["#f2f5f8", "#dce8fb", "#b7ccf2", "#7799dc"];
        shape("rect", 0.18 + col * 0.16, 0.16 + row * 0.17, 0.13, 0.14, fills[strength], "#ffffff", 3);
      }
      pen([point(0.1, 0.84), point(0.86, 0.84)], ink, 1.5);
      pen([point(0.1, 0.84), point(0.1, 0.1)], ink, 1.5);
    } else if (args.kind === "model-chip") {
      shape("rect", 0.2, 0.18, 0.6, 0.64, "#eeeaff", accent, 10);
      shape("rect", 0.34, 0.34, 0.32, 0.32, "#ffffff", ink, 6);
      for (const t of [0.28, 0.43, 0.58, 0.73]) {
        pen([point(t, 0.06), point(t, 0.18)], ink, 1.7); pen([point(t, 0.82), point(t, 0.94)], ink, 1.7);
        pen([point(0.08, t), point(0.2, t)], ink, 1.7); pen([point(0.8, t), point(0.92, t)], ink, 1.7);
      }
    } else if (args.kind === "agent-loop") {
      const centers = [[0.5, 0.16], [0.18, 0.72], [0.82, 0.72]] as const;
      centers.forEach(([cx, cy], i) => shape("ellipse", cx - 0.09, cy - 0.11, 0.18, 0.22, i === 0 ? "#eeeaff" : "#e8f4ff", i === 0 ? accent : ink));
      pen([point(0.46, 0.27), point(0.28, 0.58), point(0.34, 0.53)], accent, 2.2);
      pen([point(0.3, 0.75), point(0.7, 0.75), point(0.64, 0.7)], accent, 2.2);
      pen([point(0.76, 0.62), point(0.56, 0.27), point(0.63, 0.31)], accent, 2.2);
    }
    if (args.label?.trim()) {
      const label = this.createElement({ type: "text", x, y: y + height + 6, width: 8, height: 8, text: args.label.trim(), fontSize: 11, bold: true, align: "left", fill: ink, scientificRole: "node-label", scientificId: args.scientificId, scientificRegionId: args.regionId });
      if (label.id) ids.push(label.id);
    }
    this.activity.push(`绘制画笔语义图元：${args.kind}（${ids.length} 个可编辑对象）`);
    return { ok: true, ids };
  }

  createElement(args: CreateArgs): { ok: boolean; id?: string; error?: string } {
    const allowed: ElementType[] = ["rect", "ellipse", "triangle", "diamond", "hexagon", "star", "cross", "donut", "half", "arrow", "polyline", "text", "logic", "formula", "pen"];
    if (!allowed.includes(args.type as ElementType)) return { ok: false, error: `未知元素类型: ${args.type}` };
    const w = Math.max(8, Number(args.width) || 8);
    const h = Math.max(8, Number(args.height) || 8);
    const r = clampRect({ x: args.x, y: args.y, width: w, height: h }, CANVAS_WIDTH, CANVAS_HEIGHT);
    const maxZ = this.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    let el: CanvasElement;
    if (args.type === "text" || args.type === "logic" || args.type === "formula") {
      el = makeElement(args.type as "text" | "logic" | "formula", r.x, r.y, r.width, r.height, {
        text: args.text === undefined ? (args.type === "logic" ? "" : args.type === "formula" ? "x^2" : "文字") : unescapeNewlines(args.text),
        body: args.body === undefined ? undefined : unescapeNewlines(args.body),
        fill: args.fill ?? "#2f2f2f",
        fontSize: args.fontSize,
        bold: args.bold,
        italic: args.italic,
        align: args.align,
        fontFamily: args.fontFamily,
        scientificRole: args.scientificRole,
        scientificId: args.scientificId,
        scientificRegionId: args.scientificRegionId,
        zIndex: maxZ + 1,
      });
    } else {
      el = makeElement(args.type as ElementType | "rounded", r.x, r.y, r.width, r.height, {
        fill: args.fill,
        stroke: args.stroke,
        strokeWidth: args.strokeWidth,
        dash: args.dash,
        fillOpacity: args.fillOpacity,
        strokeOpacity: args.strokeOpacity,
        rotation: args.rotation,
        rx: args.rx,
        head: args.type === "arrow" ? args.head : undefined,
        midPoints: args.type === "arrow" ? args.midPoints : undefined,
        points: args.type === "polyline" || args.type === "pen" ? args.points : undefined,
        scientificRole: args.scientificRole,
        scientificId: args.scientificId,
        scientificRegionId: args.scientificRegionId,
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
    if (next.type === "formula" && ("text" in patch || "fontSize" in patch || "bold" in patch)) {
      const size = estimateTextSize(latexToUnicode(next.text), next.fontSize, next.bold);
      next.width = size.width;
      next.height = size.height;
    }
    if (next.type === "logic" && ("text" in patch || "body" in patch || "fontSize" in patch || "bold" in patch)) {
      const size = logicBoxSize(next.text, next.body, next.fontSize, next.bold);
      next.width = Math.max(next.width, size.width);
      next.height = Math.max(next.height, size.height);
    }
    if (next.type === "arrow") {
      // 箭头的 width/height 是“终点 - 起点”的有向向量，负数与 0 都有意义；
      // 不能套用普通矩形的最小尺寸钳制，否则向左/向上的折线会被反转并飞向空白处。
      next.x = Math.min(Math.max(next.x, 0), CANVAS_WIDTH);
      next.y = Math.min(Math.max(next.y, 0), CANVAS_HEIGHT);
    } else {
      next.width = Math.max(4, next.width);
      next.height = Math.max(4, next.height);
      next.x = Math.min(Math.max(next.x, 0), CANVAS_WIDTH - next.width);
      next.y = Math.min(Math.max(next.y, 0), CANVAS_HEIGHT - next.height);
    }
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
    // 元素明细
    const items = this.elements.map((e) => ({
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
      scientificRole: e.scientificRole,
      scientificId: e.scientificId,
      scientificRegionId: e.scientificRegionId,
    }));
    // 画布总览：现有内容的外接范围 + 建议的空白起始位置，让 AI 纵观全画布再决定在哪里作图
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of this.elements) {
      minX = Math.min(minX, e.x);
      minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + e.width);
      maxY = Math.max(maxY, e.y + e.height);
    }
    const empty = this.elements.length === 0;
    const overview = empty
      ? "当前画布为空，可从任意位置开始绘制（建议以画布中心 (800,500) 为起点布局）"
      : `现有内容范围：x ${Math.round(minX)}~${Math.round(maxX)}，y ${Math.round(minY)}~${Math.round(maxY)}（画布 1600×1000）。` +
        `已有内容集中在上述区域，新增内容请放在其右侧或下方（x ≥ ${Math.round(maxX) + 40} 或 y ≥ ${Math.round(maxY) + 40}）的空白区域，避免重叠。`;
    return { overview, elements: items };
  }

  // 自动连接：从源形状边缘精确指向目标形状边缘的箭头（AI 无需手算坐标）
  connectElements(args: { sourceId: string; targetId: string; stroke?: string; strokeWidth?: number; dash?: number[]; head?: "none" | "single" | "double" }): { ok: boolean; id?: string; error?: string } {
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
      dash: args.dash,
      head: args.head,
      startId: s.id,
      endId: t.id,
      scientificRole: s.scientificRole === "node" || t.scientificRole === "node" ? "connector" : undefined,
      scientificId: s.scientificId && t.scientificId ? `${s.scientificId}->${t.scientificId}` : undefined,
      scientificRegionId: s.scientificRegionId ?? t.scientificRegionId,
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
    zones?: { label?: string; nodeIds: string[]; fill?: string }[];
  }): { ok: boolean; error?: string } {
    if (args.nodes.length === 0) return { ok: false, error: "节点列表不能为空" };
    const ids = new Set(args.nodes.map((n) => n.id));
    for (const e of args.edges) {
      if (!ids.has(e.from)) return { ok: false, error: `边引用了不存在的节点: ${e.from}` };
      if (!ids.has(e.to)) return { ok: false, error: `边引用了不存在的节点: ${e.to}` };
    }
    for (const z of args.zones ?? []) {
      for (const nid of z.nodeIds) {
        if (!ids.has(nid)) return { ok: false, error: `分区引用了不存在的节点: ${nid}` };
      }
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
    // 分区容器（Zone 策略，NeurIPS 风格）：浅色虚线圆角框把一组节点封装为一个阶段/环境，
    // 先画（zIndex 低、节点后画覆盖其上），标签放框内左上角
    for (const z of args.zones ?? []) {
      const members = z.nodeIds
        .map((id) => {
          const n = sized.find((s) => s.id === id);
          const p = pos.get(id);
          return n && p ? { x: p.x, y: p.y, width: n.width, height: n.height } : null;
        })
        .filter((m): m is { x: number; y: number; width: number; height: number } => m !== null);
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((m) => m.x));
      const minY = Math.min(...members.map((m) => m.y));
      const maxX = Math.max(...members.map((m) => m.x + m.width));
      const maxY = Math.max(...members.map((m) => m.y + m.height));
      const pad = 24;
      this.createElement({
        type: "rect",
        x: minX - pad,
        y: minY - pad,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
        fill: z.fill ?? "#eef4ff",
        fillOpacity: 0.5,
        stroke: "#2f2f2f",
        strokeWidth: 1.2,
        dash: [6, 4],
      });
      if (z.label) {
        this.createElement({
          type: "text",
          x: minX - pad + 8,
          y: minY - pad + 6,
          width: 8,
          height: 8,
          text: z.label,
          fontSize: 13,
          bold: true,
          fill: "#2f2f2f",
        });
      }
    }
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

  // 通用科研图引擎：面向 AI / ML / 网络安全 / 大数据，而不是面向 PowerPoint 流程框。
  // 输入是领域语义（节点角色、分组、关系），输出才是可编辑的基础元素组合。
  applyCNNArchitecture(args: CNNArchitectureArgs = {}): { ok: boolean; quality?: ScientificQualityReport } {
    const ink = "#16263a", muted = "#63758a", blue = "#315fce", cyan = "#38a7c7", violet = "#7557c8", amber = "#e49b38";
    const title = args.title?.trim() || "卷积神经网络（CNN）：从局部感受野到语义分类";
    const subtitle = args.subtitle?.trim() || "空间分辨率逐级压缩，通道深度持续扩展，最终将层级特征映射为类别概率";
    const stages = (args.stages?.length ? args.stages : [
      { label: "Conv 1", operation: "convolution" as const, channels: 32, spatial: "28×28", kernel: "3×3", detail: "边缘与方向" },
      { label: "MaxPool 1", operation: "pooling" as const, channels: 32, spatial: "14×14", kernel: "2×2", detail: "保留显著响应" },
      { label: "Conv 2", operation: "convolution" as const, channels: 64, spatial: "12×12", kernel: "3×3", detail: "纹理与局部形状" },
      { label: "MaxPool 2", operation: "pooling" as const, channels: 64, spatial: "6×6", kernel: "2×2", detail: "压缩空间冗余" },
    ]).slice(0, 5);
    const classes = (args.classes?.length ? args.classes : ["cat", "dog", "car", "bird"]).slice(0, 5);
    const text = (value: string, x: number, y: number, fontSize: number, bold = false, color = ink, role?: NonNullable<CanvasElement["scientificRole"]>, id?: string, region?: string) =>
      this.createElement({ type: "text", x, y, width: 8, height: 8, text: value, fontSize, bold, align: "left", fill: color, scientificRole: role, scientificId: id, scientificRegionId: region });
    const panel = (x: number, y: number, width: number, height: number, id: string) =>
      this.createElement({ type: "rect", x, y, width, height, rx: 18, fill: "#fbfcfe", stroke: "#d5deea", strokeWidth: 1.2, scientificRole: "container", scientificId: id, scientificRegionId: id });
    const link = (sourceId: string, targetId: string, id: string) => {
      const result = this.connectElements({ sourceId, targetId, stroke: blue, strokeWidth: 2.4, head: "single" });
      this.tagScientific(result.id, "connector", id, "architecture");
    };

    text(title, 76, 30, 27, true, ink, "title", "cnn-title");
    text(subtitle, 78, 70, 13, false, muted, "title", "cnn-subtitle");
    this.createElement({ type: "arrow", x: 76, y: 102, width: 1448, height: 0, head: "none", stroke: "#b7c5d6", strokeWidth: 1, scientificRole: "decoration", scientificId: "title-rule" });
    panel(70, 126, 1460, 560, "architecture");
    text("A", 92, 145, 16, true, blue, "node-label", "panel-a", "architecture");
    text("层级特征编码器", 120, 144, 15, true, ink, "node-label", "architecture-label", "architecture");

    const inputX = 105, inputY = 230, inputSize = 150;
    const inputNode = this.createElement({ type: "rect", x: inputX, y: inputY, width: inputSize, height: inputSize, rx: 10, fill: "#edf3fb", stroke: "#29445f", strokeWidth: 1.8, scientificRole: "node", scientificId: "cnn-input", scientificRegionId: "architecture" });
    const pixels = [0,1,1,0,0,0, 0,2,3,2,0,0, 1,3,4,3,2,0, 0,2,4,4,3,1, 0,1,3,4,2,0, 0,0,1,2,1,0];
    const pixelColors = ["#eef3f8", "#c9d8e7", "#89a8c2", "#4b708e", "#193b57"];
    pixels.forEach((value, i) => this.createElement({ type: "rect", x: inputX + 13 + (i % 6) * 21, y: inputY + 13 + Math.floor(i / 6) * 21, width: 20, height: 20, rx: 2, fill: pixelColors[value], stroke: "#ffffff", strokeWidth: 1, scientificRole: "decoration", scientificId: "input-pixel", scientificRegionId: "architecture" }));
    text(args.inputLabel?.trim() || "输入图像", 132, 400, 14, true, ink, "node-label", "input-label", "architecture");
    text(args.inputShape?.trim() || "32 × 32 × 3", 128, 424, 12, false, muted, "node-label", "input-shape", "architecture");

    const stageNodes: string[] = [];
    const gap = stages.length > 1 ? 655 / (stages.length - 1) : 0;
    stages.forEach((stage, i) => {
      const progress = stages.length === 1 ? 0 : i / (stages.length - 1);
      const w = Math.round(126 - progress * 48), h = Math.round(190 - progress * 76);
      const x = 335 + i * gap, y = 260 + (190 - h) / 2;
      const depth = Math.round(3 + progress * 3);
      const color = stage.operation === "pooling" ? cyan : violet;
      for (let layer = depth; layer >= 1; layer--) this.createElement({ type: "rect", x: x + layer * 7, y: y - layer * 7, width: w, height: h, rx: 5, fill: layer === 1 ? (stage.operation === "pooling" ? "#dff5f7" : "#ebe8fb") : "#f7f9fc", fillOpacity: layer === 1 ? 0.92 : 0.78, stroke: layer === 1 ? color : "#9eafc0", strokeWidth: layer === 1 ? 1.8 : 1.1, scientificRole: "decoration", scientificId: `${stage.label}-depth`, scientificRegionId: "architecture" });
      const front = this.createElement({ type: "rect", x, y, width: w, height: h, rx: 5, fill: stage.operation === "pooling" ? "#e7f8fa" : "#f0edff", fillOpacity: 0.64, stroke: color, strokeWidth: 2.1, scientificRole: "node", scientificId: `cnn-stage-${i}`, scientificRegionId: "architecture" });
      stageNodes.push(front.id!);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) if ((r * 3 + c * 2 + i) % 4 === 0) this.createElement({ type: "rect", x: x + 10 + c * ((w - 24) / 4), y: y + 12 + r * ((h - 26) / 5), width: Math.max(8, (w - 32) / 4), height: Math.max(8, (h - 34) / 5), rx: 2, fill: color, fillOpacity: 0.2 + ((r + c) % 3) * 0.13, stroke: "none", strokeWidth: 0, scientificRole: "decoration", scientificId: `${stage.label}-activation`, scientificRegionId: "architecture" });
      text(stage.label, x - 4, 475, 13, true, color, "node-label", `${stage.label}-label`, "architecture");
      text(`${stage.kernel ?? (stage.operation === "pooling" ? "2×2" : "3×3")} ${stage.operation === "pooling" ? "pool" : "conv"}`, x - 4, 499, 11, false, muted, "node-label", `${stage.label}-operation`, "architecture");
      text(`${stage.spatial ?? "?×?"} × ${stage.channels ?? "C"}`, x - 4, 520, 11, true, ink, "node-label", `${stage.label}-shape`, "architecture");
      if (stage.detail) text(stage.detail, x - 4, 544, 10, false, muted, "annotation", `${stage.label}-detail`, "architecture");
    });
    if (stageNodes.length) {
      link(inputNode.id!, stageNodes[0], "input-to-features");
      stageNodes.slice(1).forEach((id, i) => link(stageNodes[i], id, `stage-${i}-to-${i + 1}`));
    }

    const head = this.createElement({ type: "rect", x: 1090, y: 190, width: 385, height: 420, rx: 16, fill: "#ffffff", stroke: "#cbd6e2", strokeWidth: 1.3, scientificRole: "node", scientificId: "classifier-head", scientificRegionId: "architecture" });
    text("分类头", 1118, 214, 15, true, blue, "node-label", "head-label", "architecture");
    text("Flatten  →  Dense  →  Softmax", 1118, 244, 12, false, muted, "node-label", "head-flow", "architecture");
    [5, 7, 5].forEach((count, layer) => { for (let i = 0; i < count; i++) { const cy = 302 + i * (190 / Math.max(1, count - 1)); this.createElement({ type: "ellipse", x: 1140 + layer * 54, y: cy - 7, width: 14, height: 14, fill: layer === 1 ? "#e9e4fb" : "#e2effc", stroke: layer === 1 ? violet : blue, strokeWidth: 1.2, scientificRole: "decoration", scientificId: `dense-layer-${layer}`, scientificRegionId: "architecture" }); } });
    text(`${args.denseUnits ?? 128} units`, 1132, 516, 10, false, muted, "node-label", "dense-units", "architecture");
    const probs = [0.84, 0.48, 0.27, 0.13, 0.08];
    classes.forEach((label, i) => {
      const y = 308 + i * 42;
      text(label, 1310, y - 2, 10, false, ink, "node-label", `class-${i}`, "architecture");
      this.createElement({ type: "rect", x: 1350, y, width: 88, height: 12, rx: 6, fill: "#edf1f6", stroke: "none", strokeWidth: 0, scientificRole: "decoration", scientificId: `probability-track-${i}`, scientificRegionId: "architecture" });
      this.createElement({ type: "rect", x: 1350, y, width: 88 * probs[i], height: 12, rx: 6, fill: i === 0 ? amber : blue, fillOpacity: i === 0 ? 0.95 : 0.55, stroke: "none", strokeWidth: 0, scientificRole: "decoration", scientificId: `probability-${i}`, scientificRegionId: "architecture" });
    });
    if (stageNodes.length) link(stageNodes[stageNodes.length - 1], head.id!, "features-to-classifier");

    panel(70, 716, 650, 220, "receptive-field");
    text("B", 92, 738, 16, true, violet, "node-label", "panel-b", "receptive-field");
    text("局部感受野与权重共享", 120, 737, 15, true, ink, "node-label", "kernel-title", "receptive-field");
    const gridX = 112, gridY = 790, cell = 23;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) this.createElement({ type: "rect", x: gridX + c * cell, y: gridY + r * cell, width: cell, height: cell, rx: 1, fill: r >= 1 && r <= 3 && c >= 2 && c <= 4 ? "#efe9ff" : "#edf3f8", stroke: "#a9b7c5", strokeWidth: 0.8, scientificRole: "decoration", scientificId: "receptive-grid", scientificRegionId: "receptive-field" });
    this.createElement({ type: "rect", x: gridX + 2 * cell, y: gridY + cell, width: cell * 3, height: cell * 3, rx: 3, fill: "none", stroke: violet, strokeWidth: 2.4, scientificRole: "decoration", scientificId: "receptive-window", scientificRegionId: "receptive-field" });
    const kernelValues = ["−1","0","1","−2","0","2","−1","0","1"], kernelX = 330, kernelY = 812, k = 32;
    kernelValues.forEach((value, i) => { this.createElement({ type: "rect", x: kernelX + (i % 3) * k, y: kernelY + Math.floor(i / 3) * k, width: k, height: k, rx: 2, fill: i === 4 ? "#ffe9c8" : "#f3effd", stroke: violet, strokeWidth: 1, scientificRole: "decoration", scientificId: "kernel-cell", scientificRegionId: "receptive-field" }); text(value, kernelX + (i % 3) * k + 10, kernelY + Math.floor(i / 3) * k + 7, 11, i === 4, ink, "node-label", `kernel-value-${i}`, "receptive-field"); });
    this.createElement({ type: "arrow", x: 255, y: 850, width: 58, height: 0, head: "single", stroke: violet, strokeWidth: 2, scientificRole: "decoration", scientificId: "patch-to-kernel", scientificRegionId: "receptive-field" });
    text("卷积核在整幅图像上滑动", 460, 798, 12, true, violet, "annotation", "kernel-rule", "receptive-field");
    text("同一组权重检测相同模式，显著减少参数量", 460, 829, 11, false, muted, "annotation", "sharing-rule", "receptive-field");
    text("zᵢⱼ = σ(Σₘₙ Kₘₙ · Xᵢ₊ₘ,ⱼ₊ₙ + b)", 460, 868, 14, true, ink, "annotation", "conv-equation", "receptive-field");

    panel(744, 716, 786, 220, "principles");
    text("C", 766, 738, 16, true, amber, "node-label", "panel-c", "principles");
    text("读图要点", 794, 737, 15, true, ink, "node-label", "principles-title", "principles");
    const notes = (args.notes?.length ? args.notes : ["卷积：局部连接与共享权重提取可迁移模式", "池化：降低空间分辨率并增强平移鲁棒性", "层级表征：浅层边缘 → 中层纹理 → 高层语义"]).slice(0, 3);
    [violet, cyan, amber].slice(0, notes.length).forEach((color, i) => {
      const y = 786 + i * 48;
      this.createElement({ type: "ellipse", x: 786, y, width: 28, height: 28, fill: color, stroke: "none", strokeWidth: 0, scientificRole: "decoration", scientificId: `principle-number-${i}`, scientificRegionId: "principles" });
      text(String(i + 1), 795, y + 4, 12, true, "#ffffff", "node-label", `principle-index-${i}`, "principles");
      text(notes[i], 832, y + 3, 12, false, ink, "annotation", `principle-${i}`, "principles");
    });
    text("主张：CNN 通过逐级压缩空间、扩展通道，把局部模式组合为可分类语义。", 786, 910, 11, true, muted, "annotation", "figure-claim", "principles");
    this.ensureTextOnTop();
    this.activity.push(`完成 CNN 论文级结构图：${stages.length} 个特征阶段、局部感受野与分类概率均已可视化`);
    const gate = this.correctScientificFigure(2);
    return { ok: true, quality: gate.after };
  }

  private looksLikeCNN(args: ScientificDiagramArgs): boolean {
    const corpus = [args.title, args.subtitle, ...args.nodes.flatMap((n) => [n.text, n.detail, n.badge])].filter(Boolean).join(" ");
    return /(?:\bCNN\b|卷积神经网络|卷积层|Conv\s*\d*|Max\s*Pool|池化层)/i.test(corpus);
  }

  private cnnArgsFromScientific(args: ScientificDiagramArgs): CNNArchitectureArgs {
    const stages = args.nodes.flatMap((node) => {
      const value = [node.text, node.detail, node.badge].filter(Boolean).join(" ");
      const operation: CNNStageOperation | undefined = /(?:pool|池化)/i.test(value) ? "pooling" : /(?:conv|卷积)/i.test(value) ? "convolution" : /(?:relu|gelu|sigmoid|激活)/i.test(value) ? "activation" : /(?:batch\s*norm|\bbn\b|归一化)/i.test(value) ? "normalization" : undefined;
      if (!operation) return [];
      const channels = value.match(/(?:channels?|filters?|通道|卷积核)\D{0,4}(\d+)/i)?.[1] ?? value.match(/(\d+)\s*(?:channels?|filters?|通道|卷积核)/i)?.[1];
      const spatial = value.match(/(\d+\s*[×x]\s*\d+)/i)?.[1]?.replace(/x/gi, "×");
      const kernel = value.match(/([2357]\s*[×x]\s*[2357])/i)?.[1]?.replace(/x/gi, "×");
      return [{ label: node.text, operation, channels, spatial, kernel, detail: node.detail }];
    });
    const denseText = args.nodes.map((n) => [n.text, n.detail, n.badge].filter(Boolean).join(" ")).find((value) => /(?:dense|全连接|\bfc\b)/i.test(value));
    return { title: args.title, subtitle: args.subtitle, stages: stages.length >= 2 ? stages : undefined, denseUnits: denseText?.match(/\b(\d{2,5})\b/)?.[1], notes: args.notes?.map((note) => note.text) };
  }

  applyScientificDiagram(args: ScientificDiagramArgs): { ok: boolean; error?: string; quality?: ScientificQualityReport } {
    if (!args.title?.trim()) return { ok: false, error: "科研图必须有明确标题" };
    if (!args.nodes?.length) return { ok: false, error: "科研图至少需要一个节点" };
    const nodeIds = new Set(args.nodes.map((n) => n.id));
    const groupIds = new Set((args.groups ?? []).map((g) => g.id));
    if (nodeIds.size !== args.nodes.length) return { ok: false, error: "节点 id 不能重复" };
    if (groupIds.size !== (args.groups ?? []).length) return { ok: false, error: "分组 id 不能重复" };
    for (const n of args.nodes) if (n.group && !groupIds.has(n.group)) return { ok: false, error: `节点 ${n.id} 引用了不存在的分组: ${n.group}` };
    for (const e of args.edges) {
      if (!nodeIds.has(e.from)) return { ok: false, error: `关系引用了不存在的节点: ${e.from}` };
      if (!nodeIds.has(e.to)) return { ok: false, error: `关系引用了不存在的节点: ${e.to}` };
    }
    for (const note of args.notes ?? []) if (note.target && !nodeIds.has(note.target)) return { ok: false, error: `注释引用了不存在的节点: ${note.target}` };

    if (this.looksLikeCNN(args)) return this.applyCNNArchitecture(this.cnnArgsFromScientific(args));

    const domain = args.domain ?? "general";
    const layout = args.layout ?? (domain === "big-data" ? "layered-lr" : "pipeline");
    const ink = "#263746";
    const muted = "#607483";
    const domainAccent: Record<ScientificDomain, string> = {
      ai: "#5b5bd6",
      "machine-learning": "#316fa8",
      cybersecurity: "#157a6e",
      "big-data": "#a05a2c",
      general: "#3f6f8f",
    };
    const accent = domainAccent[domain];
    const semanticFill: Record<string, string> = {
      input: "#edf6ff", processing: "#eef4ff", model: "#f1ecff", storage: "#fff4e6",
      security: "#e8f7f3", evaluation: "#fff7dc", output: "#eaf7ee", control: "#f1f3f5",
    };
    const roleStyle: Record<ScientificNodeRole, { type: "logic" | "rect" | "ellipse" | "diamond" | "hexagon"; fill: string; width: number; height: number }> = {
      data: { type: "rect", fill: "#e7f2ff", width: 154, height: 66 },
      tensor: { type: "rect", fill: "#dcecff", width: 146, height: 66 },
      process: { type: "logic", fill: "#edf3ff", width: 164, height: 70 },
      model: { type: "hexagon", fill: "#eee7ff", width: 168, height: 76 },
      "neural-network": { type: "logic", fill: "#eee7ff", width: 176, height: 80 },
      storage: { type: "rect", fill: "#fff1dd", width: 154, height: 72 },
      service: { type: "logic", fill: "#e7f5ff", width: 158, height: 70 },
      decision: { type: "diamond", fill: "#fff4d6", width: 142, height: 86 },
      metric: { type: "ellipse", fill: "#fff4cc", width: 146, height: 66 },
      user: { type: "ellipse", fill: "#f1f3f5", width: 138, height: 64 },
      network: { type: "ellipse", fill: "#e8f7f3", width: 158, height: 72 },
      threat: { type: "diamond", fill: "#ffe4e4", width: 144, height: 88 },
      defense: { type: "hexagon", fill: "#dff5ec", width: 158, height: 76 },
      output: { type: "ellipse", fill: "#e4f5e9", width: 156, height: 68 },
    };

    const title = this.createElement({ type: "text", x: 88, y: 24, width: 8, height: 8, text: args.title, fontSize: 25, bold: true, align: "left", fill: "#17212b" });
    this.tagScientific(title.id, "title", "figure-title");
    if (args.subtitle) {
      const subtitle = this.createElement({ type: "text", x: 90, y: 60, width: 8, height: 8, text: args.subtitle, fontSize: 13, align: "left", fill: muted });
      this.tagScientific(subtitle.id, "title", "figure-subtitle");
    }
    const divider = this.createElement({ type: "arrow", x: 88, y: args.subtitle ? 88 : 68, width: 1424, height: 0, head: "none", stroke: accent, strokeWidth: 2 });
    this.tagScientific(divider.id, "decoration", "title-divider");

    const sized = args.nodes.map((n) => {
      const style = roleStyle[n.role];
      const titleWidth = estimateTextSize(n.text, 14, true).width;
      const titleFontSize = Math.max(11, Math.min(14, (style.width - 28) / Math.max(titleWidth, 1) * 14));
      const detailLines = n.detail ? wrapTextToWidth(n.detail, style.width - 28, 11) : [];
      const detail = detailLines.join("\n");
      const textSize = logicBoxSize(n.text, detail || undefined, titleFontSize, true);
      return {
        ...n,
        detail,
        detailLines,
        titleFontSize,
        width: Math.min(204, Math.max(style.width, textSize.width)),
        height: Math.max(style.height, textSize.height),
      };
    });
    const pos = new Map<string, { x: number; y: number }>();
    const rowByNode = new Map<string, number>();
    const contentTop = args.subtitle ? 132 : 112;
    if (layout === "pipeline") {
      // 论文图优先保持可读字号，宽度不足时折行；不通过压扁间距把所有节点硬塞进一行。
      const usableWidth = CANVAS_WIDTH - 176;
      const nodeGap = 52;
      const rows: typeof sized[] = [];
      let current: typeof sized = [];
      let currentWidth = 0;
      for (const node of sized) {
        const nextWidth = currentWidth + (current.length ? nodeGap : 0) + node.width;
        if (current.length && (nextWidth > usableWidth || current.length >= 6)) {
          rows.push(current);
          current = [];
          currentWidth = 0;
        }
        currentWidth += (current.length ? nodeGap : 0) + node.width;
        current.push(node);
      }
      if (current.length) rows.push(current);

      let rowY = contentTop + 58;
      rows.forEach((sourceRow, rowIndex) => {
        const row = rowIndex % 2 === 0 ? sourceRow : [...sourceRow].reverse();
        const rowWidth = row.reduce((sum, n) => sum + n.width, 0) + Math.max(0, row.length - 1) * nodeGap;
        const rowHeight = Math.max(...row.map((n) => n.height));
        let cursorX = (CANVAS_WIDTH - rowWidth) / 2;
        for (const n of row) {
          pos.set(n.id, { x: cursorX, y: rowY + (rowHeight - n.height) / 2 });
          rowByNode.set(n.id, rowIndex);
          cursorX += n.width + nodeGap;
        }
        rowY += rowHeight + 112;
      });
    } else {
      const graphPos = layoutGraph(
        sized.map((n) => ({ id: n.id, width: n.width, height: n.height })),
        args.edges,
        layout === "layered-lr" ? "LR" : "TB",
        82
      );
      let minX = Infinity, minY = Infinity, maxX = -Infinity;
      for (const n of sized) {
        const p = graphPos.get(n.id)!;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + n.width);
      }
      const offsetX = Math.max(20, (CANVAS_WIDTH - (maxX - minX)) / 2);
      for (const n of sized) {
        const p = graphPos.get(n.id)!;
        pos.set(n.id, { x: p.x - minX + offsetX, y: p.y - minY + contentTop + 52 });
      }
    }

    // 分组是宏观叙事层。pipeline 跨行时按行切成连续分区，避免一个巨大包围框跨过其他阶段并制造重叠。
    for (const group of args.groups ?? []) {
      const members = sized.filter((n) => n.group === group.id);
      if (!members.length) continue;
      const segments = layout === "pipeline"
        ? [...new Set(members.map((n) => rowByNode.get(n.id) ?? 0))].map((row) => members.filter((n) => (rowByNode.get(n.id) ?? 0) === row))
        : [members];
      segments.forEach((segment, segmentIndex) => {
        const minX = Math.min(...segment.map((n) => pos.get(n.id)!.x));
        const minY = Math.min(...segment.map((n) => pos.get(n.id)!.y));
        const maxX = Math.max(...segment.map((n) => pos.get(n.id)!.x + n.width));
        const maxY = Math.max(...segment.map((n) => pos.get(n.id)!.y + n.height));
        const padX = 24, padTop = 42, padBottom = 24;
        const gx = minX - padX, gy = minY - padTop;
        const gw = maxX - minX + padX * 2, gh = maxY - minY + padTop + padBottom;
        const fill = group.fill ?? semanticFill[group.semantic ?? "processing"];
        const container = this.createElement({ type: "rect", x: gx, y: gy, width: gw, height: gh, fill, fillOpacity: 0.42, stroke: "#a9b6c0", strokeWidth: 1.1, rx: 12 });
        this.tagScientific(container.id, "container", group.id, group.id);
        this.createElement({ type: "rect", x: gx, y: gy, width: gw, height: 5, fill: accent, fillOpacity: 0.68, stroke: accent, strokeWidth: 0, rx: 3 });
        this.createElement({ type: "text", x: gx + 13, y: gy + 12, width: 8, height: 8, text: segmentIndex ? `${group.label}（续）` : group.label, fontSize: 13, bold: true, align: "left", fill: ink });
      });
    }

    const idMap = new Map<string, string>();
    const addCenteredText = (text: string, box: { x: number; y: number; width: number; height: number }, fontSize: number, bold = false, color = ink) => {
      const size = estimateTextSize(text, fontSize, bold);
      return this.createElement({ type: "text", x: box.x + (box.width - size.width) / 2, y: box.y + (box.height - size.height) / 2, width: 8, height: 8, text, fontSize, bold, fill: color });
    };
    const addNodeText = (
      title: string,
      detailLines: string[],
      box: { x: number; y: number; width: number; height: number },
      titleFontSize: number,
      color = ink
    ) => {
      const titleSize = estimateTextSize(title, titleFontSize, true);
      const detailFontSize = 11;
      const detailHeight = detailLines.length * detailFontSize * 1.4;
      const gap = detailLines.length ? 4 : 0;
      const totalHeight = titleSize.height + gap + detailHeight;
      let y = box.y + (box.height - totalHeight) / 2;
      this.createElement({ type: "text", x: box.x + (box.width - titleSize.width) / 2, y, width: 8, height: 8, text: title, fontSize: titleFontSize, bold: true, fill: color });
      y += titleSize.height + gap;
      for (const line of detailLines) {
        const lineSize = estimateTextSize(line, detailFontSize);
        this.createElement({ type: "text", x: box.x + (box.width - lineSize.width) / 2, y, width: 8, height: 8, text: line, fontSize: detailFontSize, fill: muted });
        y += detailFontSize * 1.4;
      }
    };
    for (const n of sized) {
      const style = roleStyle[n.role];
      const p = pos.get(n.id)!;
      const box = { x: p.x, y: p.y, width: n.width, height: n.height };
      let r: { ok: boolean; id?: string; error?: string };
      if (n.role === "tensor") {
        this.createElement({ type: "rect", x: p.x + 12, y: p.y - 12, width: n.width, height: n.height, fill: "#c8dcf3", stroke: "#66839b", strokeWidth: 1.2, rx: 5 });
        this.createElement({ type: "rect", x: p.x + 6, y: p.y - 6, width: n.width, height: n.height, fill: "#d8e8f8", stroke: "#66839b", strokeWidth: 1.2, rx: 5 });
        r = this.createElement({ type: "rect", ...box, fill: n.fill ?? style.fill, stroke: "#46657d", strokeWidth: 1.7, rx: 5 });
        addNodeText(n.text, n.detailLines, box, n.titleFontSize);
      } else if (n.role === "storage") {
        r = this.createElement({ type: "rect", ...box, fill: n.fill ?? style.fill, stroke: "#8c683e", strokeWidth: 1.7, rx: 8 });
        this.createElement({ type: "ellipse", x: p.x, y: p.y - 9, width: n.width, height: 22, fill: "#fff8ec", stroke: "#8c683e", strokeWidth: 1.5 });
        this.createElement({ type: "ellipse", x: p.x, y: p.y + n.height - 13, width: n.width, height: 22, fill: n.fill ?? style.fill, fillOpacity: 0.65, stroke: "#8c683e", strokeWidth: 1.2 });
        addNodeText(n.text, n.detailLines, box, n.titleFontSize);
      } else if (style.type === "logic") {
        r = this.createElement({ type: "logic", ...box, text: n.text, body: n.detail, fill: n.fill ?? style.fill, fontSize: n.titleFontSize, bold: true, stroke: "#40515f", strokeWidth: 1.7, rx: 8 });
      } else {
        r = this.createElement({ type: style.type, ...box, fill: n.fill ?? style.fill, stroke: n.role === "threat" ? "#ad3d3d" : "#40515f", strokeWidth: 1.7, rx: 7 });
        addNodeText(n.text, n.detailLines, box, n.titleFontSize, n.role === "threat" ? "#8b2525" : ink);
      }
      idMap.set(n.id, r.id!);
      this.tagScientific(r.id, "node", n.id, n.group);
      if (n.badge) {
        const badgeSize = estimateTextSize(n.badge, 10, true);
        const badgeW = Math.max(30, badgeSize.width + 14);
        this.createElement({ type: "rect", x: p.x + n.width - badgeW + 7, y: p.y - 14, width: badgeW, height: 24, fill: accent, stroke: "#ffffff", strokeWidth: 1.5, rx: 12 });
        this.createElement({ type: "text", x: p.x + n.width - badgeW + 7 + (badgeW - badgeSize.width) / 2, y: p.y - 14 + (24 - badgeSize.height) / 2, width: 8, height: 8, text: n.badge, fontSize: 10, bold: true, fill: "#ffffff" });
      }
    }

    const edgeStyle: Record<ScientificEdgeRelation, { stroke: string; dash?: number[]; head: "none" | "single" | "double" }> = {
      "data-flow": { stroke: accent, head: "single" },
      "control-flow": { stroke: "#5b6570", dash: [7, 4], head: "single" },
      dependency: { stroke: "#566a78", head: "single" },
      feedback: { stroke: "#8a5aa5", dash: [8, 4], head: "single" },
      attack: { stroke: "#c43d3d", head: "single" },
      defense: { stroke: "#16806f", head: "single" },
      trust: { stroke: "#2e7d59", dash: [3, 3], head: "double" },
      association: { stroke: "#7a858d", head: "none" },
    };
    const nodeOrder = new Map(sized.map((node, index) => [node.id, index]));
    for (const edge of args.edges) {
      const relation = edge.relation ?? "data-flow";
      const style = edgeStyle[relation];
      const result = this.connectElements({ sourceId: idMap.get(edge.from)!, targetId: idMap.get(edge.to)!, stroke: style.stroke, strokeWidth: relation === "attack" ? 2.4 : 2, dash: style.dash, head: style.head });
      this.tagScientific(result.id, "connector", `${edge.from}->${edge.to}`, sized.find((n) => n.id === edge.from)?.group);
      const arrow = this.elements.find((e) => e.id === result.id && e.type === "arrow");
      if (arrow?.type === "arrow" && relation === "feedback") {
        const bend = Math.abs(arrow.width) > Math.abs(arrow.height) ? { x: arrow.width / 2, y: -62, smooth: true } : { x: 70, y: arrow.height / 2, smooth: true };
        this.updateElement({ id: arrow.id, patch: { midPoints: [bend] } });
      } else if (arrow?.type === "arrow" && layout === "pipeline") {
        const fromRow = rowByNode.get(edge.from) ?? 0;
        const toRow = rowByNode.get(edge.to) ?? 0;
        if (fromRow !== toRow) {
          // 跨行连接走两折正交路径，并经过行间留白，不斜穿节点或分区。
          this.updateElement({
            id: arrow.id,
            patch: { midPoints: [{ x: 0, y: arrow.height / 2 }, { x: arrow.width, y: arrow.height / 2 }] },
          });
        } else if (Math.abs((nodeOrder.get(edge.from) ?? 0) - (nodeOrder.get(edge.to) ?? 0)) > 1) {
          // 同行跨越多个节点的非主链关系从分区上方绕行。
          this.updateElement({
            id: arrow.id,
            patch: { midPoints: [{ x: 0, y: -42 }, { x: arrow.width, y: -42 }] },
          });
        }
      }
      if (arrow?.type === "arrow" && edge.label) {
        const labelSize = estimateTextSize(edge.label, 11, true);
        const feedbackOffsetX = relation === "feedback" ? 52 : 0;
        const feedbackOffsetY = relation === "feedback" ? 18 : 0;
        const lx = arrow.x + arrow.width / 2 - labelSize.width / 2 + feedbackOffsetX;
        const ly = arrow.y + arrow.height / 2 - labelSize.height - 5 + feedbackOffsetY;
        this.createElement({ type: "rect", x: lx - 5, y: ly - 2, width: labelSize.width + 10, height: labelSize.height + 4, fill: "#ffffff", fillOpacity: 0.9, stroke: "#ffffff", strokeWidth: 0, rx: 4 });
        this.createElement({ type: "text", x: lx, y: ly, width: 8, height: 8, text: edge.label, fontSize: 11, bold: true, fill: style.stroke });
      }
    }

    // 注释紧随主图形成论文式 caption/evidence band；按真实文字高度换行，不再硬编码到画布底部。
    const notes = args.notes ?? [];
    const diagramBottom = Math.max(...sized.map((n) => pos.get(n.id)!.y + n.height)) + 28;
    const noteColumns = Math.min(3, Math.max(1, notes.length));
    const noteGap = 24;
    const noteWidth = Math.min(440, (CANVAS_WIDTH - 176 - noteGap * (noteColumns - 1)) / noteColumns);
    const noteLayouts = notes.map((note) => {
      const tone = note.tone ?? "neutral";
      const toneStyle = {
        neutral: { fill: "#f4f6f8", stroke: "#8b99a3" }, positive: { fill: "#eaf7ee", stroke: "#3b8f5a" },
        warning: { fill: "#fff6dc", stroke: "#a97816" }, critical: { fill: "#ffe9e9", stroke: "#b34444" },
      }[tone];
      const targetName = note.target ? sized.find((n) => n.id === note.target)?.text : undefined;
      const displayText = targetName ? `【${targetName}】${note.text}` : note.text;
      const lines = wrapTextToWidth(displayText, noteWidth - 32, 12);
      const textSize = textLinesSize(lines, 12);
      return { toneStyle, lines, height: Math.max(58, textSize.height + 26) };
    });
    let noteBottom = diagramBottom;
    for (let rowStart = 0; rowStart < noteLayouts.length; rowStart += noteColumns) {
      const row = noteLayouts.slice(rowStart, rowStart + noteColumns);
      const previousRowsHeight = noteLayouts
        .slice(0, rowStart)
        .reduce((sum, _item, i, all) => i % noteColumns === 0 ? sum + Math.max(...all.slice(i, i + noteColumns).map((entry) => entry.height)) + noteGap : sum, 0);
      const y = diagramBottom + 42 + previousRowsHeight;
      const rowHeight = Math.max(...row.map((item) => item.height));
      const rowWidth = row.length * noteWidth + Math.max(0, row.length - 1) * noteGap;
      const rowX = (CANVAS_WIDTH - rowWidth) / 2;
      row.forEach((item, columnIndex) => {
        const x = rowX + columnIndex * (noteWidth + noteGap);
        this.createElement({ type: "rect", x, y, width: noteWidth, height: rowHeight, fill: item.toneStyle.fill, fillOpacity: 0.7, stroke: item.toneStyle.stroke, strokeWidth: 1.1, rx: 7 });
        let textY = y + (rowHeight - item.lines.length * 12 * 1.4) / 2;
        for (const line of item.lines) {
          this.createElement({ type: "text", x: x + 16, y: textY, width: 8, height: 8, text: line, fontSize: 12, align: "left", fill: ink });
          textY += 12 * 1.4;
        }
      });
      noteBottom = Math.max(noteBottom, y + rowHeight);
    }

    const relationLabels: Record<ScientificEdgeRelation, string> = {
      "data-flow": "数据流", "control-flow": "控制流", dependency: "依赖", feedback: "反馈",
      attack: "攻击路径", defense: "防御/缓解", trust: "信任边界", association: "关联",
    };
    const used = [...new Set(args.edges.map((e) => e.relation ?? "data-flow"))];
    const legendY = (notes.length ? noteBottom : diagramBottom) + 38;
    used.slice(0, 5).forEach((relation, i) => {
      const style = edgeStyle[relation];
      const x = 96 + i * 174;
      this.createElement({ type: "arrow", x, y: legendY, width: 34, height: 0, head: style.head, stroke: style.stroke, strokeWidth: 1.8, dash: style.dash });
      this.createElement({ type: "text", x: x + 43, y: legendY - 9, width: 8, height: 8, text: relationLabels[relation], fontSize: 10, align: "left", fill: muted });
    });
    this.activity.push(`完成科研图：${args.nodes.length} 个语义节点、${args.edges.length} 条关系、${(args.groups ?? []).length} 个功能分区`);
    const gate = this.correctScientificFigure(2);
    const quality = gate.after;
    this.activity.push(`科研质量门禁：几何 ${Math.round(quality.scores.geometry * 100)}、连线 ${Math.round(quality.scores.connectorClarity * 100)}、排版 ${Math.round(quality.scores.typographyColor * 100)}，${quality.passed ? "通过" : `仍有 ${quality.hardFailures} 项硬错误`}`);
    return { ok: true, quality };
  }

  // 生物医学机制图：以空间区室而非“流程框分组”为第一布局语义。
  // 配体、受体、蛋白/激酶、复合体、基因和输出使用稳定的视觉编码；
  // 激活、抑制、结合、转位和间接作用也使用不同线型，避免把机制图退化成普通流程图。
  applyMechanism(args: MechanismArgs): { ok: boolean; error?: string } {
    if (!args.compartments?.length) return { ok: false, error: "机制图至少需要一个空间区室" };
    if (!args.nodes?.length) return { ok: false, error: "机制图至少需要一个机制节点" };
    const compartmentIds = new Set(args.compartments.map((c) => c.id));
    const nodeIds = new Set(args.nodes.map((n) => n.id));
    if (compartmentIds.size !== args.compartments.length) return { ok: false, error: "区室 id 不能重复" };
    if (nodeIds.size !== args.nodes.length) return { ok: false, error: "节点 id 不能重复" };
    for (const n of args.nodes) {
      if (!compartmentIds.has(n.compartment)) return { ok: false, error: `节点 ${n.id} 引用了不存在的区室: ${n.compartment}` };
    }
    for (const e of args.edges) {
      if (!nodeIds.has(e.from)) return { ok: false, error: `关系引用了不存在的节点: ${e.from}` };
      if (!nodeIds.has(e.to)) return { ok: false, error: `关系引用了不存在的节点: ${e.to}` };
    }

    const palette: Record<MechanismCompartmentKind, string> = {
      extracellular: "#fffaf0",
      membrane: "#eef3f5",
      cytoplasm: "#f7fbff",
      nucleus: "#f3faf5",
      organelle: "#faf6ff",
      custom: "#f7f8fa",
    };
    const titleY = args.title ? 28 : 8;
    if (args.title) {
      this.createElement({ type: "text", x: 100, y: titleY, width: 8, height: 8, text: args.title, fontSize: 24, bold: true, align: "left", fill: "#17212b" });
      this.createElement({ type: "arrow", x: 100, y: 68, width: 1400, height: 0, head: "none", stroke: "#9aa8b4", strokeWidth: 1 });
    }

    const top = args.title ? 92 : 48;
    const bottom = 925;
    const usableH = bottom - top;
    const weights = args.compartments.map((c) => (c.kind === "membrane" ? 0.48 : 1));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    const bands = new Map<string, { x: number; y: number; width: number; height: number; kind: MechanismCompartmentKind }>();
    let cursorY = top;
    args.compartments.forEach((c, index) => {
      const kind = c.kind ?? "custom";
      const height = usableH * (weights[index] / weightTotal);
      const band = { x: 72, y: cursorY, width: 1456, height, kind };
      bands.set(c.id, band);
      this.createElement({
        type: "rect", x: band.x, y: band.y, width: band.width, height: band.height,
        fill: c.fill ?? palette[kind], fillOpacity: kind === "membrane" ? 0.92 : 0.62,
        stroke: kind === "membrane" ? "#78909c" : "#c4cdd5", strokeWidth: kind === "membrane" ? 1.8 : 1,
        rx: kind === "nucleus" || kind === "organelle" ? 24 : 10,
      });
      this.createElement({ type: "text", x: 88, y: band.y + 10, width: 8, height: 8, text: c.label, fontSize: 15, bold: true, align: "left", fill: "#44515c" });

      // 双层膜 + 磷脂头部节律，让“膜”在视觉上是真正的生物结构，而不是虚线分组框。
      if (kind === "membrane") {
        const y1 = band.y + band.height * 0.34;
        const y2 = band.y + band.height * 0.66;
        this.createElement({ type: "arrow", x: band.x + 18, y: y1, width: band.width - 36, height: 0, head: "none", stroke: "#607d8b", strokeWidth: 2 });
        this.createElement({ type: "arrow", x: band.x + 18, y: y2, width: band.width - 36, height: 0, head: "none", stroke: "#607d8b", strokeWidth: 2 });
        for (let x = band.x + 52; x < band.x + band.width - 24; x += 72) {
          this.createElement({ type: "ellipse", x: x - 5, y: y1 - 5, width: 10, height: 10, fill: "#b9d7e3", stroke: "#607d8b", strokeWidth: 1 });
          this.createElement({ type: "ellipse", x: x - 5, y: y2 - 5, width: 10, height: 10, fill: "#b9d7e3", stroke: "#607d8b", strokeWidth: 1 });
        }
      }
      cursorY += height;
    });

    const nodePosition = new Map<string, { x: number; y: number; width: number; height: number }>();
    const roleStyle: Record<MechanismNodeRole, { type: "logic" | "ellipse" | "hexagon" | "diamond" | "rect"; fill: string; width: number; height: number }> = {
      ligand: { type: "ellipse", fill: "#fff0b8", width: 132, height: 54 },
      receptor: { type: "logic", fill: "#dce8ff", width: 148, height: 76 },
      protein: { type: "logic", fill: "#eef4ff", width: 126, height: 58 },
      kinase: { type: "logic", fill: "#eee5ff", width: 126, height: 58 },
      complex: { type: "hexagon", fill: "#e3f3ff", width: 142, height: 64 },
      "small-molecule": { type: "diamond", fill: "#fff0d8", width: 112, height: 66 },
      gene: { type: "rect", fill: "#ddf4e4", width: 148, height: 58 },
      output: { type: "ellipse", fill: "#dff3e6", width: 156, height: 60 },
    };

    for (const compartment of args.compartments) {
      const members = args.nodes.filter((n) => n.compartment === compartment.id);
      if (!members.length) continue;
      const band = bands.get(compartment.id)!;
      const maxCols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(members.length * 1.8))));
      const rows = Math.ceil(members.length / maxCols);
      members.forEach((n, index) => {
        const role = n.role ?? "protein";
        const style = roleStyle[role];
        const row = Math.floor(index / maxCols);
        const rowStart = row * maxCols;
        const rowCount = Math.min(maxCols, members.length - rowStart);
        const logicalCol = index - rowStart;
        const col = row % 2 === 0 ? logicalCol : rowCount - 1 - logicalCol;
        const xStep = Math.min(240, (band.width - 250) / Math.max(rowCount, 1));
        const rowWidth = xStep * rowCount;
        const x = band.x + (band.width - rowWidth) / 2 + col * xStep + (xStep - style.width) / 2;
        const headerSpace = 34;
        const rowSpace = Math.max(72, (band.height - headerSpace) / Math.max(rows, 1));
        const y = band.y + headerSpace + row * rowSpace + Math.max(0, (rowSpace - style.height) / 2);
        nodePosition.set(n.id, { x, y, width: style.width, height: style.height });
      });
    }

    const idMap = new Map<string, string>();
    for (const n of args.nodes) {
      const role = n.role ?? "protein";
      const style = roleStyle[role];
      const p = nodePosition.get(n.id)!;
      const r = this.createElement({
        type: style.type, x: p.x, y: p.y, width: p.width, height: p.height,
        text: style.type === "logic" ? n.text : undefined,
        body: style.type === "logic" ? n.detail : undefined,
        fill: n.fill ?? style.fill, stroke: "#40515f", strokeWidth: role === "receptor" ? 2.4 : 1.7,
        rx: role === "gene" ? 4 : 10, fontSize: 14, bold: true,
      });
      idMap.set(n.id, r.id!);
      if (style.type !== "logic") {
        const labelSize = estimateTextSize(n.text, 14, true);
        this.createElement({ type: "text", x: p.x + (p.width - labelSize.width) / 2, y: p.y + (p.height - labelSize.height) / 2, width: 8, height: 8, text: n.text, fontSize: 14, bold: true, fill: "#263746" });
        if (n.detail) {
          const detailSize = estimateTextSize(n.detail, 11);
          this.createElement({ type: "text", x: p.x + (p.width - detailSize.width) / 2, y: p.y + p.height + 5, width: 8, height: 8, text: n.detail, fontSize: 11, fill: "#536574" });
        }
      }
      if (n.badge) {
        this.createElement({ type: "ellipse", x: p.x + p.width - 18, y: p.y - 9, width: 27, height: 27, fill: "#ffd166", stroke: "#9c6b00", strokeWidth: 1.2 });
        const badgeSize = estimateTextSize(n.badge, 11, true);
        this.createElement({ type: "text", x: p.x + p.width - 18 + (27 - badgeSize.width) / 2, y: p.y - 9 + (27 - badgeSize.height) / 2, width: 8, height: 8, text: n.badge, fontSize: 11, bold: true, fill: "#674500" });
      }
    }

    const relationStyle: Record<MechanismEdgeRelation, { stroke: string; dash?: number[]; head: "none" | "single" | "double" }> = {
      activation: { stroke: "#2f6f9f", head: "single" },
      inhibition: { stroke: "#b33a3a", head: "none" },
      binding: { stroke: "#59636d", head: "double" },
      translocation: { stroke: "#7b4ca0", dash: [8, 5], head: "single" },
      indirect: { stroke: "#6f7b83", dash: [4, 4], head: "single" },
    };
    for (const edge of args.edges) {
      const relation = edge.relation ?? "activation";
      const style = relationStyle[relation];
      const r = this.connectElements({ sourceId: idMap.get(edge.from)!, targetId: idMap.get(edge.to)!, stroke: style.stroke, strokeWidth: 2, dash: style.dash, head: style.head });
      const arrow = this.elements.find((e) => e.id === r.id && e.type === "arrow");
      if (arrow?.type === "arrow") {
        const x2 = arrow.x + arrow.width;
        const y2 = arrow.y + arrow.height;
        if (relation === "inhibition") {
          const length = Math.hypot(arrow.width, arrow.height) || 1;
          const px = (-arrow.height / length) * 10;
          const py = (arrow.width / length) * 10;
          this.createElement({ type: "arrow", x: x2 - px, y: y2 - py, width: px * 2, height: py * 2, head: "none", stroke: style.stroke, strokeWidth: 2.6 });
        }
        if (edge.label) {
          this.createElement({ type: "text", x: arrow.x + arrow.width / 2 - 20, y: arrow.y + arrow.height / 2 - 19, width: 8, height: 8, text: edge.label, fontSize: 11, bold: true, fill: style.stroke });
        }
      }
    }

    const usedRelations = [...new Set(args.edges.map((e) => e.relation ?? "activation"))];
    if (usedRelations.length > 1) {
      const labels: Record<MechanismEdgeRelation, string> = { activation: "激活", inhibition: "抑制", binding: "结合", translocation: "转位", indirect: "间接作用" };
      const legendX = 1110;
      const legendY = 945;
      usedRelations.forEach((relation, i) => {
        const style = relationStyle[relation];
        this.createElement({ type: "arrow", x: legendX + i * 105, y: legendY, width: 36, height: 0, head: relation === "inhibition" ? "none" : style.head, stroke: style.stroke, strokeWidth: 2, dash: style.dash });
        this.createElement({ type: "text", x: legendX + 42 + i * 105, y: legendY - 9, width: 8, height: 8, text: labels[relation], fontSize: 11, align: "left", fill: "#44515c" });
      });
    }
    this.activity.push(`完成机制图：${args.compartments.length} 个空间区室、${args.nodes.length} 个机制节点、${args.edges.length} 条作用关系`);
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
    if (args.data.some((d) => !Number.isFinite(d.value) || d.value < 0)) return { ok: false, error: "数值必须是非负数字" };
    // 空标签会在画布上产生空白刻度/图例（z.string() 接受 ""），与 applyMindMap 空关键词兜底精神一致
    if (args.data.some((d) => !d.label.trim())) return { ok: false, error: "分类标签不能为空" };
    // 全零数据（如饼图）静默空成功：引擎按 total<=0 返回空图形，必须显式拒绝
    if (args.data.reduce((s, d) => s + d.value, 0) <= 0) return { ok: false, error: "数据总和必须大于 0" };
    const chartId = `c-${Math.random().toString(36).slice(2, 10)}`;
    // 多图表平铺：画布已有图表时，新图表自动分配到网格空位（0.5 倍缩放，避免与旧图重叠错位）
    let spec: ChartSpec = args;
    if (!args.at) {
      const existing = Object.keys(this.charts).length;
      if (existing > 0) {
        const col = existing % 2;
        const row = Math.floor(existing / 2);
        spec = { ...args, at: { x: col * 850, y: row * 520, scale: 0.5 } };
      }
    }
    const els = layoutChart(spec, chartId);
    for (const el of els) this.pushElement(el);
    this.charts[chartId] = structuredClone(spec);
    this.activity.push(`图表已生成：${chartTypeName(args.type)}（${args.data.length} 项数据）`);
    return { ok: true };
  }

  clear(): { ok: boolean; note?: string } {
    // 空画布清空无破坏性，直接跳过
    if (this.elements.length === 0) {
      this.activity.push("画布已是空的");
      return { ok: true };
    }
    // 清空当前画布 = 破坏性操作：挂起确认，用户允许后才清空（与新建画布同级）
    if (this.pendingConfirms.some((p) => p.id === "clear-canvas")) return { ok: true, note: "清空画布已在等待确认" };
    this.pendingConfirms.push({
      id: "clear-canvas",
      description: "清空当前画布上的全部内容",
      apply: () => this.applyClear(),
    });
    return { ok: true, note: "清空画布已挂起，等待用户确认" };
  }

  private applyClear() {
    // 清空前 touch 全部被移除元素：确认流回发的快照 touched 需包含它们，
    // 前端才把这些 id 加锁，mergePreserved 才不会被当作"用户本地新增"保留
    const removed = this.elements;
    this.elements = [];
    this.charts = {}; // 图表声明一并清空：清空 = 全部内容消失，残留 charts 会让后续重排/导出异常
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
    arrow: "箭头", polyline: "折线", text: "文字", logic: "逻辑节点", formula: "公式",
    curve: "曲线", sector: "扇形",
  };
  return map[t] ?? t;
}

function chartTypeName(t: string): string {
  const map: Record<string, string> = { bar: "柱状图", line: "折线图", pie: "饼图", scatter: "散点图" };
  return map[t] ?? t;
}
