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
        scientificRole: z.enum(["title", "container", "node", "node-label", "connector", "annotation", "legend", "decoration"]).optional().describe("科研图补充元素的机器可读角色；补画节点/容器/注释时必须准确填写，供结构化质量门禁审查"),
        scientificId: z.string().optional().describe("科研语义对象稳定 id；补画科研节点时填写"),
        scientificRegionId: z.string().optional().describe("所属科研分区 id；补画分区内对象时填写"),
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
    applyCNNArchitecture: tool({
      description:
        "绘制可编辑的论文级 CNN 结构详解图。只要用户提到 CNN、卷积神经网络、卷积层或池化层，必须优先使用本工具，禁止退化成一排流程框。" +
        "系统会自动绘制输入像素图、逐级收缩且加深的特征图堆叠、卷积/池化视觉区分、局部感受野与 3×3 卷积核、Dense 神经元和 Softmax 概率条，并执行结构质量门禁。即使参数不完整也可省略 stages 使用高质量默认结构。",
      inputSchema: z.object({
        title: z.string().optional().describe("图标题；省略时使用准确的 CNN 解释型标题"),
        subtitle: z.string().optional().describe("一句话核心主张，不写泛泛描述"),
        inputLabel: z.string().optional().describe("输入数据名称，如 RGB 图像或灰度图像"),
        inputShape: z.string().optional().describe("输入张量尺寸，如 32 × 32 × 3"),
        stages: z.array(z.object({
          label: z.string().describe("层名称，如 Conv 1、MaxPool 1"),
          operation: z.enum(["convolution", "pooling", "activation", "normalization"]).describe("决定特征图的视觉编码"),
          channels: z.union([z.number(), z.string()]).optional().describe("输出通道数"),
          spatial: z.string().optional().describe("空间尺寸，如 28×28"),
          kernel: z.string().optional().describe("卷积核或池化窗口，如 3×3"),
          detail: z.string().optional().describe("该层学到或保留的模式，控制在 12 字内"),
        })).max(5).optional().describe("特征提取阶段；信息不足时整体省略，系统使用可靠默认值"),
        denseUnits: z.union([z.number(), z.string()]).optional().describe("全连接层单元数，如 128"),
        classes: z.array(z.string()).max(5).optional().describe("示例分类标签，最多 5 个"),
        notes: z.array(z.string()).max(3).optional().describe("与主图直接对应的三条读图要点"),
      }),
      execute: (args) => draft.applyCNNArchitecture(args),
    }),
    applyScientificDiagram: tool({
      description:
        "面向论文、开题报告和技术报告的通用科研制图引擎，重点覆盖人工智能、机器学习、网络安全和大数据。模型只声明领域语义，系统自动完成专业符号、功能分区、自适应折行、节点避碰、正交跨行连线、文字换行、图例和紧凑注释带。" +
        "AI/机器学习的模型架构、训练/推理流程、数据管线、实验方法图；网络安全的攻防拓扑、信任边界、检测与响应链；大数据的采集—消息—计算—存储—服务架构，都必须优先使用本工具。" +
        "只有非常简单的通用流程图才使用 applyGraph；细胞/分子机制图继续使用 applyMechanism。",
      inputSchema: z.object({
        title: z.string().describe("准确、简洁的图标题"),
        subtitle: z.string().optional().describe("可选副标题：任务、数据集、训练/推理场景或图的核心结论"),
        domain: z.enum(["ai", "machine-learning", "cybersecurity", "big-data", "general"]).optional().describe("研究领域，决定主色和视觉编码"),
        layout: z.enum(["pipeline", "layered-lr", "layered-tb"]).optional().describe("pipeline=长流程自动蛇形折行；layered-lr=从左到右的架构/数据流；layered-tb=自上而下的层级/拓扑"),
        groups: z.array(z.object({
          id: z.string().describe("分组唯一 id，供节点引用"),
          label: z.string().describe("功能阶段或系统边界名称"),
          semantic: z.enum(["input", "processing", "model", "storage", "security", "evaluation", "output", "control"]).optional().describe("分组语义，决定背景色"),
          fill: z.string().optional().describe("可选自定义浅色背景"),
        })).optional().describe("功能分区/阶段/信任域。图中存在训练阶段、网络区域、数据层级或平台层时应显式声明"),
        nodes: z.array(z.object({
          id: z.string().describe("节点唯一 id，供边和注释引用"),
          text: z.string().describe("节点主标签；使用领域规范术语，避免“模块1”之类空名"),
          role: z.enum(["data", "tensor", "process", "model", "neural-network", "storage", "service", "decision", "metric", "user", "network", "threat", "defense", "output"]).describe("节点的科研语义角色，决定专业符号"),
          group: z.string().optional().describe("所属分组 id"),
          detail: z.string().optional().describe("必要的结构/参数/方法说明，最多 2 个短行、每行建议不超过 14 字；不要写长段落"),
          badge: z.string().optional().describe("简短状态或阶段徽标，如 Train、Frozen、Online、TLS、L3"),
          fill: z.string().optional().describe("可选自定义填充色；一般让系统按角色决定"),
        })),
        edges: z.array(z.object({
          from: z.string(), to: z.string(),
          relation: z.enum(["data-flow", "control-flow", "dependency", "feedback", "attack", "defense", "trust", "association"]).optional().describe("关系语义，决定颜色、虚实和箭头；默认 data-flow"),
          label: z.string().optional().describe("边上的短标签（建议不超过 8 字），如 Batch、Gradient、Alert、Kafka、TLS；不确定时省略"),
        })),
        notes: z.array(z.object({
          text: z.string().describe("一句话注释、约束、贡献点或风险说明"),
          target: z.string().optional().describe("可选目标节点 id"),
          tone: z.enum(["neutral", "positive", "warning", "critical"]).optional(),
        })).optional().describe("少量高价值注释；不要把正文塞进图中"),
      }),
      execute: (args) => draft.applyScientificDiagram(args),
    }),
    applyPenMotif: tool({
      description:
        "用可编辑画笔笔迹与基础形状组合科研语义图元，为结构图增加更灵活、精细的视觉表达。文本模型只需选择语义 kind 和边界框，系统会把归一化模板转换成稳定点列，避免盲猜像素坐标。" +
        "适合在 applyScientificDiagram 主结构完成后加入 1~2 个高信息密度视觉图元：神经网络、特征图、注意力矩阵、模型芯片、数据流、云、服务器集群、安全盾锁或 Agent 循环。不能用它堆无意义装饰，也不能代替主流程节点和语义连线。" +
        "custom 允许提供归一化 strokes（每个点 x/y 为 0~1），用于模板无法表达的论文专用轮廓；仍会被限制在给定边界框内。",
      inputSchema: z.object({
        kind: z.enum(["neural-network", "feature-map", "shield-lock", "data-stream", "cloud", "server-cluster", "attention", "model-chip", "agent-loop", "custom"]).describe("科研语义图元类型"),
        x: z.number().describe("图元边界框左上角 x"),
        y: z.number().describe("图元边界框左上角 y"),
        width: z.number().positive().describe("图元宽度，建议 90~240"),
        height: z.number().positive().describe("图元高度，建议 70~180"),
        stroke: z.string().optional().describe("主线色，默认深蓝灰"),
        accent: z.string().optional().describe("强调色，应与科研图主色一致"),
        label: z.string().optional().describe("可选短标签，避免重复主节点已有文字"),
        scientificId: z.string().optional().describe("该图元表达的科研语义对象 id"),
        regionId: z.string().optional().describe("所属分区 id"),
        strokes: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).describe("归一化点"))).optional().describe("仅 custom 使用：1~16 条归一化笔迹，每条点坐标限定 0~1"),
      }),
      execute: (args) => draft.applyPenMotif(args),
    }),
    auditScientificFigure: tool({
      description:
        "对当前科研图执行无需视觉模型的确定性质量审查。返回拓扑、可编辑性、几何、间距、连线清晰度、字体配色、裁切遮挡的 0~1 分数，以及每个问题的对象 id、数值证据、修复动作和验收条件。" +
        "用 createElement/updateElement 做过科研图补充或微调后必须调用；只有 passed=true 才能宣称结构与版式检查通过。",
      inputSchema: z.object({}),
      execute: () => draft.auditScientificFigure(),
    }),
    correctScientificFigure: tool({
      description:
        "按科研质量报告执行最小对象级自动纠错：处理越界、节点遮挡、文字装不下和连线穿过节点，并在每轮后重新审查。不会把图压成图片。",
      inputSchema: z.object({
        maxIterations: z.number().int().min(1).max(4).optional().describe("审查—纠错最大轮数，默认 2"),
      }),
      execute: ({ maxIterations }) => draft.correctScientificFigure(maxIterations),
    }),
    applyMechanism: tool({
      description:
        "声明式一键绘制生物医学机制图/细胞信号通路图。与普通 applyGraph 不同，本工具按真实空间区室组织画面，自动绘制细胞外、双层细胞膜、胞质、细胞核/细胞器背景，并用稳定视觉符号区分配体、跨膜受体、蛋白、激酶、复合体、小分子、基因和表型输出。" +
        "关系支持 activation 激活（蓝色箭头）、inhibition 抑制（红色 T 端）、binding 结合（双向线）、translocation 转位（紫色虚线）和 indirect 间接作用（灰色虚线）。" +
        "用户要求细胞机制、分子机制、信号通路、受体通路、调控网络或出现 EGFR/MAPK/PI3K/AKT 等生物医学实体时，必须优先使用本工具，禁止用 applyGraph 画成一排流程框。",
      inputSchema: z.object({
        title: z.string().optional().describe("图标题，如“EGFR–MAPK 信号转导机制”"),
        compartments: z.array(z.object({
          id: z.string().describe("区室唯一 id，供节点引用"),
          label: z.string().describe("区室显示名，如“胞外空间”“细胞膜”“细胞质”“细胞核”"),
          kind: z.enum(["extracellular", "membrane", "cytoplasm", "nucleus", "organelle", "custom"]).optional().describe("区室类型，决定背景和膜结构"),
          fill: z.string().optional().describe("可选自定义浅色背景"),
        })).describe("按从上到下的真实空间顺序声明区室"),
        nodes: z.array(z.object({
          id: z.string().describe("节点唯一 id，供关系引用"),
          text: z.string().describe("实体名称，保留规范蛋白/基因大小写"),
          compartment: z.string().describe("节点所在区室 id"),
          role: z.enum(["ligand", "receptor", "protein", "kinase", "complex", "small-molecule", "gene", "output"]).optional().describe("生物学角色，决定视觉符号"),
          detail: z.string().optional().describe("必要的简短机制说明；不要堆砌长句"),
          badge: z.string().optional().describe("状态徽标，如 P、Ub、Ac；仅有证据时使用"),
          fill: z.string().optional().describe("可选自定义填充色"),
        })),
        edges: z.array(z.object({
          from: z.string(),
          to: z.string(),
          relation: z.enum(["activation", "inhibition", "binding", "translocation", "indirect"]).optional().describe("作用类型，默认 activation"),
          label: z.string().optional().describe("短机制标注，如“磷酸化”“二聚化”；不确定时省略"),
        })).describe("机制关系，方向从 from 指向 to"),
      }),
      execute: (args) => draft.applyMechanism(args),
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
