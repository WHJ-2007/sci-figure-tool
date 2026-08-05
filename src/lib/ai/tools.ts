import { z } from "zod";
import { tool } from "ai";
import type { DraftCanvas } from "./draft";

const shapeType = z.enum(["rect", "ellipse", "triangle", "diamond", "hexagon", "arrow", "polyline", "text", "logic"]);

export function buildTools(draft: DraftCanvas) {
  return {
    createElement: tool({
      description:
        "在画布上创建一个元素（形状/箭头/文字/逻辑节点）。坐标原点在左上角，画布宽 1600 高 1000。" +
        "arrow 类型：x/y 是起点，必须落在源形状的边缘上；width/height 是终点相对偏移，终点必须精确落在目标形状的边缘上，箭头尖端贴住目标边框，不能悬空、不能插入太深。" +
        "logic 类型：流程/结构图语义模块（圆角框 + 内置居中标题 + 自带上下左右 4 个箭头锚点），必须提供 text 标题；用普通图形画语义模块时优先用 logic。text 类型必须提供 text 内容。",
      inputSchema: z.object({
        type: shapeType,
        x: z.number().describe("左上角 x（arrow 为起点 x，须落在源形状边缘上）"),
        y: z.number().describe("左上角 y（arrow 为起点 y，须落在源形状边缘上）"),
        width: z.number().positive().describe("宽度（arrow 为终点相对水平偏移）"),
        height: z.number().positive().describe("高度（arrow 为终点相对垂直偏移）"),
        text: z.string().optional().describe("文字内容（type=text/logic 时必填，logic 为框内标题）"),
        fill: z.string().optional().describe("填充色，如 #eef4ff"),
        stroke: z.string().optional().describe("边框色，如 #2f2f2f"),
        strokeWidth: z.number().optional().describe("边框宽度"),
        rotation: z.number().optional().describe("旋转角度"),
        fontSize: z.number().optional().describe("字号（text 类型用，建议 16~28）"),
        bold: z.boolean().optional().describe("是否加粗（text 类型用）"),
        italic: z.boolean().optional().describe("是否斜体（text 类型用）"),
        align: z.enum(["left", "center", "right"]).optional().describe("文字对齐（text 类型用，默认 center）"),
        fontFamily: z.string().optional().describe("字体（text 类型用，默认 Arial, Microsoft YaHei, sans-serif）"),
      }),
      execute: (args) => draft.createElement(args),
    }),
    connectElements: tool({
      description:
        "用箭头精确连接两个已有元素：自动计算从源元素边缘到目标元素边缘的箭头（锚点精确落在两个形状的轮廓上，无需手算坐标）。" +
        "逻辑节点（logic）自带上下左右 4 个锚点，连接会优先从朝向对方的那侧锚点出发/收在锚点上。" +
        "只要两个元素有语义关系（流程、依赖、连接）就优先用它，不要用 createElement 手绘箭头。",
      inputSchema: z.object({
        sourceId: z.string().describe("箭头起点的元素 id（通过 listElements 获取）"),
        targetId: z.string().describe("箭头终点的元素 id（通过 listElements 获取）"),
        stroke: z.string().optional().describe("箭头颜色，如 #2f2f2f"),
        strokeWidth: z.number().optional().describe("线宽"),
      }),
      execute: (args) => draft.connectElements(args),
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
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          align: z.enum(["left", "center", "right"]).optional(),
          fontFamily: z.string().optional(),
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
      description: "清空整个画布，重新开始。仅当用户明确要求清空画布或重画时才使用。",
      inputSchema: z.object({}),
      execute: () => draft.clear(),
    }),
    newCanvas: tool({
      description: "新建一个空白画布并切换到它。仅当现有画布上的内容确实无法承载用户需求时才使用；普通的新增/修改需求不要调用。",
      inputSchema: z.object({}),
      execute: () => draft.newCanvas(),
    }),
  };
}
