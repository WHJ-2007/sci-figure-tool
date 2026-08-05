import type { CanvasElement } from "./types";

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
    default:
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
  }
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
  const poly = e.type === "rect" || e.type === "text"
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

function lineBounds(e: CanvasElement): Rect {
  if (e.type === "polyline") {
    const xs = e.points.map((p) => p.x);
    const ys = e.points.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: e.x, y: e.y, width: e.width, height: e.height };
}

export function hitTestElement(e: CanvasElement, p: Point, tolerance = HIT_TOLERANCE): boolean {
  const r = lineBounds(e);
  const expanded = { x: r.x - tolerance, y: r.y - tolerance, width: r.width + tolerance * 2, height: r.height + tolerance * 2 };
  if (e.type === "arrow") {
    const x2 = e.x + e.width;
    const y2 = e.y + e.height;
    return distToSegment(p, { x: e.x, y: e.y }, { x: x2, y: y2 }) <= tolerance;
  }
  if (e.type === "polyline") {
    return e.points.some((pt, i) => i > 0 && distToSegment(p, e.points[i - 1], pt) <= tolerance);
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
    case "triangle":
    case "diamond":
    case "hexagon":
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

export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size = 10): Point[] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const back = size;
  const spread = Math.PI / 6;
  const p1 = { x: x2, y: y2 };
  const p2 = { x: x2 - back * Math.cos(angle - spread), y: y2 - back * Math.sin(angle - spread) };
  const p3 = { x: x2 - back * Math.cos(angle + spread), y: y2 - back * Math.sin(angle + spread) };
  return [p1, p2, p3];
}
