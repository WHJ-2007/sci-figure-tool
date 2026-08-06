import type { ChartSpec } from "./chartLayout";

export type ShapeType = "rect" | "ellipse" | "triangle" | "diamond" | "hexagon";
export type ElementType = ShapeType | "arrow" | "polyline" | "text" | "logic" | "curve" | "sector";
export type ToolType = "select" | "rounded" | ElementType;

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  zIndex: number;
  parentId?: string;
  chartId?: string; // 属于哪个图表（图表数据编辑/整图重排用）
}

export interface RectElement extends BaseElement {
  type: "rect";
  rx: number;
}
export interface EllipseElement extends BaseElement { type: "ellipse"; }
export interface TriangleElement extends BaseElement { type: "triangle"; }
export interface DiamondElement extends BaseElement { type: "diamond"; }
export interface HexagonElement extends BaseElement { type: "hexagon"; }

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}

export interface ArrowElement extends BaseElement {
  type: "arrow";
  startId?: string;
  endId?: string;
}

export interface PolylineElement extends BaseElement {
  type: "polyline";
  points: { x: number; y: number }[];
  arrow?: boolean; // 是否画端点箭头（默认 true；图表折线用 false）
}

// 逻辑节点：流程/结构图节点，圆角矩形 + 内置居中标题 + 多行正文（body，\n 分隔），自带上下左右 4 个箭头锚点
export interface LogicElement extends BaseElement {
  type: "logic";
  rx: number;
  text: string;
  body?: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
}

// 贝塞尔曲线分支线（AI 生成专用）：x/y=起点，width/height=终点相对偏移，
// 控制点 = 起终点中点沿法线偏移 curvature×线长（0=直线，正负号控制凸向）
export interface CurveElement extends BaseElement {
  type: "curve";
  curvature: number;
}

// 饼图扇形（AI 生成专用）：x/y=圆心，radius + startAngle/endAngle（弧度，0 在 3 点钟方向顺时针）
export interface SectorElement extends BaseElement {
  type: "sector";
  radius: number;
  startAngle: number;
  endAngle: number;
}

export type CanvasElement = RectElement | EllipseElement | TriangleElement | DiamondElement | HexagonElement | TextElement | ArrowElement | PolylineElement | LogicElement | CurveElement | SectorElement;

export interface CanvasDocument {
  width: number;
  height: number;
  elements: CanvasElement[];
  charts?: Record<string, ChartSpec>; // chartId → 图表声明（数据/类型），编辑图表数据与导出用
}
