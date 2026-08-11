import { runAgent } from "@/lib/ai/agent";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { CanvasSnapshot } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  const { messages, canvas, apiKey, baseURL, model, tavilyApiKey, modes, canvases } = body as {
    messages: { role: "user" | "assistant"; content: string }[];
    canvas: CanvasDocument;
    apiKey: string;
    baseURL: string;
    model: string;
    tavilyApiKey?: string;
    modes?: ("sci" | "mindmap" | "chart")[] | null;
    canvases?: CanvasSnapshot[];
  };
  if (!apiKey) {
    return Response.json({ error: "未配置 API Key，请先到设置页填写" }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      try {
        await runAgent({ messages, canvas, apiKey, baseURL, model, tavilyApiKey, modes, canvases, onEvent: send });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
