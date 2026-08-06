import { generateText, stepCountIs } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CanvasDocument } from "@/lib/canvas/types";
import { DraftCanvas } from "./draft";
import { buildTools } from "./tools";
import { buildSystemPrompt, type AIMode } from "./prompt";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "progress"; activity: string[] }
  | { type: "snapshot"; canvas: CanvasDocument }
  | { type: "new-canvas" }
  | { type: "complete"; canvas: CanvasDocument; summary: string }
  | { type: "error"; message: string };

export async function runAgent(opts: {
  messages: ChatMessage[];
  canvas: CanvasDocument;
  apiKey: string;
  baseURL: string;
  model: string;
  mode?: "auto" | AIMode;
  onEvent: (ev: AgentEvent) => void;
}): Promise<string> {
  const provider = createOpenAICompatible({ baseURL: opts.baseURL, apiKey: opts.apiKey, name: "deepseek" });
  // onChange 闭包引用 draft 自身（构造后才会被调用），用 let 声明避开 TDZ
  let draft: DraftCanvas;
  draft = new DraftCanvas(opts.canvas.elements, () => {
    if (draft.takeNewCanvasFlag()) opts.onEvent({ type: "new-canvas" });
    opts.onEvent({ type: "snapshot", canvas: draft.serialize() });
  });
  const result = await generateText({
    model: provider(opts.model),
    system: buildSystemPrompt(opts.mode === "auto" || opts.mode == null ? undefined : opts.mode),
    messages: opts.messages,
    tools: buildTools(draft),
    // AI SDK v5 已移除 maxSteps，改用 stopWhen 限制多轮工具调用步数（默认只跑 1 步）
    stopWhen: stepCountIs(20),
    onStepFinish: () => {
      const activity = draft.flushActivity();
      if (activity.length) opts.onEvent({ type: "progress", activity });
    },
  });
  opts.onEvent({ type: "complete", canvas: draft.serialize(), summary: result.text });
  return result.text;
}
