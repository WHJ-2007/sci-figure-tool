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
} from "./types";

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export const DEFAULT_FILL = "#ffffff";
export const DEFAULT_STROKE = "#2f2f2f";

export function estimateTextSize(text: string, fontSize: number): { width: number; height: number } {
  let w = 0;
  for (const ch of text) {
    w += /[一-鿿　-〿＀-￯]/.test(ch) ? 1 : 0.6;
  }
  return { width: Math.max(w * fontSize, 8), height: fontSize * 1.4 };
}

type ElementExtras = Partial<RectElement> &
  Partial<EllipseElement> &
  Partial<TriangleElement> &
  Partial<DiamondElement> &
  Partial<HexagonElement> &
  Partial<TextElement> &
  Partial<ArrowElement> &
  Partial<PolylineElement>;

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
    ...extra,
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
    case "arrow": {
      const e = { ...base, type: "arrow", startId: extra.startId, endId: extra.endId } as CanvasElement;
      return e;
    }
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
      const t = (extra.text as string) ?? "文字";
      const fontSize = (extra.fontSize as number) ?? 16;
      const size = estimateTextSize(t, fontSize);
      return {
        ...base,
        type: "text",
        text: t,
        fontSize,
        fontFamily: (extra.fontFamily as string) ?? "Arial, Microsoft YaHei, sans-serif",
        bold: (extra.bold as boolean) ?? false,
        italic: (extra.italic as boolean) ?? false,
        align: (extra.align as "left" | "center" | "right") ?? "center",
        width: size.width,
        height: size.height,
      } as CanvasElement;
    }
  }
}
