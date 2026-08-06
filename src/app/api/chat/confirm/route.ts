import { getConfirmSession, deleteConfirmSession } from "@/lib/ai/confirmStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { sessionId, approvals } = (await req.json()) as {
    sessionId: string;
    approvals: { id: string; approved: boolean }[];
  };
  const draft = getConfirmSession(sessionId);
  if (!draft) return Response.json({ error: "确认会话已过期，请重新生成" }, { status: 404 });
  deleteConfirmSession(sessionId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      for (const p of draft.pending) {
        const a = approvals.find((x) => x.id === p.id);
        if (!a?.approved) continue;
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
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
