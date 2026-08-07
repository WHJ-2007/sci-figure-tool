import type { ChartSpec } from "./chartLayout";

export type ShapeType = "rect" | "ellipse" | "triangle" | "diamond" | "hexagon" | "star" | "cross" | "donut" | "half";
export type ElementType = ShapeType | "arrow" | "polyline" | "text" | "logic" | "curve" | "sector" | "image" | "formula" | "pen";
export type ToolType = "select" | "rounded" | ElementType | "line";

export interface ElementShadow {
  color: string;
  blur: number;
  dx: number;
  dy: number;
  opacity: number;
}

// 图表联动绑定：元素 ↔ 图表数据项的反向映射（C 图表公式化）。
// role+index 标识 spec.data[index]（slice-i/bar-i 可拖动改数据）；非数据项（轴/标题/图例）只有 role 无 index。
// bind 缺失（旧数据/已解除关联）= 无联动。
export interface ChartBind {
  chartId: string;
  role: "slice" | "bar" | "pie-label" | "bar-label" | "pie-legend" | "axis" | "title" | "x-label" | "y-label" | "grid";
  index?: number;
}

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
  // 虚线描边（stroke-dasharray 模式，如 [8,4]）：科研图中"辅助流"语义（跳连/梯度回传/可选路径/逻辑阶段）用
  dash?: number[];
  opacity: number;
  zIndex: number;
  parentId?: string;
  chartId?: string; // 属于哪个图表（图表数据编辑/整图重排用）
  bind?: ChartBind; // 图表联动绑定（C：数据↔图形双向映射，拖动图形改数据）
  groupId?: string; // 组合对象：多个元素组合后共享同一 groupId（整体选中/移动/编辑，可移除组合）
  flipH?: boolean; // 水平镜像（绕元素中心翻转）
  flipV?: boolean; // 垂直镜像
  // 边框/内部/整体三套独立外观：填充透明度与边框透明度分别控制，
  // 各自再与整体 opacity 相乘；shadow 整体投影（与 fill/stroke 独立）
  fillOpacity?: number; // 内部填充透明度（0~1，与整体 opacity 相乘）
  strokeOpacity?: number; // 边框透明度（0~1，与整体 opacity 相乘）
  shadow?: ElementShadow; // 整体投影（颜色/模糊半径/偏移/不透明度）
}

export interface RectElement extends BaseElement {
  type: "rect";
  rx: number;
}
export interface EllipseElement extends BaseElement { type: "ellipse"; }
export interface TriangleElement extends BaseElement { type: "triangle"; }
export interface DiamondElement extends BaseElement { type: "diamond"; }
export interface HexagonElement extends BaseElement { type: "hexagon"; }
// 五角星：外接圆半径 = max(w,h)/2，内径 0.382 倍（黄金比例内缩）
export interface StarElement extends BaseElement { type: "star"; }
// 十字：臂宽 = min(w,h)/3，臂厚 = min(w,h)/6（几何公式化，命中 = 12 点多边形）
export interface CrossElement extends BaseElement { type: "cross"; }
// 圆环（甜甜圈）：外圆 max(w,h)/2，内孔 0.65 倍（渲染 evenodd 双弧，命中 = 内外圆环带）
export interface DonutElement extends BaseElement { type: "donut"; }
// 半圆：上半圆（渲染 path M 起点 A 终点 Z，命中 = 上半圆盘）
export interface HalfElement extends BaseElement { type: "half"; }

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}

// 公式元素：数学/物理/化学公式（text 存源码——支持 LaTeX 记法与 Unicode 数学符号，渲染时 LaTeX 自动转 Unicode；
// 用衬线斜体风格模拟论文公式排版，与正文文字区分）
export interface FormulaElement extends BaseElement {
  type: "formula";
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
  // 箭头头部样式：single=终点单箭头（缺省），double=两端箭头，none=无箭头（纯线）
  head?: "none" | "single" | "double";
  // 中间折点（相对坐标，相对箭头起点 e.x/e.y；整体移动时折点自动跟随，无需平移）：
  // 渲染为起点→折点…→终点的折线，右键菜单可增删、无限个；
  // smooth=true 的折点为平滑折点（Catmull-Rom 曲线平滑穿过），false/缺省为尖锐折点（直线拐角）
  midPoints?: { x: number; y: number; smooth?: boolean }[];
}

export interface PolylineElement extends BaseElement {
  type: "polyline";
  points: { x: number; y: number }[];
  arrow?: boolean; // 是否画端点箭头（默认 true；图表折线用 false）
}

// 画笔（自由手写笔迹）：points = 世界坐标点列（连续采样，渲染为平滑描边圆头曲线）。
// 手绘箭头可被识别替换为规整 ArrowElement（同方向/大小/粗细），撤销一步复原手写笔迹
export interface PenElement extends BaseElement {
  type: "pen";
  points: { x: number; y: number }[];
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
  // 空心饼图（圆环扇形）：innerRadius > 0 时挖去内孔，命中/渲染/导出为环形
  innerRadius?: number;
}

// 位图图片（用户导入，AI 不创建）：x/y=左上角，width/height=显示尺寸，src=dataURL；preserveAspectRatio=none 拉伸填充
export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
}

export type CanvasElement = RectElement | EllipseElement | TriangleElement | DiamondElement | HexagonElement | StarElement | CrossElement | DonutElement | HalfElement | TextElement | FormulaElement | ArrowElement | PolylineElement | PenElement | LogicElement | CurveElement | SectorElement | ImageElement;

export interface CanvasDocument {
  width: number;
  height: number;
  elements: CanvasElement[];
  charts?: Record<string, ChartSpec>; // chartId → 图表声明（数据/类型），编辑图表数据与导出用
  // 画布样式（右键画布菜单设置）：缺省 = 纯白；"none" = 无填充透明；
  // "#rrggbb" = 纯色；"linear:#c1,#c2" = 对角低饱和渐变（渲染与导出一致）
  background?: string;
}
