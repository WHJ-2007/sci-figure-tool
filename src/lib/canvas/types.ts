export type ShapeType = "rect" | "ellipse" | "triangle" | "diamond" | "hexagon";
export type ElementType = ShapeType | "arrow" | "polyline" | "text" | "logic";
export type ToolType = "select" | "rounded" | "hand" | ElementType;

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
}

// 逻辑节点：流程/结构图节点，圆角矩形 + 内置居中标题，自带上下左右 4 个箭头锚点
export interface LogicElement extends BaseElement {
  type: "logic";
  rx: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
}

export type CanvasElement = RectElement | EllipseElement | TriangleElement | DiamondElement | HexagonElement | TextElement | ArrowElement | PolylineElement | LogicElement;

export interface CanvasDocument {
  width: number;
  height: number;
  elements: CanvasElement[];
}
