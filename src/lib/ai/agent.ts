import { generateText, stepCountIs } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CanvasDocument } from "@/lib/canvas/types";
import { DraftCanvas } from "./draft";
import { buildTools } from "./tools";
import { SYSTEM_PROMPT } from "./prompt";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "progress"; activity: string[] }
  | { type: "complete"; canvas: CanvasDocument; summary: string }
  | { type: "error"; message: string };

export async function runAgent(opts: {
  messages: ChatMessage[];
  canvas: CanvasDocument;
  apiKey: string;
  baseURL: string;
  model: string;
  onEvent: (ev: AgentEvent) => void;
}): Promise<string> {
  const provider = createOpenAICompatible({ baseURL: opts.baseURL, apiKey: opts.apiKey, name: "deepseek" });
  const draft = new DraftCanvas(opts.canvas.elements);
  const result = await generateText({
    model: provider(opts.model),
    system: SYSTEM_PROMPT,
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
