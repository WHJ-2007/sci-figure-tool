import { z } from "zod";
import { tool } from "ai";
import type { DraftCanvas } from "./draft";

const shapeType = z.enum(["rect", "ellipse", "triangle", "diamond", "hexagon", "arrow", "polyline", "text"]);

export function buildTools(draft: DraftCanvas) {
  return {
    createElement: tool({
      description: "在画布上创建一个元素（形状/箭头/文字）。坐标原点在左上角，画布宽 1600 高 1000。text 类型必须提供 text 内容。",
      inputSchema: z.object({
        type: shapeType,
        x: z.number().describe("左上角 x"),
        y: z.number().describe("左上角 y"),
        width: z.number().positive().describe("宽度"),
        height: z.number().positive().describe("高度"),
        text: z.string().optional().describe("文字内容（type=text 时必填）"),
        fill: z.string().optional().describe("填充色，如 #eef4ff"),
        stroke: z.string().optional().describe("边框色，如 #2f2f2f"),
        strokeWidth: z.number().optional().describe("边框宽度"),
        rotation: z.number().optional().describe("旋转角度"),
      }),
      execute: (args) => draft.createElement(args),
    }),
    updateElement: tool({
      description: "修改一个已有元素的属性（位置、颜色、文字内容等）。id 通过 listElements 获取。",
      inputSchema: z.object({
        id: z.string(),
        patch: z.object({
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          fill: z.string().optional(),
          stroke: z.string().optional(),
          strokeWidth: z.number().optional(),
          rotation: z.number().optional(),
          text: z.string().optional(),
          fontSize: z.number().optional(),
          opacity: z.number().optional(),
        }),
      }),
      execute: (args) => draft.updateElement(args),
    }),
    deleteElement: tool({
      description: "删除一个元素。",
      inputSchema: z.object({ id: z.string() }),
      execute: (args) => draft.deleteElement(args),
    }),
    listElements: tool({
      description: "查看当前画布上所有元素（id、类型、位置、文字）。动手前先调用。",
      inputSchema: z.object({}),
      execute: () => draft.listElements(),
    }),
    clearCanvas: tool({
      description: "清空整个画布，重新开始。",
      inputSchema: z.object({}),
      execute: () => draft.clear(),
    }),
  };
}
