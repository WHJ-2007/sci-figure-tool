export type ShapeType = "rect" | "ellipse" | "triangle" | "diamond" | "hexagon";
export type ElementType = ShapeType | "arrow" | "polyline" | "text";
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

export type CanvasElement = RectElement | EllipseElement | TriangleElement | DiamondElement | HexagonElement | TextElement | ArrowElement | PolylineElement;

export interface CanvasDocument {
  width: number;
  height: number;
  elements: CanvasElement[];
}
