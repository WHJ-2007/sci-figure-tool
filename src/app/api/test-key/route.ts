import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

export async function POST(req: Request) {
  const { apiKey, baseURL, model } = (await req.json()) as { apiKey: string; baseURL: string; model: string };
  if (!apiKey) {
    return Response.json({ ok: false, error: "未填写 API Key" }, { status: 400 });
  }
  try {
    const provider = createOpenAICompatible({ baseURL, apiKey, name: "deepseek" });
    const { text } = await generateText({
      model: provider(model),
      prompt: "回复 OK",
      maxOutputTokens: 10,
    });
    return Response.json({ ok: true, text });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
