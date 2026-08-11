import { generateText, stepCountIs, hasToolCall } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CanvasDocument } from "@/lib/canvas/types";
import { DraftCanvas } from "./draft";
import { buildTools, type CanvasSnapshot } from "./tools";
import { buildSystemPrompt, type AIMode } from "./prompt";
import { setConfirmSession } from "./confirmStore";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "status"; phase: "thinking" | "drawing" | "checking"; message: string }
  | { type: "progress"; activity: string[] }
  | { type: "snapshot"; canvas: CanvasDocument; touched: string[] }
  | { type: "new-canvas" }
  | { type: "complete"; canvas: CanvasDocument; summary: string; touched: string[] }
  | { type: "confirm-request"; sessionId: string; summary: string; pending: { id: string; description: string }[] }
  | { type: "question"; question: string; options?: string[] }
  | { type: "referenced"; canvasName: string }
  | { type: "error"; message: string };

export async function runAgent(opts: {
  messages: ChatMessage[];
  canvas: CanvasDocument;
  apiKey: string;
  baseURL: string;
  model: string;
  tavilyApiKey?: string;
  modes?: AIMode[] | null;
  // 其他画布摘要：AI 可跨画布读取/参考（画布与 AI 隔离——绝不切换当前画布）
  canvases?: CanvasSnapshot[];
  onEvent: (ev: AgentEvent) => void;
}): Promise<string> {
  const provider = createOpenAICompatible({ baseURL: opts.baseURL, apiKey: opts.apiKey, name: "deepseek" });
  // 首个事件必须在模型返回前发出，让前端立即建立“AI 已接手”的反馈，而不是空等首个工具调用。
  opts.onEvent({ type: "status", phase: "thinking", message: "正在理解需求、识别图类型并检查当前画布…" });
  // onChange 闭包引用 draft 自身（构造后才会被调用），用 let 声明避开 TDZ
  let draft: DraftCanvas;
  draft = new DraftCanvas(opts.canvas.elements, opts.canvas.charts, () => {
    if (draft.takeNewCanvasFlag()) opts.onEvent({ type: "new-canvas" });
    // 每次确定性操作完成就立即发活动与快照；不再等整轮 tool step 结束后一次性刷新。
    const activity = draft.flushActivity();
    if (activity.length) opts.onEvent({ type: "progress", activity });
    opts.onEvent({ type: "snapshot", canvas: draft.serialize(), touched: draft.takeTouched() });
  });
  const tools = buildTools(draft, opts.tavilyApiKey, opts.canvases, (name) => opts.onEvent({ type: "referenced", canvasName: name }));
  const toolStatus: Record<string, string> = {
    applyCNNArchitecture: "正在构建 CNN 特征图层级、局部感受野与分类概率…",
    listElements: "正在读取画布结构并寻找可用空间…",
    listCanvases: "正在查看可参考的画布…",
    readCanvas: "正在提取参考画布的结构特征…",
    applyScientificDiagram: "正在编排科研图的功能分区、专业符号与关系…",
    applyPenMotif: "正在用画笔构造可编辑的科研语义图元…",
    auditScientificFigure: "正在用坐标、边界和拓扑数据审查科研图质量…",
    correctScientificFigure: "正在按审查结果修复遮挡、越界和连线路径…",
    applyMechanism: "正在建立空间区室与机制关系…",
    applyGraph: "正在计算层级、间距与连线路径…",
    applyMindMap: "正在展开主题层级与分支结构…",
    applyChart: "正在计算坐标、刻度、图例与数据标记…",
    createElement: "正在绘制画布元素…",
    connectElements: "正在建立语义连接并校准锚点…",
    updateElement: "正在调整位置、样式或文字…",
    deleteElement: "正在移除不再需要的元素…",
    searchWeb: "正在核对数据来源…",
    askUser: "需要补充一个关键信息…",
    clearCanvas: "正在准备清理当前画布…",
  };
  // 工具开始前先发人类可读状态；工具内部的每个变更随后通过 progress + snapshot 连续回传。
  for (const [name, candidate] of Object.entries(tools)) {
    const executable = candidate as { execute?: (...args: unknown[]) => unknown };
    if (!executable.execute) continue;
    const original = executable.execute.bind(candidate);
    executable.execute = async (...args: unknown[]) => {
      opts.onEvent({ type: "status", phase: name === "listElements" || name === "readCanvas" ? "thinking" : "drawing", message: toolStatus[name] ?? "正在执行绘图操作…" });
      return await original(...args);
    };
  }
  // A3 提问澄清：AI 调用 askUser 工具 → 挂起主生成发 question 事件，等用户回答后前端重新发起
  const result = await generateText({
    model: provider(opts.model),
    system: buildSystemPrompt(opts.modes?.length ? opts.modes : undefined),
    messages: opts.messages,
    tools,
    // AI SDK v5 已移除 maxSteps，改用 stopWhen 限制多轮工具调用步数（默认只跑 1 步）
    stopWhen: [hasToolCall("askUser"), stepCountIs(20)],
    onStepFinish: ({ toolCalls }) => {
      const activity = draft.flushActivity();
      if (activity.length) opts.onEvent({ type: "progress", activity });
      if ((toolCalls?.length ?? 0) > 0) {
        opts.onEvent({ type: "status", phase: "checking", message: "正在检查刚完成的结构、连线和文字可读性…" });
      }
    },
  });
  // 从结果步骤中提取 askUser 问题与选项（stopWhen 已在此类调用后停止）
  let askQuestion: string | null = null;
  let askOptions: string[] | undefined;
  for (const s of result.steps ?? []) {
    const call = s.toolCalls?.find((c) => c.toolName === "askUser");
    if (call) {
      const input = call.input as { question?: string; options?: string[] } | undefined;
      askQuestion = input?.question ?? "";
      askOptions = input?.options;
      break;
    }
  }
  const pending = draft.pending;
  // 不依赖模型是否记得调用审查工具：只要检测到科研图，就在交付前强制执行
  // Reviewer → Corrector 门禁。普通文本模型也能得到稳定、可复现的结构质量保障。
  if (askQuestion === null && draft.hasScientificFigure()) {
    opts.onEvent({ type: "status", phase: "checking", message: "正在执行最终科研质量门禁，并自动修复可确定的问题…" });
    const gate = draft.correctScientificFigure(2);
    opts.onEvent({
      type: "progress",
      activity: [`质量门禁${gate.after.passed ? "通过" : "未完全通过"}：几何 ${Math.round(gate.after.scores.geometry * 100)}、连线 ${Math.round(gate.after.scores.connectorClarity * 100)}、排版 ${Math.round(gate.after.scores.typographyColor * 100)}${gate.corrections.length ? `，自动修复 ${gate.corrections.length} 项` : ""}`],
    });
  }
  if (askQuestion !== null) {
    // 提问优先：askUser 后 AI 若已画了元素也不发 snapshot，全部丢弃（前端恢复生成前基线）
    opts.onEvent({ type: "question", question: askQuestion, options: askOptions });
  } else if (pending.length > 0) {
    // 挂起阶段结束主生成：解除 onChange（旧流已关闭，确认阶段由 /api/chat/confirm 独立回发）
    draft.setOnChange(undefined);
    const sessionId = crypto.randomUUID();
    setConfirmSession(sessionId, draft);
    opts.onEvent({
      type: "confirm-request",
      sessionId,
      summary: result.text,
      pending: pending.map((p) => ({ id: p.id, description: p.description })),
    });
  } else {
    opts.onEvent({ type: "complete", canvas: draft.serialize(), summary: result.text, touched: draft.takeTouched() });
  }
  return result.text;
}
