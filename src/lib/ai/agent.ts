import { generateText, stepCountIs, hasToolCall } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CanvasDocument } from "@/lib/canvas/types";
import { DraftCanvas } from "./draft";
import { buildTools } from "./tools";
import { buildSystemPrompt, type AIMode } from "./prompt";
import { setConfirmSession } from "./confirmStore";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "progress"; activity: string[] }
  | { type: "snapshot"; canvas: CanvasDocument; touched: string[] }
  | { type: "new-canvas" }
  | { type: "complete"; canvas: CanvasDocument; summary: string; touched: string[] }
  | { type: "confirm-request"; sessionId: string; summary: string; pending: { id: string; description: string }[] }
  | { type: "question"; question: string }
  | { type: "error"; message: string };

export async function runAgent(opts: {
  messages: ChatMessage[];
  canvas: CanvasDocument;
  apiKey: string;
  baseURL: string;
  model: string;
  modes?: AIMode[] | null;
  onEvent: (ev: AgentEvent) => void;
}): Promise<string> {
  const provider = createOpenAICompatible({ baseURL: opts.baseURL, apiKey: opts.apiKey, name: "deepseek" });
  // onChange 闭包引用 draft 自身（构造后才会被调用），用 let 声明避开 TDZ
  let draft: DraftCanvas;
  draft = new DraftCanvas(opts.canvas.elements, opts.canvas.charts, () => {
    if (draft.takeNewCanvasFlag()) opts.onEvent({ type: "new-canvas" });
    opts.onEvent({ type: "snapshot", canvas: draft.serialize(), touched: draft.takeTouched() });
  });
  // A3 提问澄清：AI 调用 askUser 工具 → 挂起主生成发 question 事件，等用户回答后前端重新发起
  const result = await generateText({
    model: provider(opts.model),
    system: buildSystemPrompt(opts.modes?.length ? opts.modes : undefined),
    messages: opts.messages,
    tools: buildTools(draft),
    // AI SDK v5 已移除 maxSteps，改用 stopWhen 限制多轮工具调用步数（默认只跑 1 步）
    stopWhen: [hasToolCall("askUser"), stepCountIs(20)],
    onStepFinish: () => {
      const activity = draft.flushActivity();
      if (activity.length) opts.onEvent({ type: "progress", activity });
    },
  });
  // 从结果步骤中提取 askUser 问题（stopWhen 已在此类调用后停止）
  let askQuestion: string | null = null;
  for (const s of result.steps ?? []) {
    const call = s.toolCalls?.find((c) => c.toolName === "askUser");
    if (call) {
      askQuestion = (call.input as { question?: string } | undefined)?.question ?? "";
      break;
    }
  }
  const pending = draft.pending;
  if (askQuestion !== null) {
    // 提问优先：askUser 后 AI 若已画了元素也不发 snapshot，全部丢弃（前端恢复生成前基线）
    opts.onEvent({ type: "question", question: askQuestion });
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
