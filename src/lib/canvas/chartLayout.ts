import { makeElement, estimateTextSize } from "./elements";
import { CANVAS_WIDTH, CANVAS_HEIGHT, elementBounds } from "./geometry";
import type { CanvasElement, ChartBind, PolylineElement, ArrowElement } from "./types";

export interface ChartDatum {
  label: string;
  value: number;
  series?: string;
  color?: string; // 该条目的图例/图形颜色（缺省自动配色）
}
export interface ChartSpec {
  type: "bar" | "line" | "pie" | "scatter";
  title?: string;
  xLabel?: string;
  yLabel?: string;
  // 数值单位（如 "万元"、"人"、"%"）：饼图标签显示为 "数值单位 (百分比)"，图例可读
  unit?: string;
  // 饼图标签：true = 显示具体数值（如 "50万元 (25%)"）；缺省 false = 只显示占比（如 "25%"）
  showValues?: boolean;
  data: ChartDatum[];
  // 图表变体：pie 支持 "hollow"（空心/圆环饼图），缺省实心
  variant?: string;
  // 饼图起始角度（弧度，缺省 -π/2 即 12 点方向）：拖动起始接缝时整体旋转用
  pieStart?: number;
  // 图表摆放位置（多图表平铺用）：scale 缩放整图、x/y 平移整图；缺省 = 默认 PLOT 区域
  at?: { x?: number; y?: number; scale?: number };
  // 整图镜像（属性面板「操作」翻转整张图表）：水平/垂直各一轴，翻转后 recomputeChart 仍保留
  flipH?: boolean;
  flipV?: boolean;
  // x 轴刻度标签间隔：数据点多时每隔 xStep 个分类显示一个刻度标签（如 30 个点、每 5 个标一个，
  // 用户要求"每 N 年一个刻度"时传该值）；缺省自动稀疏化到 ≤15 个标签避免拥挤
  xStep?: number;
  // 元素级微调（图表编辑对话框预览内手动拖动/缩放/改字号）：键 = chartElemKey(e)，
  // 值为相对默认布局的偏移量。layoutChart 输出时应用，重排（recomputeChart）后仍保留
  elementAdjust?: Record<string, { x?: number; y?: number; width?: number; height?: number; fontSize?: number }>;
}

// 元素稳定键：优先 bind 的 role+index（bar-0/slice-1 等随数据行稳定），
// 无 index 的元素（轴/网格等）用类型+数组位置（布局顺序稳定）
export function chartElemKey(e: CanvasElement, i: number): string {
  return e.bind && e.bind.index !== undefined ? `${e.bind.role}:${e.bind.index}` : `${e.type}:${i}`;
}

// 应用元素级微调：把偏移加到元素位置/尺寸/字号（负数尺寸/字号钳制到最小值）
function applyElementAdjust(els: CanvasElement[], adjust: ChartSpec["elementAdjust"]): CanvasElement[] {
  if (!adjust) return els;
  return els.map((e, i) => {
    const a = adjust[chartElemKey(e, i)];
    if (!a) return e;
    const n = { ...e } as CanvasElement;
    if (a.x !== undefined) n.x += a.x;
    if (a.y !== undefined) n.y += a.y;
    if (a.width !== undefined) n.width = Math.max(1, n.width + a.width);
    if (a.height !== undefined) n.height = Math.max(1, n.height + a.height);
    if (a.fontSize !== undefined && "fontSize" in n) n.fontSize = Math.max(6, (n.fontSize ?? 12) + a.fontSize);
    return n;
  });
}

export const CHART_PALETTE = ["#eef4ff", "#f0fff0", "#fff8e6", "#f3efff", "#ffeef0", "#ffffff"];
// 折线/散点用深色描边（浅色在白底上不可见）；柱状/饼图仍用淡色 fill + 深色描边
export const CHART_STROKE_PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b"];
const AXIS = "#2f2f2f";
const LABEL = "#4a5568";

// 绘图区边界（世界坐标）：拖动柱顶换算数值、y 刻度共用
export const PLOT = { left: 150, right: CANVAS_WIDTH - 60, top: 130, bottom: CANVAS_HEIGHT - 150 };

// 刻度取整：5 档候选 {1,2,2.5,5,10}×10^k 取首个 ≥ max/5，上限 = ceil(max/step)×step
export function niceScale(maxV: number): { step: number; max: number } {
  const raw = Math.max(maxV, 1);
  const rough = raw / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * pow).find((c) => c >= rough)!;
  return { step, max: Math.ceil(raw / step) * step };
}

// 语义与布局分离：AI 只声明图表类型与数据，本模块产出全部元素（轴/刻度/图形/标签/图例）。
// chartId 传入时为每个元素打上 chartId + bind（元素↔数据反向映射，供拖动联动/整图重排）。
// spec.at 支持整图缩放+平移（多图表平铺：AI 一次画多张图时自动分配网格位置，避免全部叠在默认 PLOT 区域）。
export function layoutChart(spec: ChartSpec, chartId?: string): CanvasElement[] {
  const els = spec.type === "pie" ? pie(spec, chartId) : cartesian(spec, chartId);
  // 元素级微调在 at 缩放前叠加：预览（无 at，CSS 缩放）与提交（at 缩放）视觉一致
  const adjusted = applyElementAdjust(els, spec.elementAdjust);
  const at = spec.at;
  if (!at) return applyChartFlip(adjusted, spec);
  const k = at.scale ?? 1;
  const dx = at.x ?? 0;
  const dy = at.y ?? 0;
  if (k === 1 && dx === 0 && dy === 0) return applyChartFlip(adjusted, spec);
  const shifted = adjusted.map((e) => {
    const n = { ...e } as CanvasElement;
    n.x = e.x * k + dx;
    n.y = e.y * k + dy;
    n.width = e.width * k;
    n.height = e.height * k;
    if ("fontSize" in n && n.fontSize !== undefined) n.fontSize = Math.max(8, Math.round(n.fontSize * k));
    if ("radius" in n && n.radius !== undefined) n.radius = n.radius * k;
    if (n.type === "polyline" && "points" in n) n.points = (n as PolylineElement).points.map((p) => ({ x: p.x * k + dx, y: p.y * k + dy }));
    if (n.type === "arrow" && (n as ArrowElement).midPoints) {
      (n as ArrowElement).midPoints = (n as ArrowElement).midPoints!.map((m) => ({ ...m, x: m.x * k, y: m.y * k }));
    }
    return n;
  });
  return applyChartFlip(shifted, spec);
}

// 整图镜像（spec.flipH/flipV）：绕整图包围盒中心翻转每个元素的位置与自身镜像标志，
// 与普通元素的 flipH/flipV 语义一致（属性面板「操作」翻转图表时整图一起翻，不撕裂）
function applyChartFlip(els: CanvasElement[], spec: ChartSpec): CanvasElement[] {
  if (!spec.flipH && !spec.flipV) return els;
  const bs = els.map((e) => elementBounds(e));
  const minX = Math.min(...bs.map((b) => b.x));
  const maxX = Math.max(...bs.map((b) => b.x + b.width));
  const minY = Math.min(...bs.map((b) => b.y));
  const maxY = Math.max(...bs.map((b) => b.y + b.height));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return els.map((e) => {
    const b = elementBounds(e);
    const ocx = b.x + b.width / 2;
    const ocy = b.y + b.height / 2;
    const dx = (spec.flipH ? 2 * cx - ocx : ocx) - ocx;
    const dy = (spec.flipV ? 2 * cy - ocy : ocy) - ocy;
    const n = { ...e } as CanvasElement;
    n.x += dx;
    n.y += dy;
    if (spec.flipH) n.flipH = !e.flipH;
    if (spec.flipV) n.flipV = !e.flipV;
    // 折线/画笔点列是绝对坐标：随整图位移
    if ((n.type === "polyline" || n.type === "pen") && "points" in n) {
      n.points = (n as PolylineElement).points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    return n;
  });
}

function textEl(
  text: string,
  fontSize: number,
  x: number,
  y: number,
  opts: { bold?: boolean; fill?: string; align?: "left" | "center" | "right"; zIndex?: number; bind?: ChartBind; chartId?: string } = {}
): CanvasElement {
  const size = estimateTextSize(text, fontSize, opts.bold ?? false);
  const align = opts.align ?? "center";
  const tx = align === "left" ? x : align === "right" ? x - size.width : x - size.width / 2;
  const el = makeElement("text", tx, y - size.height / 2, size.width, size.height, {
    text,
    fontSize,
    bold: opts.bold ?? false,
    fill: opts.fill ?? LABEL,
    align,
    zIndex: opts.zIndex ?? 3,
  });
  if (opts.chartId) {
    el.chartId = opts.chartId;
    el.bind = opts.bind;
  }
  return el;
}

// 给元素补 chartId + bind（图表引擎产出元素后统一附上）
function tag(el: CanvasElement, chartId: string, bind: ChartBind): CanvasElement {
  el.chartId = chartId;
  el.bind = bind;
  return el;
}

function cartesian(spec: ChartSpec, chartId?: string): CanvasElement[] {
  const out: CanvasElement[] = [];
  const plotW = PLOT.right - PLOT.left;
  const plotH = PLOT.bottom - PLOT.top;
  // 堆叠柱状：y 轴上限按每分类各系列之和的最大值取整（堆叠总高不能超出坐标轴）
  const stacked = spec.type === "bar" && spec.variant === "stacked";
  const sumByLabel = new Map<string, number>();
  for (const d of spec.data) sumByLabel.set(d.label, (sumByLabel.get(d.label) ?? 0) + d.value);
  const maxV = stacked
    ? Math.max(...sumByLabel.values(), 1)
    : Math.max(...spec.data.map((d) => d.value), 1);
  const { step, max } = niceScale(maxV);
  const y = (v: number) => PLOT.bottom - (v / max) * plotH;

  // 标题 / 轴名
  if (spec.title) out.push(textEl(spec.title, 22, 800, 52, { bold: true, fill: AXIS, chartId, bind: { chartId: chartId ?? "", role: "title" } }));
  if (spec.xLabel) out.push(textEl(spec.xLabel, 14, PLOT.left + plotW / 2, PLOT.bottom + 56, { chartId, bind: { chartId: chartId ?? "", role: "x-label" } }));
  if (spec.yLabel) {
    const el = textEl(spec.yLabel, 14, PLOT.left - 56, PLOT.top + plotH / 2, { chartId, bind: { chartId: chartId ?? "", role: "y-label" } });
    el.rotation = -90;
    out.push(el);
  }

  // 坐标轴（y 轴向上 = 负高度，直接 makeElement 不经钳制）
  const axisBind = { chartId: chartId ?? "", role: "axis" as const };
  out.push(chartId ? tag(makeElement("arrow", PLOT.left, PLOT.bottom, plotW, 0, { stroke: AXIS, strokeWidth: 2, zIndex: 1 }), chartId, axisBind) : makeElement("arrow", PLOT.left, PLOT.bottom, plotW, 0, { stroke: AXIS, strokeWidth: 2, zIndex: 1 }));
  out.push(chartId ? tag(makeElement("arrow", PLOT.left, PLOT.bottom, 0, -plotH, { stroke: AXIS, strokeWidth: 2, zIndex: 1 }), chartId, axisBind) : makeElement("arrow", PLOT.left, PLOT.bottom, 0, -plotH, { stroke: AXIS, strokeWidth: 2, zIndex: 1 }));

  // y 刻度值（精度按 step 的小数位数，step=0.25 时 0.75 应标 "0.75" 而非 "0.8"）
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  for (let v = step; v <= max + 1e-9; v += step) {
    const ty = y(v);
    out.push(textEl(Number.isInteger(v) ? String(v) : v.toFixed(decimals), 12, PLOT.left - 12, ty, { align: "right", chartId, bind: { chartId: chartId ?? "", role: "axis" } }));
  }

  // 系列与分类
  const seriesNames = Array.from(new Set(spec.data.map((d) => d.series ?? "默认")));
  const series = seriesNames.map((name, i) => {
    const useStroke = spec.type === "line" || spec.type === "scatter";
    const color = useStroke
      ? CHART_STROKE_PALETTE[i % CHART_STROKE_PALETTE.length]
      : CHART_PALETTE[i % CHART_PALETTE.length];
    return { name, color };
  });
  const cats = Array.from(new Set(spec.data.map((d) => d.label)));
  const catW = plotW / cats.length;
  // x 轴刻度标签间隔：数据点多时每隔 xStep 个分类标一个（用户要求"每 N 年一个刻度"传 xStep）；
  // 缺省自动稀疏化到 ≤15 个标签，避免 30 点折线图的 x 轴标签挤成一团
  const xTickStep = spec.xStep ?? Math.max(1, Math.ceil(cats.length / 15));

  for (const [ci, cat] of cats.entries()) {
    const cx0 = PLOT.left + ci * catW + catW / 2;
    const rows = spec.data.filter((d) => d.label === cat);
    const vals = rows.map((d) => ({ si: seriesNames.indexOf(d.series ?? "默认"), value: d.value, di: spec.data.indexOf(d), color: d.color }));

    if (spec.type === "bar") {
      if (stacked) {
        // 堆叠柱状：同分类内各系列自底向上累加（柱宽占满分类宽度，柱体按累计值定位）
        const bw = Math.min(140, catW - 16);
        const bx = cx0 - bw / 2;
        const sorted = [...vals].sort((a, b) => a.si - b.si);
        let acc = 0;
        for (const v of sorted) {
          const top = y(acc + v.value);
          const bottom = y(acc);
          const bar = makeElement("rect", bx, top, bw, Math.max(1, bottom - top), {
            // 行自定义颜色优先，未指定回退系列色
            fill: v.color ?? series[v.si].color, stroke: AXIS, strokeWidth: 1, zIndex: 2,
          });
          if (chartId) tag(bar, chartId, { chartId, role: "bar", index: v.di });
          out.push(bar);
          out.push(textEl(String(Number(v.value.toFixed(2))), 12, bx + bw / 2, top - 12, { chartId, bind: { chartId: chartId ?? "", role: "bar-label", index: v.di } }));
          acc += v.value;
        }
      } else {
        const groupW = catW - 24;
        const bw = Math.min(70, groupW / series.length);
        const off = (groupW - bw * series.length) / 2;
        for (const v of vals) {
          const bx = cx0 - groupW / 2 + off + v.si * bw;
          const by = y(v.value);
          const bar = makeElement("rect", bx, by, bw, Math.max(1, PLOT.bottom - by), {
            // 行自定义颜色优先，未指定回退系列色（与饼图一致：d.color 生效，实时预览与最终一致）
            fill: v.color ?? series[v.si].color, stroke: AXIS, strokeWidth: 1, zIndex: 2,
          });
          if (chartId) tag(bar, chartId, { chartId, role: "bar", index: v.di });
          out.push(bar);
          out.push(textEl(String(Number(v.value.toFixed(2))), 12, bx + bw / 2, by - 12, { chartId, bind: { chartId: chartId ?? "", role: "bar-label", index: v.di } }));
        }
      }
    } else {
      for (const v of vals) {
        const px = cx0;
        const py = y(v.value);
        if (spec.type === "line") {
          const pt = makeElement("ellipse", px - 4, py - 4, 8, 8, {
            fill: "#ffffff", stroke: v.color ?? series[v.si].color, strokeWidth: 2, zIndex: 2,
          });
          if (chartId) tag(pt, chartId, { chartId, role: "bar", index: v.di });
          out.push(pt);
          out.push(textEl(String(Number(v.value.toFixed(2))), 12, px, py - 14, { chartId, bind: { chartId: chartId ?? "", role: "bar-label", index: v.di } }));
        } else {
          // scatter：数据点圆点
          const pt = makeElement("ellipse", px - 5, py - 5, 10, 10, {
            fill: v.color ?? series[v.si].color, stroke: AXIS, strokeWidth: 1, zIndex: 2,
          });
          if (chartId) tag(pt, chartId, { chartId, role: "bar", index: v.di });
          out.push(pt);
        }
      }
    }
    // x 轴刻度标签：按 xTickStep 跳标（首个与末个必标），避免数据点多时标签拥挤重叠
    if (ci % xTickStep === 0 || ci === cats.length - 1) {
      out.push(textEl(cat, 14, cx0, PLOT.bottom + 24, { chartId, bind: { chartId: chartId ?? "", role: "axis" } }));
    }
  }

  // 折线：每个系列一条 polyline（无箭头）
  if (spec.type === "line") {
    for (const [si, name] of seriesNames.entries()) {
      const pts = cats
        .map((cat, ci) => ({ cat, ci }))
        .filter(({ cat }) => spec.data.some((d) => d.label === cat && (d.series ?? "默认") === name))
        .map(({ cat, ci }) => {
          const row = spec.data.find((d) => d.label === cat && (d.series ?? "默认") === name)!;
          return { x: PLOT.left + ci * catW + catW / 2, y: y(row.value) };
        });
      if (pts.length >= 2) {
        const line = makeElement("polyline", 0, 0, 0, 0, {
          points: pts, stroke: series[si].color, strokeWidth: 2, arrow: false, zIndex: 1,
        });
        if (chartId) tag(line, chartId, { chartId, role: "grid" });
        out.push(line);
      }
    }
  }

  // 多系列图例（右上角）
  if (series.length > 1) {
    let ly = PLOT.top + 10;
    for (const s of series) {
      const sw = makeElement("rect", PLOT.right - 170, ly, 14, 14, { fill: s.color, stroke: AXIS, strokeWidth: 1, zIndex: 2 });
      if (chartId) tag(sw, chartId, { chartId, role: "grid" });
      out.push(sw);
      out.push(textEl(s.name, 13, PLOT.right - 148, ly + 7, { align: "left", chartId, bind: { chartId: chartId ?? "", role: "grid" } }));
      ly += 26;
    }
  }

  return out;
}

function pie(spec: ChartSpec, chartId?: string): CanvasElement[] {
  const out: CanvasElement[] = [];
  const total = spec.data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return out;
  // 空心饼图（圆环）变体：扇形带内孔；每条目可用 color 自定义图例/扇区颜色
  const hollow = spec.variant === "hollow";
  const innerR = hollow ? 130 : 0;
  if (spec.title) out.push(textEl(spec.title, 22, 800, 52, { bold: true, fill: AXIS, chartId, bind: { chartId: chartId ?? "", role: "title" } }));
  const cx = 800;
  const cy = 500;
  const r = 280;
  let angle = spec.pieStart ?? -Math.PI / 2;
  spec.data.forEach((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    const sec = makeElement("sector", cx, cy, r * 2, r * 2, {
      radius: r, innerRadius: innerR || undefined, startAngle: start, endAngle: end,
      fill: d.color ?? CHART_PALETTE[i % CHART_PALETTE.length], stroke: AXIS, strokeWidth: 1, zIndex: 2,
    });
    if (chartId) tag(sec, chartId, { chartId, role: "slice", index: i });
    out.push(sec);
    const mid = (start + end) / 2;
    // 标签默认只显示占比（"25%"）；showValues 时按规范格式显示具体数值+单位+占比（"50万元 (25%)"）
    const val = Number(d.value.toFixed(2));
    const pct = Math.round((d.value / total) * 100);
    const labelText = spec.showValues ? `${val}${spec.unit ?? ""} (${pct}%)` : `${pct}%`;
    out.push(textEl(labelText, 13, cx + Math.cos(mid) * r * 0.62, cy + Math.sin(mid) * r * 0.62, { fill: AXIS, chartId, bind: { chartId: chartId ?? "", role: "pie-label", index: i } }));
    angle = end;
  });
  let ly = 200;
  spec.data.forEach((d, i) => {
    const sw = makeElement("rect", 1350, ly, 14, 14, { fill: d.color ?? CHART_PALETTE[i % CHART_PALETTE.length], stroke: AXIS, strokeWidth: 1, zIndex: 2 });
    if (chartId) tag(sw, chartId, { chartId, role: "pie-legend", index: i });
    out.push(sw);
    out.push(textEl(d.label, 13, 1372, ly + 7, { align: "left", chartId, bind: { chartId: chartId ?? "", role: "pie-legend", index: i } }));
    ly += 26;
  });
  return out;
}
