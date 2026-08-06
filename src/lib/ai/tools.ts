import { z } from "zod";
import { tool } from "ai";
import type { DraftCanvas } from "./draft";

const shapeType = z.enum(["rect", "ellipse", "triangle", "diamond", "hexagon", "star", "cross", "donut", "half", "arrow", "polyline", "text", "logic"]);

// 递归分支 schema：显式类型参数避免 TS 循环引用（zod 支持 z.lazy 延迟求值）
type MindMapBranchInput = { keyword: string; body?: string; fill?: string; children?: MindMapBranchInput[] };
const branchSchema: z.ZodType<MindMapBranchInput> = z.lazy(() =>
  z.object({
    keyword: z.string().describe("分支关键词（实义语义名词，≤8 字）"),
    body: z.string().optional().describe("分支要点（多行用 \\n 分隔，每行一个要点 ≤12 字，可省略）"),
    fill: z.string().optional().describe("填充色（5 色调色板：蓝/绿/橙/紫/红，可省略自动配色，同分支同色系）"),
    children: z.array(branchSchema).optional().describe("子分支（≤3 层）"),
  })
);

export function buildTools(draft: DraftCanvas) {
  return {
    createElement: tool({
      description:
        "在画布上创建一个元素（形状/箭头/文字/逻辑节点）。坐标原点在左上角，画布宽 1600 高 1000。" +
        "arrow 类型：x/y 是起点，必须落在源形状的边缘上；width/height 是终点相对偏移，终点必须精确落在目标形状的边缘上，箭头尖端贴住目标边框，不能悬空、不能插入太深；head 控制箭头头部样式（single 单箭头=默认 / double 两端箭头 / none 无箭头纯线），strokeWidth 粗细会同时放大箭头头（默认线宽 2 → 头约 10px）。" +
        "纯线/折线轮廓（简笔画用）：arrow + head:\"none\" 即无箭头纯线，需要拐弯时用 midPoints 折点（相对坐标，相对起点偏移）；多条纯线可拼出图案。" +
        "logic 类型：流程/结构图语义模块（圆角框 + 内置居中标题 + 自带上下左右 4 个箭头锚点），必须提供 text 标题（简洁语义名词，建议 ≤8 字、不加标点）；正文按语义判断——标题已完整表达语义的概念型节点（如\"注意力\"\"损失函数\"）可不写 body，过程/说明型节点用 body 写 2~4 行要点（多行用 \\n 分隔，每行一个要点 ≤12 字），禁止标题和正文都没有的空白空盒子；width/height 无需精确指定，系统按标题+正文自动扩框；语义模块一律用 logic，禁止 rect+文字两件套。text 类型必须提供 text 内容。" +
        "文字尺寸公式（text/logic 由系统按字号自动计算宽高，不必手算）：中文每字 1×字号，英文大写 0.68×字号、小写 0.55×字号、数字 0.6×字号、空格 0.32×字号，加粗再 ×1.06，行高 1.4×字号。" +
        "text/logic 的 width/height 会被系统重算并自动扩框容纳文字，无需精确指定；框要容纳文字时按此公式估算并左右各留 ≥12px 内边距。",
      inputSchema: z.object({
        type: shapeType,
        x: z.number().describe("左上角 x（arrow 为起点 x，须落在源形状边缘上）"),
        y: z.number().describe("左上角 y（arrow 为起点 y，须落在源形状边缘上）"),
        width: z.number().positive().describe("宽度（arrow 为终点相对水平偏移）"),
        height: z.number().positive().describe("高度（arrow 为终点相对垂直偏移）"),
        text: z.string().optional().describe("文字内容（type=text/logic 时必填，logic 为框内标题）"),
        body: z.string().optional().describe("逻辑节点正文（按语义判断：标题已完整表达语义的概念型节点可不写；过程/说明型节点写 2~4 行要点，多行用 \\n 分隔，每行一个要点 ≤12 字；系统自动扩框容纳）"),
        fill: z.string().optional().describe("填充色，如 #eef4ff"),
        stroke: z.string().optional().describe("边框色，如 #2f2f2f"),
        strokeWidth: z.number().optional().describe("边框/线宽（arrow 时同时决定箭头头大小：默认 2 → 头约 10px，调大一起变大）"),
        rotation: z.number().optional().describe("旋转角度"),
        fontSize: z.number().optional().describe("字号（text 类型用，建议 16~28）"),
        bold: z.boolean().optional().describe("是否加粗（text 类型用）"),
        italic: z.boolean().optional().describe("是否斜体（text 类型用）"),
        align: z.enum(["left", "center", "right"]).optional().describe("文字对齐（text 类型用，默认 center）"),
        fontFamily: z.string().optional().describe("字体（text 类型用，默认 Arial, Microsoft YaHei, sans-serif）"),
        head: z.enum(["none", "single", "double"]).optional().describe("箭头头部样式（type=arrow 时用：single 单箭头=默认 / double 两端箭头 / none 无箭头纯线）"),
      }),
      execute: (args) => draft.createElement(args),
    }),
    applyGraph: tool({
      description:
        "声明式一键绘制流程/结构图：只需声明节点（标题/正文/填充色）与节点间的连接关系，系统自动完成分层布局（对齐、等距、连线）。" +
        "节点自动创建为逻辑节点（圆角框 + 居中标题 + 自带 4 个箭头锚点），连线自动精确对接锚点。" +
        "流程图、架构图、数据管道等一切有明确节点+关系的图都优先用它，一次调用代替逐条 createElement + connectElements。" +
        "direction：TB 自上而下（默认）、LR 从左到右。布局超出画布时系统自动整体缩放（最低 0.5 倍）。",
      inputSchema: z.object({
        nodes: z.array(
          z.object({
            id: z.string().describe("节点唯一标识（英文/数字），供 edges 引用"),
            text: z.string().describe("节点标题（简洁语义名词，≤8 字，不加标点、不加“模块/组件”后缀）"),
            body: z.string().optional().describe("节点正文（按正文语义判断：标题已完整表达语义的概念型节点可不写；过程/说明型节点写 2~4 行要点，多行用 \\n 分隔，每行一个要点 ≤12 字，交代该步骤做什么/包含什么）"),
            fill: z.string().optional().describe("填充色（科研调色板：#eef4ff 蓝 / #f0fff0 绿 / #fff8e6 橙 / #f3efff 紫 / #ffeef0 红 / #ffffff 白；同图 ≤3 种颜色）"),
            width: z.number().optional().describe("期望宽度（可省略，系统按标题+正文自动扩框）"),
            height: z.number().optional().describe("期望高度（可省略，系统按标题+正文自动扩框）"),
          })
        ),
        edges: z.array(z.object({ from: z.string(), to: z.string() })).describe("节点间连接关系（箭头方向从 from 指向 to）"),
        direction: z.enum(["TB", "LR"]).optional().describe("布局方向：TB 自上而下（默认）、LR 从左到右"),
      }),
      execute: (args) => draft.applyGraph(args),
    }),
    applyMindMap: tool({
      description:
        "声明式一键生成思维导图：只需声明中心主题与分支层级（关键词/要点/子分支），系统自动完成放射布局——中心主题 + 曲线分支 + 关键词节点 + 每分支一色。" +
        "思维导图一律优先用它。关键词必须是实义语义名词（≤8 字，如“数据预处理”“损失函数”），禁止“分支1”“子项2”等空泛词；" +
        "整图 3~5 个一级分支、每分支 1~3 层子分支；分支要点用 body 展开（每行一个要点 ≤12 字）。",
      inputSchema: z.object({
        topic: z.string().describe("中心主题（简洁语义名词，≤8 字）"),
        topicBody: z.string().optional().describe("主题副标题/要点（多行用 \\n 分隔，可省略）"),
        branches: z.array(branchSchema).describe("一级分支（3~5 个）"),
      }),
      execute: (args) => draft.applyMindMap(args),
    }),
    applyChart: tool({
      description:
        "声明式一键绘制数据图表（柱状图/折线图/饼图/散点图）：只需声明类型/标题/坐标轴名/数据，系统自动计算坐标轴、刻度（自动取整）、柱形/折线/扇形、数据标签与图例。" +
        "数据必须是用户给出的原值，或常识范围内的合理数值（如“中国 GDP 2023 约 126 万亿元”），3~12 项，禁止编造离谱数据。" +
        "饼图数据项不宜超过 8 项；多系列（series 字段）用于柱状分组/折线多线对比。" +
        "数据图表（含通用图示以外的数据可视化需求）一律优先用本工具。",
      inputSchema: z.object({
        type: z.enum(["bar", "line", "pie", "scatter"]).describe("图表类型：bar 柱状 / line 折线 / pie 饼图 / scatter 散点"),
        title: z.string().optional().describe("图表标题（应尽量提供）"),
        xLabel: z.string().optional().describe("x 轴名称"),
        yLabel: z.string().optional().describe("y 轴名称"),
        data: z.array(
          z.object({
            label: z.string().describe("分类标签（x 轴类别，如“Q1”“2021”）"),
            value: z.number().describe("数值（非负）"),
            series: z.string().optional().describe("系列名（多系列对比时用，如“本店”“他店”）"),
          })
        ).describe("数据（3~12 项）"),
      }),
      execute: (args) => draft.applyChart(args),
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
        strokeWidth: z.number().optional().describe("线宽（同时决定箭头头大小：默认 2 → 头约 10px，调大一起变大）"),
        head: z.enum(["none", "single", "double"]).optional().describe("箭头头部样式（single 单箭头=默认 / double 两端箭头 / none 无箭头纯线）"),
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
          body: z.string().optional().describe("逻辑节点正文（多行用 \\n 分隔，每行一个要点 ≤12 字）"),
          fontSize: z.number().optional(),
          opacity: z.number().optional(),
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          align: z.enum(["left", "center", "right"]).optional(),
          fontFamily: z.string().optional(),
          head: z.enum(["none", "single", "double"]).optional().describe("箭头头部样式（arrow 类型：single 单箭头 / double 两端箭头 / none 无箭头纯线）"),
          zIndex: z.number().optional().describe("层级（数值越大越靠上；遮挡时把要显示在前面的元素调大，被遮的调小）"),
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
      description: "新建一个空白画布并切换到它。用户明确要求新建画布（如\"新建画布\"\"新开一张\"\"换一张空白画布\"\"从零重画\"）时立即使用；会弹确认框，用户允许后执行。普通的新增/修改需求不要调用。",
      inputSchema: z.object({}),
      execute: () => draft.newCanvas(),
    }),
  };
}
