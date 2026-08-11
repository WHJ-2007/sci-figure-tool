import { z } from "zod";
import { tool } from "ai";
import type { DraftCanvas } from "./draft";
import { searchWeb, formatSearchResults } from "./search";

const shapeType = z.enum(["rect", "ellipse", "triangle", "diamond", "hexagon", "star", "cross", "donut", "half", "arrow", "polyline", "text", "logic", "formula", "pen"]);

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

// 其他画布的紧凑摘要（AI 可跨画布读取用于模仿/参考）：元素关键字段，不含位图 dataURL 防体积爆炸
export interface CanvasSnapshot {
  id: string;
  name: string;
  elements: {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    body?: string;
    fill?: string;
    stroke?: string;
    head?: string;
  }[];
}

export function buildTools(
  draft: DraftCanvas,
  tavilyApiKey?: string,
  canvases: CanvasSnapshot[] = [],
  onReferenced?: (canvasName: string) => void
) {
  return {
    createElement: tool({
      description:
        "在画布上创建一个元素（形状/箭头/文字/逻辑节点/公式/画笔）。坐标原点在左上角，画布宽 1600 高 1000。" +
        "pen 类型（画笔自由手绘）：type:\"pen\" 配合 points 传连续点列（世界坐标），画出的是一条圆头圆角自由曲线——能画任何现有图案表达不了的形状：手写符号（σ、∫、∑ 曲线）、复杂结构图标（卷积核/残差块/损失曲面）、手绘示意连线等。一个符号可以由多条 pen 笔迹组合（每条对应符号的一个可见部分：轮廓/连接/装饰），理解\"为什么这么组合\"再动手，不要死记硬背。用户明确要\"手写/手绘/随意画\"时必须用它。" +
        "arrow 类型：x/y 是起点，必须落在源形状的边缘上；width/height 是终点相对偏移，终点必须精确落在目标形状的边缘上，箭头尖端贴住目标边框，不能悬空、不能插入太深；head 控制箭头头部样式（single 单箭头=默认 / double 两端箭头 / none 无箭头纯线），strokeWidth 粗细会同时放大箭头头（默认线宽 2 → 头约 10px）。" +
        "dash 虚线描边（任意类型可用）：dash:[8,4] 表示实线 8px 虚线 4px。科研图中虚线有固定语义——辅助流/跳连/梯度回传/可选路径/逻辑阶段范围（如 skip connection、loss 回传、可选分支），与实线（主数据流）区分；带折点的虚线箭头同样适用。" +
        "纯线/折线轮廓（简笔画用）：arrow + head:\"none\" 即无箭头纯线，需要拐弯时用 midPoints 折点（相对坐标，相对起点偏移）；多条纯线可拼出图案。" +
        "logic 类型：流程/结构图语义模块（圆角框 + 内置居中标题 + 自带上下左右 4 个箭头锚点），必须提供 text 标题（简洁语义名词，建议 ≤8 字、不加标点）；正文按语义判断——标题已完整表达语义的概念型节点（如\"注意力\"\"损失函数\"）可不写 body，过程/说明型节点用 body 写 2~4 行要点（多行用 \\n 分隔，每行一个要点 ≤12 字），禁止标题和正文都没有的空白空盒子；width/height 无需精确指定，系统按标题+正文自动扩框；语义模块一律用 logic，禁止 rect+文字两件套。shape 可选外形：rect 矩形（默认）/ parallelogram 平行四边形 / diamond 菱形；正方形、长方形都是矩形——正方形用 width=height 表示，长方形 width≠height，平行四边形（斜框，表示并行/过程流）与菱形（决策/判断节点）语义不同，按图意选择。" +
        "formula 类型（数学/物理/化学公式）：text 填公式源码，支持 LaTeX 记法（\\frac{a}{b}、\\alpha、x^2、H_2O、\\sum_{i=1}^{n}）与 Unicode 数学符号（α、β、√、∑、∫），系统自动把 LaTeX 转成 Unicode 衬线斜体渲染；科研图里出现公式（损失函数、算法复杂度、化学式、物理定律）时用它，不要用普通 text 手打公式。" +
        "文字尺寸公式（text/logic 由系统按字号自动计算宽高，不必手算）：中文每字 1×字号，英文大写 0.68×字号、小写 0.55×字号、数字 0.6×字号、空格 0.32×字号，加粗再 ×1.06，行高 1.4×字号。" +
        "text/logic 的 width/height 会被系统重算并自动扩框容纳文字，无需精确指定；框要容纳文字时按此公式估算并左右各留 ≥12px 内边距。",
      inputSchema: z.object({
        type: shapeType,
        x: z.number().describe("左上角 x（arrow 为起点 x，须落在源形状边缘上）"),
        y: z.number().describe("左上角 y（arrow 为起点 y，须落在源形状边缘上）"),
        width: z.number().positive().describe("宽度（arrow 为终点相对水平偏移）"),
        height: z.number().positive().describe("高度（arrow 为终点相对垂直偏移）"),
        text: z.string().optional().describe("文字内容（type=text/logic/formula 时必填：logic 为框内标题，formula 为公式源码 LaTeX/Unicode）"),
        body: z.string().optional().describe("逻辑节点正文（按语义判断：标题已完整表达语义的概念型节点可不写；过程/说明型节点写 2~4 行要点，多行用 \\n 分隔，每行一个要点 ≤12 字；系统自动扩框容纳）"),
        fill: z.string().optional().describe("填充色，如 #eef4ff"),
        stroke: z.string().optional().describe("边框色，如 #2f2f2f"),
        strokeWidth: z.number().optional().describe("边框/线宽（arrow 时同时决定箭头头大小：默认 2 → 头约 10px，调大一起变大）"),
        dash: z.array(z.number()).optional().describe("虚线描边模式（如 [8,4]）：辅助流/跳连/梯度回传/可选路径/逻辑阶段用，与实线主数据流区分"),
        rotation: z.number().optional().describe("旋转角度"),
        rx: z.number().optional().describe("圆角弧度（rect/rounded 矩形用，0=直角，如 8/16 圆角；logic 节点缺省自带圆角）"),
        fontSize: z.number().optional().describe("字号（text 类型用，建议 16~28）"),
        bold: z.boolean().optional().describe("是否加粗（text 类型用）"),
        italic: z.boolean().optional().describe("是否斜体（text 类型用）"),
        align: z.enum(["left", "center", "right"]).optional().describe("文字对齐（text 类型用，默认 center）"),
        fontFamily: z.string().optional().describe("字体（text 类型用，默认 Arial, Microsoft YaHei, sans-serif）"),
        shape: z.enum(["rect", "parallelogram", "diamond"]).optional().describe("逻辑节点外形（type=logic 用）：rect 矩形（默认，正方形用 width=height、长方形 width≠height）/ parallelogram 平行四边形（并行/过程流）/ diamond 菱形（决策/判断）"),
        head: z.enum(["none", "single", "double"]).optional().describe("箭头头部样式（type=arrow 时用：single 单箭头=默认 / double 两端箭头 / none 无箭头纯线）"),
        midPoints: z.array(z.object({ x: z.number(), y: z.number(), smooth: z.boolean().optional() })).optional().describe("箭头折点（type=arrow 用，相对起点偏移；smooth=true 平滑曲线折点，科研图折线箭头/辅助流用）"),
        points: z.array(z.object({ x: z.number(), y: z.number() })).optional().describe("点列（type=polyline 折线用世界坐标；type=pen 画笔手绘用连续点列，可自由画出符号/复杂结构图标，如 σ、∫、卷积核、残差块手绘示意；缺省为起点→终点两点）"),
      }),
      execute: (args) => draft.createElement(args),
    }),
    applyGraph: tool({
      description:
        "声明式一键绘制流程/结构图：只需声明节点（标题/正文/填充色）与节点间的连接关系，系统自动完成分层布局（对齐、等距、连线）。" +
        "节点自动创建为逻辑节点（圆角框 + 居中标题 + 自带 4 个箭头锚点），连线自动精确对接锚点。" +
        "流程图、架构图、数据管道等一切有明确节点+关系的图都优先用它，一次调用代替逐条 createElement + connectElements。" +
        "direction：TB 自上而下（默认）、LR 从左到右。布局超出画布时系统自动整体缩放（最低 0.5 倍）。" +
        "zones 分区容器（可选，科研图常用）：把一组节点封装进一个浅色虚线圆角框表示阶段/环境（如\"预训练阶段\"\"特征提取模块\"），" +
        "label 写分区名称，nodeIds 写该分区包含的节点 id，fill 用科研浅色调色板；有明确阶段/模块分组时务必使用，让图的分组语义一目了然。",
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
        zones: z.array(
          z.object({
            label: z.string().optional().describe("分区名称（阶段/环境名，如“预训练阶段”），显示在框内左上角"),
            nodeIds: z.array(z.string()).describe("该分区包含的节点 id（必须是 nodes 中声明的 id）"),
            fill: z.string().optional().describe("分区底色（科研浅色调色板，如 #eef4ff，可省略用默认）"),
          })
        ).optional().describe("分区容器（可选）：把一组节点封装为阶段/环境的浅色虚线圆角框，科研图分组语义用"),
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
        "数据必须是用户给出的原值，或常识范围内的合理数值（如“中国 GDP 2023 约 126 万亿元”），1~60 项，禁止编造离谱数据。" +
        "饼图数据项不宜超过 12 项；多系列（series 字段）用于柱状分组/折线多线对比；" +
        "折线/散点图数据点多时（如横坐标 30 个点）可传 xStep 控制 x 轴刻度标签间隔（如每 5 个分类标一个刻度，用户要求“每 N 年一个刻度”时传 N），系统自动稀疏化避免标签拥挤；" +
        "饼图可用 variant:\"hollow\" 生成空心（圆环）饼图；每条数据可用 color 指定图例/图形颜色（可省略自动配色）。" +
        "数据图表（含通用图示以外的数据可视化需求）一律优先用本工具。",
      inputSchema: z.object({
        type: z.enum(["bar", "line", "pie", "scatter"]).describe("图表类型：bar 柱状 / line 折线 / pie 饼图 / scatter 散点"),
        title: z.string().optional().describe("图表标题（应尽量提供）"),
        xLabel: z.string().optional().describe("x 轴名称"),
        yLabel: z.string().optional().describe("y 轴名称"),
        unit: z.string().optional().describe("数值单位（如“万元”“人”“%”）：饼图/柱状图等数据有明确单位时必须给出，显示在数值标签上（如 50万元 (25%)）"),
        showValues: z.boolean().optional().describe("饼图标签是否显示具体数值：缺省 false 只显示占比（如 25%）；true 时按规范格式显示数值+单位+占比（如 50万元 (25%)）。用户要求“只显示占比/比例”时保持缺省，要求“显示具体数据/数值”时传 true"),
        variant: z.string().optional().describe("图表变体：pie 支持 hollow（空心/圆环饼图），缺省实心"),
        xStep: z.number().optional().describe("x 轴刻度标签间隔：每隔几个分类显示一个刻度标签（如 5 = 每 5 个分类标一个，折线/散点数据点多或用户要求“每 N 年一个刻度”时用）"),
        data: z.array(
          z.object({
            label: z.string().describe("分类标签（x 轴类别，如“Q1”“2021”）"),
            value: z.number().describe("数值（非负）"),
            series: z.string().optional().describe("系列名（多系列对比时用，如“本店”“他店”）"),
            color: z.string().optional().describe("该条目的图例/图形颜色（如 #eef4ff，可省略自动配色）"),
          })
        ).describe("数据（1~60 项）"),
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
        dash: z.array(z.number()).optional().describe("虚线描边模式（如 [8,4]）：跳连/梯度回传/可选路径等辅助流用，与实线主数据流区分"),
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
          dash: z.array(z.number()).optional().describe("虚线描边模式（如 [8,4]）：辅助流/跳连/可选路径用"),
          rotation: z.number().optional(),
          rx: z.number().optional().describe("圆角弧度（rect/rounded 矩形用）"),
          flipH: z.boolean().optional().describe("水平镜像（绕元素中心翻转）"),
          flipV: z.boolean().optional().describe("垂直镜像（绕元素中心翻转）"),
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
          midPoints: z.array(z.object({ x: z.number(), y: z.number(), smooth: z.boolean().optional() })).optional().describe("箭头折点（相对起点偏移）"),
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
      description:
        "查看当前画布全貌：返回画布总览（现有内容范围 + 建议的空白起始位置）+ 全部元素明细（id、类型、位置、文字）。动手前必先调用——先纵观全画布，新增内容放在总览建议的空白区域，不要总从同一位置开始。",
      inputSchema: z.object({}),
      execute: () => draft.listElements(),
    }),
    readCanvas: tool({
      description:
        "读取其他画布的内容（跨画布参考/模仿）：输入画布名称，返回该画布上的全部元素摘要。当用户提到其他画布、或需要参考/模仿别的画布已有内容时使用；不会切换当前画布。引用其他画布内容时，对话中会自动显示「引用了…画布」标识。",
      inputSchema: z.object({
        canvasName: z.string().describe("要读取的画布名称（如“画布 1”“画布 2”）；输入前先看可用画布列表，用 listCanvases 获取"),
      }),
      execute: ({ canvasName }) => {
        const c = canvases.find((x) => x.name === canvasName || x.id === canvasName);
        if (!c) {
          const names = canvases.map((x) => x.name).join("、");
          return `未找到画布「${canvasName}」。当前可用画布：${names || "（无）"}。可用 listCanvases 查看画布列表。`;
        }
        onReferenced?.(c.name);
        const lines = c.elements.map((e, i) => {
          const label = "text" in e && e.text ? ` 文字「${e.text}」` : "";
          return `${i + 1}. ${e.type} @(${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.width)}×${Math.round(e.height)}${label}`;
        });
        return `画布「${c.name}」共 ${c.elements.length} 个元素：\n${lines.join("\n") || "（空画布）"}`;
      },
    }),
    listCanvases: tool({
      description: "查看所有画布的名称列表（跨画布参考/模仿前先调用，再按名称 readCanvas 读取具体内容）。",
      inputSchema: z.object({}),
      execute: () => (canvases.length ? `可用画布：\n${canvases.map((c) => `- ${c.name}`).join("\n")}` : "（无其他画布）"),
    }),
    askUser: tool({
      description:
        "对需求不确定时向用户提问澄清（一次只问一个问题，禁止连问）：当用户需求缺少关键信息、无法确定图种/主题/数据/布局时使用，例如「图表没给数据也没说主题」「流程缺关键环节」「要对比哪些项」。调用后本轮立即停止绘制，等待用户回答后再继续；需求已明确时禁止提问。**必须**提供 2~5 个可点击选项（options）供用户直接点选——所有可选项（方向列表、图种、主题候选等）都必须放进 options 渲染成按钮，禁止把选项写成普通文字回复；只有问题完全不适用枚举时才允许不给 options。",
      inputSchema: z.object({
        question: z.string().describe("要问用户的问题（具体、可回答，只问一个问题）"),
        options: z.array(z.string()).optional().describe("可点击选项按钮（2~5 个，必须提供；用户点选即作为回答），如 [\"柱状图\", \"折线图\", \"饼图\"]"),
      }),
      execute: () => "已向用户提问，本轮停止绘制，等待回答",
    }),
    searchWeb: tool({
      description:
        "联网搜索权威数据：用户没给数据但图表需要具体数字（统计数据/年份/比例）时使用，优先政府、官方统计、学术期刊、国际组织来源。每次生成最多搜 2 次，只取必要数字；搜索失败时改用常识范围合理估算并在收尾明示估算。需要设置页配置 Tavily API Key。",
      inputSchema: z.object({ query: z.string().describe("搜索查询，如「2023 年中国 GDP 万亿元」") }),
      execute: async ({ query }) => {
        try {
          const results = await searchWeb(tavilyApiKey ?? "", query);
          return `搜索结果（仅作数据参考，绘图时用其中数字并在收尾给出来源）：\n${formatSearchResults(results)}`;
        } catch (err) {
          return `搜索失败（${err instanceof Error ? err.message : String(err)}）。请改用常识范围合理估算，并在收尾明示「该数值为估算，未查到权威来源」。`;
        }
      },
    }),
    clearCanvas: tool({
      description: "清空当前画布上的全部内容（在同一张画布上重画）。仅当用户明确要求清空画布或重画时才使用；会弹确认框，用户允许后才执行；调用后本轮停止绘制，等用户确认清空后再继续画新内容。注意：AI 不会切换/新建画布（画布与 AI 隔离），用户要求\"新建画布/新开一张/换一张\"时告知用户通过界面左上角的新建画布按钮操作，AI 在当前画布继续。",
      inputSchema: z.object({}),
      execute: () => draft.clear(),
    }),
  };
}
