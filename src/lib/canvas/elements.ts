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
  Partial<LogicElement>;

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
    fill: extra.fill ?? DEFAULT_FILL,
    stroke: extra.stroke ?? DEFAULT_STROKE,
    strokeWidth: extra.strokeWidth ?? 2,
    opacity: extra.opacity ?? 1,
    zIndex: extra.zIndex ?? 0,
    parentId: extra.parentId,
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
      return { ...base, type: "arrow", startId: extra.startId, endId: extra.endId } as CanvasElement;
    case "polyline": {
      const pts = extra.points as { x: number; y: number }[] | undefined;
      const points = pts?.length
        ? pts
        : [
            { x, y },
            { x: x + width, y: y + height },
          ];
      return { ...base, type: "polyline", points } as CanvasElement;
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
      // 逻辑节点：圆角矩形 + 内置居中标题；尺寸不足时扩展以容纳标题
      const t = extra.text ?? "逻辑";
      const fontSize = extra.fontSize ?? 14;
      const size = estimateTextSize(t, fontSize, extra.bold ?? false);
      return {
        ...base,
        type: "logic",
        rx: extra.rx ?? 6,
        text: t,
        fontSize,
        fontFamily: extra.fontFamily ?? "Arial, Microsoft YaHei, sans-serif",
        bold: extra.bold ?? false,
        width: Math.max(width, size.width + 16),
        height: Math.max(height, size.height + 10),
      } as CanvasElement;
    }
  }
}
