import { makeElement } from "./elements";
import { CANVAS_WIDTH, CANVAS_HEIGHT, curveControl, quadBezierBounds, type Point } from "./geometry";
import type { CanvasElement } from "./types";

export interface MindMapBranch {
  keyword: string;
  body?: string;
  fill?: string;
  children?: MindMapBranch[];
}
export interface MindMapSpec {
  topic: string;
  topicBody?: string;
  branches: MindMapBranch[];
}

export const MINDMAP_PALETTE = ["#eef4ff", "#f0fff0", "#fff8e6", "#f3efff", "#ffeef0"];

const TOPIC_FONT = 18;
const NODE_FONT = 13;
const R1 = 300;      // 一级分支半径
const R_STEP = 190;  // 每层递增半径
const CHILD_SPREAD_MAX = 0.42; // 子分支最大角距（±12°）

// 语义与布局分离：AI 只声明主题与分支层级，本模块做放射布局并产出元素列表
// （中心主题 + 一级关键词逻辑节点 + 子关键词 text + 分支曲线，每分支一色）。
export function layoutMindMap(spec: MindMapSpec): CanvasElement[] {
  const cx = 800;
  const cy = 470;
  const n = spec.branches.length;
  const out: CanvasElement[] = [];
  const nodeEls: CanvasElement[] = [];
  const idCounter = { i: 0 };
  const uid = (prefix: string) => `${prefix}-${idCounter.i++}`;

  // 主题节点（先算尺寸用于锚点与曲线起点）
  const topicEl = makeElement("logic", 0, 0, 0, 0, {
    text: spec.topic,
    body: spec.topicBody,
    fontSize: TOPIC_FONT,
    bold: true,
    fill: "#ffffff",
  }) as Extract<CanvasElement, { type: "logic" }>;
  topicEl.x = cx - topicEl.width / 2;
  topicEl.y = cy - topicEl.height / 2;
  topicEl.id = uid("topic");
  topicEl.zIndex = 2;

  // 一级分支：角度均分 360°
  const branchAngle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

  const placeBranch = (b: MindMapBranch, angle: number, radius: number, color: string, level: number, parentCenter: Point) => {
    const center: Point = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    let el: CanvasElement;
    if (level === 1) {
      el = makeElement("logic", 0, 0, 0, 0, { text: b.keyword, body: b.body, fontSize: NODE_FONT, fill: color }) as Extract<CanvasElement, { type: "logic" }>;
    } else {
      el = makeElement("text", 0, 0, 0, 0, { text: b.keyword, fontSize: NODE_FONT, fill: color }) as Extract<CanvasElement, { type: "text" }>;
    }
    el.id = uid("node");
    el.x = center.x - el.width / 2;
    el.y = center.y - el.height / 2;
    el.zIndex = level === 1 ? 2 : 3;
    nodeEls.push(el);

    // 父→子曲线：起点 = 父元素朝向子中心的边缘锚点（离父中心 8px），终点 = 子中心
    out.push(makeCurve(edgePointToward(parentCenter, center), center, color));

    const children = b.children ?? [];
    if (children.length) {
      const spread = Math.min(CHILD_SPREAD_MAX, (2 * Math.PI) / n * 0.4);
      children.forEach((child, j) => {
        const childAngle = angle + (j - (children.length - 1) / 2) * spread;
        placeBranch(child, childAngle, radius + R_STEP, color, level + 1, center);
      });
    }
  };

  spec.branches.forEach((b, i) => {
    placeBranch(b, branchAngle(i), R1, b.fill ?? MINDMAP_PALETTE[i % MINDMAP_PALETTE.length], 1, {
      x: cx,
      y: cy,
    });
  });

  return fitToCanvas([topicEl, ...nodeEls, ...out]);
}

// 父元素朝向目标点的边缘锚点：从父中心出发朝 to 方向，返回离父中心 8px 处的点（曲线起点）
function edgePointToward(parent: Point, to: Point): Point {
  const d = Math.hypot(to.x - parent.x, to.y - parent.y) || 1;
  return { x: parent.x + ((to.x - parent.x) / d) * 8, y: parent.y + ((to.y - parent.y) / d) * 8 };
}

function makeCurve(start: Point, end: Point, color: string): CanvasElement {
  // 控制点凸向远离画布中心一侧
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const side = (800 - mid.x) * px + (470 - mid.y) * py;
  const curvature = (side >= 0 ? 1 : -1) * 0.4;
  const el = makeElement("curve", start.x, start.y, end.x - start.x, end.y - start.y, {
    curvature,
    stroke: color === "#ffffff" ? "#2f2f2f" : color,
    strokeWidth: 2.5,
    zIndex: 1,
  });
  el.id = `curve-${Math.random().toString(36).slice(2, 8)}`;
  return el;
}

// 整体缩放回画布：位置缩放、节点尺寸不变（与 graphLayout 同一思路），保留 20px 边距
function fitToCanvas(els: CanvasElement[]): CanvasElement[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of els) {
    let b: { x: number; y: number; width: number; height: number };
    if (e.type === "curve") {
      const c = curveControl(e);
      b = quadBezierBounds({ x: e.x, y: e.y }, c, { x: e.x + e.width, y: e.y + e.height });
    } else {
      b = { x: e.x, y: e.y, width: e.width, height: e.height };
    }
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = Math.min(1, (CANVAS_WIDTH - 40) / bw, (CANVAS_HEIGHT - 40) / bh);
  if (scale >= 1) return els;
  return els.map((e) => {
    const next = { ...e } as CanvasElement;
    next.x = (e.x - minX) * scale + 20;
    next.y = (e.y - minY) * scale + 20;
    if (e.type === "curve") {
      next.width = e.width * scale;
      next.height = e.height * scale;
    }
    return next;
  });
}
