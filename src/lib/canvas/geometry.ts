import type { CanvasElement, CurveElement } from "./types";

// 旋转约定：旋转已由 UI 暴露（旋转手柄），但本模块的几何命中/吸附仍按未旋转处理——
// 矩形框旋转后命中/吸附会有偏差，后续任务如需精确命中，需按旋转后坐标计算。

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const CANVAS_WIDTH = 1600;
export const CANVAS_HEIGHT = 1000;
export const SNAP_THRESHOLD = 6;
export const HIT_TOLERANCE = 4;

export function shapePoints(type: string, r: Rect): Point[] {
  const { x, y, width: w, height: h } = r;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (type) {
    case "triangle":
      return [
        { x: cx, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
      ];
    case "diamond":
      return [
        { x: cx, y },
        { x: x + w, y: cy },
        { x: cx, y: y + h },
        { x, y: cy },
      ];
    case "hexagon": {
      const w6 = w / 4;
      return [
        { x: x + w6, y },
        { x: x + w - w6, y },
        { x: x + w, y: cy },
        { x: x + w - w6, y: y + h },
        { x: x + w6, y: y + h },
        { x, y: cy },
      ];
    }
    case "star": {
      // 五角星：10 点外接圆/内圆交替（内径 0.382R 黄金比例），首点朝上
      const R = Math.max(w, h) / 2;
      const r = R * 0.382;
      const pts: Point[] = [];
      for (let i = 0; i < 10; i++) {
        const rad = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push({ x: cx + Math.cos(rad) * (i % 2 === 0 ? R : r), y: cy + Math.sin(rad) * (i % 2 === 0 ? R : r) });
      }
      return pts;
    }
    case "cross": {
      // 十字：12 点多边形，臂厚 aw = min(w,h)/6，臂宽 = min(w,h)/3（两侧各 1/3）
      const aw = Math.min(w, h) / 6;
      return [
        { x: cx - aw, y },
        { x: cx + aw, y },
        { x: cx + aw, y: cy - aw },
        { x: x + w, y: cy - aw },
        { x: x + w, y: cy + aw },
        { x: cx + aw, y: cy + aw },
        { x: cx + aw, y: y + h },
        { x: cx - aw, y: y + h },
        { x: cx - aw, y: cy + aw },
        { x, y: cy + aw },
        { x, y: cy - aw },
        { x: cx - aw, y: cy - aw },
      ];
    }
    default:
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
  }
}

// —— curve / sector（AI 生成专用元素）——

// 曲线控制点：起终点中点沿法线偏移 curvature×线长（法线取终点方向逆时针转 90°）
export function curveControl(e: CurveElement): Point {
  const dx = e.width;
  const dy = e.height;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  return { x: e.x + e.width / 2 + px * e.curvature * len, y: e.y + e.height / 2 + py * e.curvature * len };
}

// 二次贝塞尔精确包围盒：极值点 t = (p0 - p1) / (p0 - 2p1 + p2)
export function quadBezierBounds(p0: Point, p1: Point, p2: Point): Rect {
  const xs = [p0.x, p2.x];
  const ys = [p0.y, p2.y];
  for (const [a, b, c, isX] of [
    [p0.x, p1.x, p2.x, true],
    [p0.y, p1.y, p2.y, false],
  ] as const) {
    const denom = a - 2 * b + c;
    if (denom === 0) continue;
    const t = (a - b) / denom;
    if (t > 0 && t < 1) {
      const v = (1 - t) ** 2 * a + 2 * t * (1 - t) * b + t * t * c;
      if (isX) xs.push(v);
      else ys.push(v);
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

// 点到二次贝塞尔的近似距离（采样 16 段折线）
function distToQuadCurve(p: Point, p0: Point, c: Point, p2: Point): number {
  let best = Infinity;
  let prev = p0;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const pt = {
      x: (1 - t) ** 2 * p0.x + 2 * t * (1 - t) * c.x + t * t * p2.x,
      y: (1 - t) ** 2 * p0.y + 2 * t * (1 - t) * c.y + t * t * p2.y,
    };
    best = Math.min(best, distToSegment(p, prev, pt));
    prev = pt;
  }
  return best;
}

// 角度是否落在扇形区间（弧度；处理跨 0 与整圆）
export function angleInSector(a: number, start: number, end: number): boolean {
  if (end - start >= Math.PI * 2) return true;
  const norm = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const s = norm(start);
  const e = norm(end);
  const t = norm(a);
  return s <= e ? t >= s && t <= e : t >= s || t <= e;
}

// —— AI 自动连接：线段 from→to 与形状轮廓的求交 ——

// 线段 AB 与线段 CD 的交点（平行/不相交返回 null）
function segmentSegmentHit(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

// 线段 from→to 与凸多边形边界的交点中离 from 最近的一个；无交点返回 null
function segmentPolygonHit(poly: Point[], from: Point, to: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const hit = segmentSegmentHit(from, to, poly[i], poly[(i + 1) % poly.length]);
    if (!hit) continue;
    const d = (hit.x - from.x) ** 2 + (hit.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = hit;
    }
  }
  return best;
}

// 线段 from→to 与椭圆的交点中离 from 最近的一个；无交点返回 null
// 仿射变换把椭圆缩成单位圆后解析求交，再变换回原空间
function segmentEllipseHit(cx: number, cy: number, rx: number, ry: number, from: Point, to: Point): Point | null {
  const fx = (from.x - cx) / rx;
  const fy = (from.y - cy) / ry;
  const dx = (to.x - cx) / rx - fx;
  const dy = (to.y - cy) / ry - fy;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  // 取第一个正根：from 在椭圆内部时负根是反方向的交点，正根才是朝 to 方向的轮廓交点
  const t1 = (-b - Math.sqrt(disc)) / (2 * a);
  const t2 = (-b + Math.sqrt(disc)) / (2 * a);
  const t = t1 > 0 ? t1 : t2;
  if (t < 0 || t > 1) return null;
  return { x: cx + (fx + t * dx) * rx, y: cy + (fy + t * dy) * ry };
}

// 从形状内/外的 from 点朝 to 方向，线段与形状轮廓的第一个交点（连接箭头的锚点）。
// 矩形/多边形按凸多边形求交，椭圆按解析求交；无交点返回 null
export function shapeExitPoint(e: CanvasElement, from: Point, to: Point): Point | null {
  if (e.type === "ellipse") {
    return segmentEllipseHit(e.x + e.width / 2, e.y + e.height / 2, e.width / 2, e.height / 2, from, to);
  }
  const poly = e.type === "rect" || e.type === "text" || e.type === "logic"
    ? [
        { x: e.x, y: e.y },
        { x: e.x + e.width, y: e.y },
        { x: e.x + e.width, y: e.y + e.height },
        { x: e.x, y: e.y + e.height },
      ]
    : shapePoints(e.type, e);
  return segmentPolygonHit(poly, from, to);
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 箭头完整点列（世界坐标）：起点 → 中间折点… → 终点（无折点时即直线两点）。
// 折点存相对坐标（相对箭头起点），输出时偏移 e.x/e.y
export function arrowPoints(e: CanvasElement): Point[] {
  if (e.type !== "arrow") return [{ x: e.x, y: e.y }, { x: e.x + e.width, y: e.y + e.height }];
  const pts = [
    { x: e.x, y: e.y },
    ...(e.midPoints ?? []).map((m) => ({ x: e.x + m.x, y: e.y + m.y, smooth: m.smooth })),
    { x: e.x + e.width, y: e.y + e.height },
  ];
  return pts;
}

// 点在线段上的投影（钳制到 [0,1]）：右键插入折点时折点精确落在线上
export function projectOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// 折点箭头路径（渲染/导出共用）：两端点为尖锐，中间折点按 smooth 标志——
// 平滑折点两侧线段用 Catmull-Rom 三次贝塞尔平滑穿过（端点切线反射延拓），尖锐折点保持直线
export function arrowPathD(pts: { x: number; y: number; smooth?: boolean }[]): string {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.smooth || b.smooth) {
      const prev = pts[i - 2] ?? { x: a.x - (b.x - a.x), y: a.y - (b.y - a.y) };
      const next = pts[i + 1] ?? { x: b.x + (b.x - a.x), y: b.y + (b.y - a.y) };
      const c1x = a.x + (b.x - prev.x) / 6;
      const c1y = a.y + (b.y - prev.y) / 6;
      const c2x = b.x - (next.x - a.x) / 6;
      const c2y = b.y - (next.y - a.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
    } else {
      d += ` L ${b.x} ${b.y}`;
    }
  }
  return d;
}

// 元素真实包围盒（arrow 负向拖拽/折点、polyline、curve、sector 归一化）：
// 层级重叠过滤、吸附、对齐/分布、命中测试共用
export function lineBounds(e: CanvasElement): Rect {
  if (e.type === "polyline") {
    const xs = e.points.map((p) => p.x);
    const ys = e.points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  if (e.type === "arrow" && (e.midPoints?.length ?? 0) > 0) {
    // 带折点的箭头：包围盒须覆盖全部折点（对齐/分布/吸附用）；折点为相对坐标需偏移
    const xs = [e.x, e.x + e.width, ...e.midPoints!.map((p) => e.x + p.x)];
    const ys = [e.y, e.y + e.height, ...e.midPoints!.map((p) => e.y + p.y)];
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  if (e.type === "curve") {
    const c = curveControl(e);
    return quadBezierBounds({ x: e.x, y: e.y }, c, { x: e.x + e.width, y: e.y + e.height });
  }
  if (e.type === "sector") {
    return { x: e.x - e.radius, y: e.y - e.radius, width: e.radius * 2, height: e.radius * 2 };
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

// 归一化真实包围盒（负宽高箭头/polyline/curve/sector 全部转正）：
// 选中虚线框、AI 锁定框、箭头整框拖动命中区、拖动预览框共用——与渲染框严格一致
export function elementBounds(e: CanvasElement): Rect {
  if (e.type === "arrow") {
    const xs = [e.x, e.x + e.width, ...(e.midPoints ?? []).map((p) => e.x + p.x)];
    const ys = [e.y, e.y + e.height, ...(e.midPoints ?? []).map((p) => e.y + p.y)];
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  if (e.type === "polyline") {
    const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
  }
  if (e.type === "pen") {
    const xs = e.points.map((p) => p.x), ys = e.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
  }
  if (e.type === "curve") {
    const c = curveControl(e);
    const xs = [e.x, c.x, e.x + e.width];
    const ys = [e.y, c.y, e.y + e.height];
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
  }
  if (e.type === "sector") {
    return { x: e.x - e.radius, y: e.y - e.radius, width: e.radius * 2, height: e.radius * 2 };
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

export function hitTestElement(e: CanvasElement, p: Point, tolerance = HIT_TOLERANCE): boolean {
  const r = lineBounds(e);
  const expanded = { x: r.x - tolerance, y: r.y - tolerance, width: r.width + tolerance * 2, height: r.height + tolerance * 2 };
  if (e.type === "arrow") {
    // 折线命中：到任一段（起点→折点→终点）的距离在容差内
    const pts = arrowPoints(e);
    return pts.some((pt, i) => i > 0 && distToSegment(p, pts[i - 1], pt) <= tolerance);
  }
  if (e.type === "polyline") {
    return e.points.some((pt, i) => i > 0 && distToSegment(p, e.points[i - 1], pt) <= tolerance);
  }
  if (e.type === "pen") {
    // 手写笔迹是细线，命中范围放宽（与箭头同为逐段测距，但容差更大便于点选）
    return e.points.some((pt, i) => i > 0 && distToSegment(p, e.points[i - 1], pt) <= tolerance + 6);
  }
  if (e.type === "curve") {
    const c = curveControl(e);
    return distToQuadCurve(p, { x: e.x, y: e.y }, c, { x: e.x + e.width, y: e.y + e.height }) <= tolerance;
  }
  if (p.x < expanded.x || p.y < expanded.y || p.x > expanded.x + expanded.width || p.y > expanded.y + expanded.height) return false;
  switch (e.type) {
    case "ellipse": {
      const rx = e.width / 2;
      const ry = e.height / 2;
      const dx = (p.x - (e.x + rx)) / rx;
      const dy = (p.y - (e.y + ry)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case "sector": {
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (dist > e.radius + tolerance) return false;
      // 空心扇形：内孔不命中（圆环饼图）
      if (e.innerRadius && dist < e.innerRadius - tolerance) return false;
      return angleInSector(Math.atan2(p.y - e.y, p.x - e.x), e.startAngle, e.endAngle);
    }
    case "donut": {
      // 圆环：归一化半径 d² ∈ [0.4225, 1]（内孔 = 0.65²），粗筛矩形后直接精确命中
      const rx = e.width / 2;
      const ry = e.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const dx = (p.x - (e.x + rx)) / rx;
      const dy = (p.y - (e.y + ry)) / ry;
      const d2 = dx * dx + dy * dy;
      return d2 <= 1 && d2 >= 0.4225;
    }
    case "half": {
      // 半圆（上半圆盘）：y 不高于圆心且在外圆内
      const rx = e.width / 2;
      const ry = e.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const cy = e.y + ry;
      if (p.y > cy) return false;
      const dx = (p.x - (e.x + rx)) / rx;
      const dy = (p.y - cy) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case "triangle":
    case "diamond":
    case "hexagon":
    case "star":
    case "cross":
      return pointInPolygon(p, shapePoints(e.type, r));
    default:
      return true; // rect / text：已通过扩展矩形粗筛
  }
}

export function clampRect(r: Rect, w = CANVAS_WIDTH, h = CANVAS_HEIGHT): Rect {
  const width = Math.min(r.width, w);
  const height = Math.min(r.height, h);
  return {
    x: Math.min(Math.max(r.x, 0), w - width),
    y: Math.min(Math.max(r.y, 0), h - height),
    width,
    height,
  };
}

export type AlignAxis = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";

export function alignOffsets(ids: string[], elements: CanvasElement[], axis: AlignAxis): Map<string, { dx: number; dy: number }> {
  const targets = elements.filter((e) => ids.includes(e.id));
  const out = new Map<string, { dx: number; dy: number }>();
  if (targets.length < 2) return out;
  const ref = targets[0];
  const r0 = lineBounds(ref);
  for (const e of targets.slice(1)) {
    const r = lineBounds(e);
    let dx = 0;
    let dy = 0;
    switch (axis) {
      case "left": dx = r0.x - r.x; break;
      case "right": dx = r0.x + r0.width - (r.x + r.width); break;
      case "top": dy = r0.y - r.y; break;
      case "bottom": dy = r0.y + r0.height - (r.y + r.height); break;
      case "centerX": dx = r0.x + r0.width / 2 - (r.x + r.width / 2); break;
      case "centerY": dy = r0.y + r0.height / 2 - (r.y + r.height / 2); break;
    }
    out.set(e.id, { dx, dy });
  }
  return out;
}

export function distributeOffsets(ids: string[], elements: CanvasElement[], dir: "horizontal" | "vertical"): Map<string, { dx: number; dy: number }> {
  const targets = elements.filter((e) => ids.includes(e.id));
  const out = new Map<string, { dx: number; dy: number }>();
  if (targets.length < 3) return out;
  const sorted = [...targets].sort((a, b) => (dir === "horizontal" ? lineBounds(a).x - lineBounds(b).x : lineBounds(a).y - lineBounds(b).y));
  const first = lineBounds(sorted[0]);
  const last = lineBounds(sorted[sorted.length - 1]);
  const span = dir === "horizontal" ? last.x - first.x : last.y - first.y;
  const gap = (span - sorted.reduce((s, e) => s + (dir === "horizontal" ? lineBounds(e).width : lineBounds(e).height), 0)) / (sorted.length - 1);
  let cursor = dir === "horizontal" ? first.x : first.y;
  for (const e of sorted) {
    const r = lineBounds(e);
    const dx = dir === "horizontal" ? cursor - r.x : 0;
    const dy = dir === "vertical" ? cursor - r.y : 0;
    out.set(e.id, { dx, dy });
    cursor += (dir === "horizontal" ? r.width : r.height) + gap;
  }
  return out;
}

/**
 * 计算吸附偏移。elements 必须排除正在移动的元素自身（或传 movingId）。
 * 否则移动元素会吸附到自己的旧位置：静止时 d=0 把 best 置 0，压制所有吸附。
 */
export function snapRect(r: Rect, elements: CanvasElement[], threshold = SNAP_THRESHOLD, movingId?: string): { dx: number; dy: number } {
  let bestDx = 0;
  let bestDy = 0;
  let best = threshold;
  for (const e of elements) {
    if (e.id === movingId) continue;
    const t = lineBounds(e);
    const edges: { pos: number; axis: "x" | "y"; ref: number }[] = [
      { pos: r.x, axis: "x", ref: t.x },
      { pos: r.x + r.width, axis: "x", ref: t.x + t.width },
      { pos: r.x, axis: "x", ref: t.x + t.width },
      { pos: r.x + r.width, axis: "x", ref: t.x },
      { pos: r.y, axis: "y", ref: t.y },
      { pos: r.y + r.height, axis: "y", ref: t.y + t.height },
      { pos: r.y, axis: "y", ref: t.y + t.height },
      { pos: r.y + r.height, axis: "y", ref: t.y },
    ];
    for (const ed of edges) {
      const d = ed.ref - ed.pos;
      if (Math.abs(d) < Math.abs(best) && Math.abs(d) <= threshold) {
        best = d;
        if (ed.axis === "x") bestDx = d;
        else bestDy = d;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

// 缩放专用吸附：只吸附正在被拖动的边（handle 含 e/w/s/n），把该边吸到其他元素最近的边缘（阈值内）。
// 与 snapRect（整体平移吸附）区分——缩放时固定边不动，仅动边吸附，避免整框漂移。
export function snapResizeRect(r: Rect, handle: string, elements: CanvasElement[], threshold = SNAP_THRESHOLD): Rect {
  const out = { ...r };
  // 各活动边候选参考位置（其他元素的上/下/左/右边缘）
  const edgeRefs = (axis: "x" | "y"): number[] => {
    const refs: number[] = [];
    for (const e of elements) {
      const t = lineBounds(e);
      refs.push(axis === "x" ? t.x : t.y);
      refs.push(axis === "x" ? t.x + t.width : t.y + t.height);
    }
    return refs;
  };
  const snapEdge = (pos: number, axis: "x" | "y"): number => {
    let best = pos;
    let bestD = threshold;
    for (const ref of edgeRefs(axis)) {
      const d = Math.abs(ref - pos);
      if (d <= bestD) { bestD = d; best = ref; }
    }
    return best;
  };
  if (handle.includes("e")) out.width = snapEdge(r.x + r.width, "x") - r.x;
  if (handle.includes("w")) { const nx = snapEdge(r.x, "x"); out.width = r.x + r.width - nx; out.x = nx; }
  if (handle.includes("s")) out.height = snapEdge(r.y + r.height, "y") - r.y;
  if (handle.includes("n")) { const ny = snapEdge(r.y, "y"); out.height = r.y + r.height - ny; out.y = ny; }
  out.width = Math.max(8, out.width);
  out.height = Math.max(8, out.height);
  return out;
}

// PPT 式对齐参考线：拖动矩形 r 时，与周围元素边缘/中心对齐（阈值内）就返回参考线位置
// （x = 垂直参考线、y = 水平参考线，世界坐标，供画布绘制非阻塞提示线；无对齐返回 undefined）。
// 与 snapRect 同源：用户"拖到规整位置"时，既有吸附又有可见提示线，所见即所得。
export interface AlignGuides { x?: number; y?: number }
export function alignmentGuides(r: Rect, elements: CanvasElement[], threshold = SNAP_THRESHOLD, movingId?: string): AlignGuides {
  let gx: number | undefined;
  let gy: number | undefined;
  let bestX = threshold;
  let bestY = threshold;
  for (const e of elements) {
    if (e.id === movingId) continue;
    const t = lineBounds(e);
    // 垂直候选：左-左、右-右、左-右、右-左、中心对齐
    const xCands: { pos: number; ref: number }[] = [
      { pos: r.x, ref: t.x },
      { pos: r.x + r.width, ref: t.x + t.width },
      { pos: r.x, ref: t.x + t.width },
      { pos: r.x + r.width, ref: t.x },
      { pos: r.x + r.width / 2, ref: t.x + t.width / 2 },
    ];
    for (const c of xCands) {
      const d = Math.abs(c.ref - c.pos);
      if (d <= bestX) { bestX = d; gx = c.ref; }
    }
    // 水平候选：上-上、下-下、上-下、下-上、中心对齐
    const yCands: { pos: number; ref: number }[] = [
      { pos: r.y, ref: t.y },
      { pos: r.y + r.height, ref: t.y + t.height },
      { pos: r.y, ref: t.y + t.height },
      { pos: r.y + r.height, ref: t.y },
      { pos: r.y + r.height / 2, ref: t.y + t.height / 2 },
    ];
    for (const c of yCands) {
      const d = Math.abs(c.ref - c.pos);
      if (d <= bestY) { bestY = d; gy = c.ref; }
    }
  }
  return { x: gx, y: gy };
}

// 箭头头尺寸随线宽等比缩放（默认线宽 2 → 10px 头，保持默认观感）；
// 限幅：细线也有可见的头，粗线头不夸张
export function arrowHeadSize(strokeWidth: number): number {
  return Math.min(28, Math.max(6, strokeWidth * 5));
}

export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size = 10): Point[] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const back = size;
  const spread = Math.PI / 6;
  const p1 = { x: x2, y: y2 };
  const p2 = { x: x2 - back * Math.cos(angle - spread), y: y2 - back * Math.sin(angle - spread) };
  const p3 = { x: x2 - back * Math.cos(angle + spread), y: y2 - back * Math.sin(angle + spread) };
  return [p1, p2, p3];
}

// ---- 逻辑节点锚点 ----

export type AnchorSide = "top" | "bottom" | "left" | "right";
export interface Anchor extends Point {
  id: string;
  elementId: string;
  side: AnchorSide;
}

// 箭头端点吸附逻辑锚点的世界坐标阈值
export const ANCHOR_SNAP_THRESHOLD = 12;

// 逻辑节点自带的 4 个箭头锚点（上下左右），随元素旋转
export function logicAnchors(e: CanvasElement): Anchor[] {
  if (e.type !== "logic") return [];
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  const pts: { side: AnchorSide; x: number; y: number }[] = [
    { side: "top", x: cx, y: e.y },
    { side: "bottom", x: cx, y: e.y + e.height },
    { side: "left", x: e.x, y: cy },
    { side: "right", x: e.x + e.width, y: cy },
  ];
  const rad = (e.rotation * Math.PI) / 180;
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      id: `${e.id}:${p.side}`,
      elementId: e.id,
      side: p.side,
      x: e.rotation ? cx + dx * Math.cos(rad) - dy * Math.sin(rad) : p.x,
      y: e.rotation ? cy + dx * Math.sin(rad) + dy * Math.cos(rad) : p.y,
    };
  });
}

// 在全部逻辑节点中找距离 p 最近且不超过 threshold 的锚点；excludeElementId 排除指定元素（拉箭头时不吸附回源节点自身）
export function nearestAnchor(elements: CanvasElement[], p: Point, threshold = ANCHOR_SNAP_THRESHOLD, excludeElementId?: string): Anchor | null {
  let best: Anchor | null = null;
  let bestD = threshold;
  for (const e of elements) {
    if (e.id === excludeElementId) continue;
    for (const a of logicAnchors(e)) {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
  }
  return best;
}

// 返回逻辑节点朝向 p 的锚点（无阈值；自动连接选出口/入口锚点用），非逻辑元素返回 null
export function anchorToward(e: CanvasElement, p: Point): Anchor | null {
  if (e.type !== "logic") return null;
  let best: Anchor | null = null;
  let bestD = Infinity;
  for (const a of logicAnchors(e)) {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}
