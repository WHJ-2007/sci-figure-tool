import { runAgent } from "@/lib/ai/agent";
import type { CanvasDocument } from "@/lib/canvas/types";
import type { CanvasSnapshot } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 心跳间隔：模型整轮思考/网络慢速期间可能长时间无事件，定期发轻量 heartbeat 让前端看门狗感知连接存活，
// 避免「模型慢 ≠ 连接死」被前端 120 秒无事件逻辑误杀（generateText 是整轮响应返回后才发下一个事件）
const HEARTBEAT_MS = 15_000;
// 硬上限：整轮生成超过该时长强制中止（防上游接口悬挂导致前端永远等不到结束事件）
const HARD_CAP_MS = 10 * 60_000;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  const { messages, canvas, apiKey, baseURL, model, modes, canvases } = body as {
    messages: { role: "user" | "assistant"; content: string }[];
    canvas: CanvasDocument;
    apiKey: string;
    baseURL: string;
    model: string;
    modes?: ("sci" | "mindmap" | "chart")[] | null;
    canvases?: CanvasSnapshot[];
  };
  if (!apiKey) {
    return Response.json({ error: "未配置 API Key，请先到设置页填写" }, { status: 400 });
  }
  const encoder = new TextEncoder();
  // 客户端断开（fetch abort / reader.cancel / 页面关闭）时中止上游模型调用，避免请求悬挂空耗额度
  const abort = new AbortController();
  const abortUpstream = () => abort.abort(req.signal.reason);
  if (req.signal.aborted) abortUpstream();
  else req.signal.addEventListener("abort", abortUpstream, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          // 流已关闭（客户端断开）则静默忽略，不再尝试入队
        }
      };
      // 心跳保活：generateText 等模型响应期间无任何事件，定期发 heartbeat 刷新前端 lastEvent
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);
      // 硬上限：超过总时长强制中止并明确提示（心跳只是「连接存活」，不能替代「生成有结果」）
      const cap = setTimeout(() => {
        abort.abort();
        send({ type: "error", message: "生成超时：长时间未收到响应，已中断本次生成，请重试" });
      }, HARD_CAP_MS);
      try {
        await runAgent({
          messages,
          canvas,
          apiKey,
          baseURL,
          model,
          modes,
          canvases,
          onEvent: send,
          signal: abort.signal,
        });
      } catch (err) {
        // 主动中止（硬上限/客户端断开）时不重复报错——超时提示已由 cap 发送；其余错误原样回传
        if (!abort.signal.aborted) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        req.signal.removeEventListener("abort", abortUpstream);
        clearInterval(heartbeat);
        clearTimeout(cap);
        try {
          controller.close();
        } catch {
          // 客户端已断开导致 close 抛错则忽略
        }
      }
    },
    cancel() {
      // 客户端断开连接 → 中止上游模型调用，释放资源
      abort.abort();
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
