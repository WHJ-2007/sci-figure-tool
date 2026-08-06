import type {
  CanvasElement,
  ElementType,
  RectElement,
  EllipseElement,
  TriangleElement,
  DiamondElement,
  HexagonElement,
  TextElement,
  ArrowElement,
  PolylineElement,
  LogicElement,
  CurveElement,
  SectorElement,
  ImageElement,
} from "./types";

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export const DEFAULT_FILL = "#ffffff";
export const DEFAULT_STROKE = "#2f2f2f";

// 逐字符宽度估算（em 单位）：CJK 全角 1，拉丁按常见字体实际占比分类，加粗再放大 6%
function charWidthEm(ch: string): number {
  if (/[一-鿿　-〿＀-￯]/.test(ch)) return 1;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[a-z]/.test(ch)) return 0.55;
  if (/[0-9]/.test(ch)) return 0.6;
  if (ch === " ") return 0.32;
  if (/[.,!?;:，。！？；：、]/.test(ch)) return 0.3;
  if (/[()\[\]{}（）【】]/.test(ch)) return 0.5;
  if (/[-_/\\|~^+=*]/.test(ch)) return 0.4;
  return 0.6;
}

export function estimateTextSize(text: string, fontSize: number, bold = false): { width: number; height: number } {
  let w = 0;
  for (const ch of text) w += charWidthEm(ch);
  return { width: Math.max(w * fontSize * (bold ? 1.06 : 1), 8), height: fontSize * 1.4 };
}

// 逻辑节点整体尺寸：容纳标题行 + 多行正文（正文小 2 号），上下内边距 5、左右 8
export function logicBoxSize(
  title: string,
  body: string | undefined,
  fontSize: number,
  bold = false
): { width: number; height: number } {
  const titleSize = estimateTextSize(title, fontSize, bold);
  const bodyFontSize = Math.max(10, fontSize - 2);
  const lines = (body ?? "").split("\n");
  const bodyWidth = lines.reduce((w, l) => Math.max(w, estimateTextSize(l, bodyFontSize).width), 0);
  return {
    width: Math.max(titleSize.width, bodyWidth) + 16,
    height: titleSize.height + lines.length * (bodyFontSize * 1.4) + 10,
  };
}

// 元素渲染/导出的变换：仅旋转时保持旧格式 rotate(deg cx cy)（兼容既有测试/导出文件）；
// 有镜像时用 平移→旋转→缩放→平移 的组合（绕元素中心翻转）
export function elementTransform(e: CanvasElement): string | undefined {
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  if (!e.rotation && !e.flipH && !e.flipV) return undefined;
  if (!e.flipH && !e.flipV) return `rotate(${e.rotation} ${cx} ${cy})`;
  return `translate(${cx} ${cy}) rotate(${e.rotation || 0}) scale(${e.flipH ? -1 : 1} ${e.flipV ? -1 : 1}) translate(${-cx} ${-cy})`;
}

// 按填充色亮度取对比文字色（亮底深字、暗底白字）；logic 节点标题用
export function contrastTextColor(fill: string): string {
  const hex = fill.startsWith("#") ? fill.slice(1) : "ffffff";
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#2f2f2f" : "#ffffff";
}

export type ElementExtras = Partial<RectElement> &
  Partial<EllipseElement> &
  Partial<TriangleElement> &
  Partial<DiamondElement> &
  Partial<HexagonElement> &
  Partial<TextElement> &
  Partial<ArrowElement> &
  Partial<PolylineElement> &
  Partial<LogicElement> &
  Partial<CurveElement> &
  Partial<SectorElement> &
  Partial<ImageElement>;

export function makeElement(
  type: ElementType | "rounded",
  x: number,
  y: number,
  width: number,
  height: number,
  extra: ElementExtras = {}
): CanvasElement {
  const base = {
    id: extra.id ?? newId(),
    x,
    y,
    width,
    height,
    rotation: extra.rotation ?? 0,
    flipH: extra.flipH ?? false,
    flipV: extra.flipV ?? false,
    fill: extra.fill ?? DEFAULT_FILL,
    stroke: extra.stroke ?? DEFAULT_STROKE,
    strokeWidth: extra.strokeWidth ?? 2,
    opacity: extra.opacity ?? 1,
    zIndex: extra.zIndex ?? 0,
    parentId: extra.parentId,
    // 三独立外观（内部填充/边框/整体投影）：仅当显式传入时才写键，
    // 旧元素保持无键，渲染与导出按 undefined 兼容
    ...(extra.fillOpacity !== undefined ? { fillOpacity: extra.fillOpacity } : {}),
    ...(extra.strokeOpacity !== undefined ? { strokeOpacity: extra.strokeOpacity } : {}),
    ...(extra.shadow !== undefined ? { shadow: extra.shadow } : {}),
  };
  switch (type) {
    case "rect":
      return { ...base, type: "rect", rx: extra.rx ?? 0 } as CanvasElement;
    case "rounded":
      return { ...base, type: "rect", rx: extra.rx ?? 8 } as CanvasElement;
    case "ellipse":
      return { ...base, type: "ellipse" } as CanvasElement;
    case "triangle":
      return { ...base, type: "triangle" } as CanvasElement;
    case "diamond":
      return { ...base, type: "diamond" } as CanvasElement;
    case "hexagon":
      return { ...base, type: "hexagon" } as CanvasElement;
    case "arrow":
      return { ...base, type: "arrow", startId: extra.startId, endId: extra.endId, head: extra.head, midPoints: extra.midPoints } as CanvasElement;
    case "polyline": {
      const pts = extra.points as { x: number; y: number }[] | undefined;
      const points = pts?.length
        ? pts
        : [
            { x, y },
            { x: x + width, y: y + height },
          ];
      return { ...base, type: "polyline", points, arrow: extra.arrow } as CanvasElement;
    }
    case "text": {
      const t = extra.text ?? "文字";
      const fontSize = extra.fontSize ?? 16;
      const size = estimateTextSize(t, fontSize, extra.bold ?? false);
      return {
        ...base,
        type: "text",
        text: t,
        fontSize,
        fontFamily: extra.fontFamily ?? "Arial, Microsoft YaHei, sans-serif",
        bold: extra.bold ?? false,
        italic: extra.italic ?? false,
        align: extra.align ?? "center",
        width: size.width,
        height: size.height,
      } as CanvasElement;
    }
    case "logic": {
      // 逻辑节点：圆角矩形 + 内置居中标题 + 多行正文；尺寸不足时扩展以容纳标题与正文
      const t = extra.text ?? "逻辑";
      const b = extra.body as string | undefined;
      const fontSize = extra.fontSize ?? 14;
      const size = logicBoxSize(t, b, fontSize, extra.bold ?? false);
      return {
        ...base,
        type: "logic",
        rx: extra.rx ?? 6,
        text: t,
        body: b,
        fontSize,
        fontFamily: extra.fontFamily ?? "Arial, Microsoft YaHei, sans-serif",
        bold: extra.bold ?? false,
        width: Math.max(width, size.width),
        height: Math.max(height, size.height),
      } as CanvasElement;
    }
    case "curve":
      return { ...base, type: "curve", curvature: extra.curvature ?? 0.5 } as CanvasElement;
    case "sector":
      return {
        ...base,
        type: "sector",
        radius: extra.radius ?? Math.max(width, height) / 2,
        startAngle: extra.startAngle ?? 0,
        endAngle: extra.endAngle ?? Math.PI * 2,
      } as CanvasElement;
    case "image":
      return { ...base, type: "image", src: extra.src ?? "" } as CanvasElement;
  }
}
