import { describe, it, expect } from "vitest";
import { POST } from "./route";
import { setConfirmSession, getConfirmSession } from "@/lib/ai/confirmStore";
import { DraftCanvas } from "@/lib/ai/draft";
import { makeElement } from "@/lib/canvas/elements";

// 会话保活/幂等核心逻辑的 route 级覆盖：现有 UI 测试用纯 mock 事件流，
// 不经过 confirmStore 与 route，变异（如删掉 isSessionComplete 的删除）不会变红。

type RouteEvent =
  | { type: "new-canvas" }
  | { type: "snapshot"; canvas: { width: number; height: number; elements: unknown[] }; touched: string[] }
  | { type: "confirm-done"; results: { id: string; description: string; approved: boolean }[] };

function mockReq(body: unknown): Request {
  return new Request("http://localhost/api/chat/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readEvents(res: Response): Promise<RouteEvent[]> {
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RouteEvent);
}

describe("POST /api/chat/confirm", () => {
  // 生产上挂起来源只有 newCanvas（元素删除/清空已直接执行），多挂起语义测试需注入第二个挂起项
  function injectPending(d: DraftCanvas, id: string, description: string, apply: () => void) {
    (d as unknown as { pendingConfirms: { id: string; description: string; apply: () => void }[] }).pendingConfirms.push({ id, description, apply });
  }

  it("多挂起项分两批确认：首批确认后会话保留，次批补全后会话删除", async () => {
    const elA = makeElement("rect", 0, 0, 100, 60, { id: "a1" });
    const elB = makeElement("ellipse", 200, 200, 40, 40, { id: "b1" });
    const d = new DraftCanvas([elA, elB]);
    d.newCanvas();
    injectPending(d, "b1", "删除「椭圆」", () => d.deleteElement({ id: "b1" }));
    expect(d.pending.length).toBe(2);
    const sid = crypto.randomUUID();
    setConfirmSession(sid, d);
    // 首批：确认 newCanvas，取消 b1（取消也算表态，但本批有新表态 → 完成批不删会话）
    const res1 = await POST(
      mockReq({ sessionId: sid, approvals: [{ id: "new-canvas", approved: true }, { id: "b1", approved: false }] })
    );
    expect(res1.status).toBe(200);
    const ev1 = await readEvents(res1);
    expect(ev1.some((e) => e.type === "new-canvas")).toBe(true);
    expect(ev1.some((e) => e.type === "snapshot" && e.canvas.elements.length === 0)).toBe(true);
    // 会话仍在（b1 尚未确认执行）
    expect(getConfirmSession(sid)).toBeDefined();
    // 次批：确认 b1
    const res2 = await POST(mockReq({ sessionId: sid, approvals: [{ id: "b1", approved: true }] }));
    expect(res2.status).toBe(200);
    const ev2 = await readEvents(res2);
    expect(ev2.some((e) => e.type === "snapshot" && e.canvas.elements.length === 0)).toBe(true);
    expect(ev2.some((e) => e.type === "confirm-done")).toBe(true);
    // 全部表态且本批无新表态 → 会话删除
    expect(getConfirmSession(sid)).toBeUndefined();
  });

  it("重复提交同一批次幂等：不重复应用", async () => {
    const d = new DraftCanvas([makeElement("rect", 0, 0, 100, 60, { id: "a1" })]);
    d.newCanvas();
    const sid = crypto.randomUUID();
    setConfirmSession(sid, d);
    const res = await POST(mockReq({ sessionId: sid, approvals: [{ id: "new-canvas", approved: true }] }));
    await readEvents(res);
    // 幂等重试同一 POST（模拟网络重发）：完成批自身不删会话，仍 200
    const res2 = await POST(mockReq({ sessionId: sid, approvals: [{ id: "new-canvas", approved: true }] }));
    expect(res2.status).toBe(200);
    const ev2 = await readEvents(res2);
    // 不产生重复 snapshot（isApplied 跳过）
    expect(ev2.filter((e) => e.type === "snapshot")).toHaveLength(0);
  });

  it("伪造挂起项 id 不计入已表态：不会虚增 resolved 提前删会话", async () => {
    const d = new DraftCanvas([makeElement("rect", 0, 0, 100, 60, { id: "a1" })]);
    d.newCanvas();
    const sid = crypto.randomUUID();
    setConfirmSession(sid, d);
    // 伪造 id "evil" 单独提交一批：若计入 resolved，其重试批（newlyResolved=0）会把"全部表态"
    // 误判为完成而删会话，真实挂起项 new-canvas 尚未表态就过期
    const res1 = await POST(mockReq({ sessionId: sid, approvals: [{ id: "evil", approved: true }] }));
    await readEvents(res1);
    expect(getConfirmSession(sid)).toBeDefined();
    const res2 = await POST(mockReq({ sessionId: sid, approvals: [{ id: "evil", approved: true }] }));
    await readEvents(res2);
    // 过滤后 evil 从未计入 resolved → 重试批仍不算"全部表态"，会话保留等待 new-canvas
    expect(getConfirmSession(sid)).toBeDefined();
  });

  it("未知会话返回 404", async () => {
    const res = await POST(mockReq({ sessionId: crypto.randomUUID(), approvals: [] }));
    expect(res.status).toBe(404);
  });

  it("非法请求体返回 400", async () => {
    const res = await POST(mockReq({ foo: 1 }));
    expect(res.status).toBe(400);
  });
});
