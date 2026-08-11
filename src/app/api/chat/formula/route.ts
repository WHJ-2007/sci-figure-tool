import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 公式助手系统提示：只输出公式本身（LaTeX 或 Unicode），不跑画布工具。
// 结果以「采用」按钮插入公式输入框，或手动复制。
const FORMULA_SYSTEM = `你是科研制图工具里的公式助手。用户会用自然语言描述想要什么公式或符号（例如"求和符号，上面 i=1 下面 n"、"希格斯玻色子质量公式"、"矩阵 A 的转置"）。
你的任务是：
1. 直接给出公式，用 LaTeX 或 Unicode 都行（本工具两者都支持，LaTeX 会自动转 Unicode 渲染），放在代码块 \`\`\` 内。
2. 如果用户没说，默认给出 LaTeX 写法。
3. 可以在代码块外加一两句简短说明（可选），但公式必须放在代码块里，便于一键采用。
4. 公式要完整可用：分数用 \\frac{}{}、上下标用 ^{}/_{}、求和用 \\sum_{}^{}、积分用 \\int_{}^{}，其他特殊符号用对应 LaTeX 命令。`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体无效" }, { status: 400 });
  }
  const { messages, apiKey, baseURL, model } = body as {
    messages: { role: "user" | "assistant"; content: string }[];
    apiKey: string;
    baseURL: string;
    model: string;
  };
  if (!apiKey) {
    return Response.json({ error: "未配置 API Key，请先到设置页填写" }, { status: 400 });
  }
  const provider = createOpenAICompatible({ baseURL, apiKey, name: "deepseek" });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      try {
        const result = streamText({
          model: provider(model),
          system: FORMULA_SYSTEM,
          messages,
        });
        for await (const delta of result.textStream) {
          send({ type: "delta", text: delta });
        }
        send({ type: "done", text: await result.text });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
