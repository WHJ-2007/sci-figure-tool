import { getConfirmSession, markResolved, markApplied, isApplied, isSessionComplete } from "@/lib/ai/confirmStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // req.json() 容错：请求体非 JSON 返回 400 而非 500
  const body = await req.json().catch(() => null);
  const { sessionId, approvals } = (body ?? {}) as {
    sessionId?: string;
    approvals?: { id?: string; approved?: boolean }[];
  };
  if (typeof sessionId !== "string" || !Array.isArray(approvals)) {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }
  const draft = getConfirmSession(sessionId);
  if (!draft) return Response.json({ error: "确认会话已过期，请重新生成" }, { status: 404 });
  // 只认会话内真实挂起项的 id：伪造 id 不得计入 resolved，防虚增 resolved 导致会话被提前删除
  const validIds = new Set(draft.pending.map((p) => p.id));
  // 这批复挂起项用户已表态（含取消）：多挂起项逐条确认时会话保留，全部表态后由 isSessionComplete 删除
  const newlyResolved = markResolved(
    sessionId,
    approvals
      .filter((a): a is { id: string; approved?: boolean } => typeof a.id === "string" && validIds.has(a.id))
      .map((a) => a.id)
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      for (const p of draft.pending) {
        const a = approvals.find((x) => x.id === p.id);
        if (!a?.approved) continue;
        // 幂等：先前批次已执行过（重试/重复提交）不再 apply，防 new-canvas 二次触发
        if (isApplied(sessionId, p.id)) continue;
        markApplied(sessionId, p.id);
        p.apply();
        if (draft.takeNewCanvasFlag()) send({ type: "new-canvas" });
        send({ type: "snapshot", canvas: draft.serialize(), touched: draft.takeTouched() });
      }
      send({
        type: "confirm-done",
        results: draft.pending.map((p) => ({
          id: p.id,
          description: p.description,
          approved: !!approvals.find((x) => x.id === p.id)?.approved,
        })),
      });
      controller.close();
      // 全部挂起项都已表态 → 删除会话（完成全部表态的那一批不删：幂等重试需会话存活应答，
      // 纯重复提交批才删除；未表态的残留项由 TTL sweep 15 分钟兜底作废）
      isSessionComplete(sessionId, draft.pending.length, newlyResolved);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
