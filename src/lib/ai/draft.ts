import { CANVAS_WIDTH, CANVAS_HEIGHT, clampRect } from "@/lib/canvas/geometry";
import { makeElement } from "@/lib/canvas/elements";
import type { CanvasDocument, CanvasElement, ElementType } from "@/lib/canvas/types";

export interface CreateArgs {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;
}

export class DraftCanvas {
  elements: CanvasElement[] = [];
  private activity: string[] = [];

  constructor(elements: CanvasElement[]) {
    this.elements = structuredClone(elements);
  }

  serialize(): CanvasDocument {
    return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, elements: this.elements };
  }

  flushActivity(): string[] {
    const out = [...this.activity];
    this.activity = [];
    return out;
  }

  createElement(args: CreateArgs): { ok: boolean; id?: string; error?: string } {
    const allowed: ElementType[] = ["rect", "ellipse", "triangle", "diamond", "hexagon", "arrow", "polyline", "text"];
    if (!allowed.includes(args.type as ElementType)) return { ok: false, error: `未知元素类型: ${args.type}` };
    const w = Math.max(8, Number(args.width) || 8);
    const h = Math.max(8, Number(args.height) || 8);
    const r = clampRect({ x: args.x, y: args.y, width: w, height: h }, CANVAS_WIDTH, CANVAS_HEIGHT);
    const maxZ = this.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    let el: CanvasElement;
    if (args.type === "text") {
      el = makeElement("text", r.x, r.y, r.width, r.height, {
        text: args.text ?? "文字",
        fill: args.fill ?? "#2f2f2f",
        zIndex: maxZ + 1,
      });
    } else {
      el = makeElement(args.type as ElementType | "rounded", r.x, r.y, r.width, r.height, {
        fill: args.fill,
        stroke: args.stroke,
        strokeWidth: args.strokeWidth,
        rotation: args.rotation,
        zIndex: maxZ + 1,
      });
    }
    this.elements.push(el);
    this.activity.push(`创建${typeName(el.type)} (${Math.round(r.x)}, ${Math.round(r.y)}, ${Math.round(r.width)}×${Math.round(r.height)})${el.type === "text" ? `：${(el as any).text}` : ""}`);
    return { ok: true, id: el.id };
  }

  updateElement(args: { id: string; patch: Record<string, unknown> }): { ok: boolean; error?: string } {
    const idx = this.elements.findIndex((e) => e.id === args.id);
    if (idx < 0) return { ok: false, error: `元素不存在: ${args.id}` };
    const e = this.elements[idx];
    const next = { ...e, ...args.patch } as CanvasElement;
    next.x = Math.min(Math.max(next.x, 0), CANVAS_WIDTH - next.width);
    next.y = Math.min(Math.max(next.y, 0), CANVAS_HEIGHT - next.height);
    next.width = Math.max(4, next.width);
    next.height = Math.max(4, next.height);
    this.elements[idx] = next;
    const changed = Object.keys(args.patch).join(", ");
    this.activity.push(`修改元素 ${e.id.slice(0, 6)}：${changed}`);
    return { ok: true };
  }

  deleteElement(args: { id: string }): { ok: boolean; error?: string } {
    const idx = this.elements.findIndex((e) => e.id === args.id);
    if (idx < 0) return { ok: false, error: `元素不存在: ${args.id}` };
    this.elements.splice(idx, 1);
    this.activity.push(`删除元素 ${args.id.slice(0, 6)}`);
    return { ok: true };
  }

  listElements() {
    return this.elements.map((e) => ({
      id: e.id,
      type: e.type,
      x: Math.round(e.x),
      y: Math.round(e.y),
      width: Math.round(e.width),
      height: Math.round(e.height),
      text: e.type === "text" ? (e as any).text : undefined,
      fill: e.fill,
      stroke: e.stroke,
      rotation: e.rotation,
    }));
  }

  clear() {
    this.elements = [];
    this.activity.push("清空画布");
    return { ok: true };
  }
}

function typeName(t: string): string {
  const map: Record<string, string> = {
    rect: "矩形", ellipse: "椭圆", triangle: "三角形", diamond: "菱形",
    hexagon: "六边形", arrow: "箭头", polyline: "折线", text: "文字",
  };
  return map[t] ?? t;
}
