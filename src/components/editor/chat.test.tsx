import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChatPanel from "./ChatPanel";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";

beforeEach(() => {
  useCanvasStore.setState(useCanvasStore.getInitialState());
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function mockStream(events: unknown[]) {
  const lines = events.map((e) => JSON.stringify(e) + "\n");
  return new Response(new Blob([lines.join("")]).stream(), { headers: { "Content-Type": "application/x-ndjson" } });
}

describe("ChatPanel", () => {
  it("发送消息显示在对话中，生成完成后应用画布", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        { type: "progress", activity: ["创建矩形"] },
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [makeElement("rect", 10, 10, 100, 60)] }, summary: "画好了" },
      ])
    );
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    // 活动日志不再显示在对话区（改由左下角气泡显示）
    expect(screen.queryByText(/创建矩形/)).toBeNull();
  });

  it("用户与 AI 消息气泡都带出现动画类 msg-in", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "画好了" },
      ])
    );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    // 用户消息立即出现且带动画类
    const userMsg = screen.getByText("画一个矩形").closest("div")!;
    expect(userMsg.className).toContain("msg-in");
    // AI 回复出现时同样带动画类
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    const aiMsg = screen.getByText(/画好了/).closest("div")!;
    expect(aiMsg.className).toContain("msg-in");
  });

  it("NDJSON 事件行被拆成多个网络分块时仍能完整解析", async () => {
    const line = JSON.stringify({
      type: "complete",
      canvas: { width: 1600, height: 1000, elements: [makeElement("rect", 10, 10, 100, 60)] },
      summary: "画好了",
    });
    const mid = Math.floor(line.length / 2);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(line.slice(0, mid)));
        c.enqueue(encoder.encode(line.slice(mid) + "\n"));
        c.close();
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
  });

  it("snapshot 事件使元素在 complete 前逐步出现在画布，完成后撤销一步回到生成前", async () => {
    const e1 = makeElement("rect", 0, 0, 50, 30);
    const e2 = makeElement("ellipse", 100, 100, 40, 40);
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    const enc = new TextEncoder();
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
    // 第一个 snapshot：元素 e1 立刻出现在画布（complete 尚未到达）
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "snapshot", canvas: { width: 1600, height: 1000, elements: [e1] } }) + "\n"));
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    expect(useCanvasStore.getState().doc.elements[0].type).toBe("rect");
    // 第二个 snapshot：e2 追加
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "snapshot", canvas: { width: 1600, height: 1000, elements: [e1, e2] } }) + "\n"));
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(2));
    // complete：最终状态 + 总结，撤销一步回到生成前空画布
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [e1, e2] }, summary: "画好了" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    expect(useCanvasStore.getState().doc.elements).toHaveLength(2);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("new-canvas 事件创建并切换新画布，元素落在新画布，撤销一步回新画布空态", async () => {
    const e1 = makeElement("rect", 0, 0, 50, 30);
    useCanvasStore.getState().addElement(makeElement("ellipse", 10, 10, 40, 30));
    const firstId = useCanvasStore.getState().currentProjectId;
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        { type: "new-canvas" },
        { type: "snapshot", canvas: { width: 1600, height: 1000, elements: [e1] } },
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [e1] }, summary: "画好了" },
      ])
    );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "换张画布" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    const s = useCanvasStore.getState();
    expect(s.projects).toHaveLength(2);
    expect(s.currentProjectId).not.toBe(firstId);
    expect(s.doc.elements).toHaveLength(1);
    expect(s.doc.elements[0].type).toBe("rect");
    // 原画布内容未受影响
    useCanvasStore.getState().setCurrentProject(firstId);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    useCanvasStore.getState().setCurrentProject(useCanvasStore.getState().projects.find((p) => p.id !== firstId)!.id);
    // 新画布 undo 一步回到空态（基线为新画布初始空画布）
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("未配置 Key 时提示去设置", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "未配置 API Key" }), { status: 400 }));
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/未配置 API Key/)).toBeInTheDocument());
  });

  it("生成中锁定画布", async () => {
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {})); // 永不返回：fetch 挂起，isGenerating 保持锁定
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
  });

  it("流内 error 事件显示错误信息", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockStream([{ type: "error", message: "模型出错" }]));
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/模型出错/)).toBeInTheDocument());
  });

  it("网络异常时提示生成中断", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("网络断了"));
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/生成中断/)).toBeInTheDocument());
  });

  it("模式按钮默认自动，点击思维导图后请求体带 mode 且持久化", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockStream([{ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "好" }]));
    render(<ChatPanel />);
    fireEvent.click(screen.getByText("思维导图"));
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "梳理概念" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/好/)).toBeInTheDocument());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.mode).toBe("mindmap");
    expect(localStorage.getItem(`chartMode-${useCanvasStore.getState().currentProjectId}`)).toBe("mindmap");
  });

  it("刷新后从 localStorage 恢复模式选择", () => {
    localStorage.setItem(`chartMode-${useCanvasStore.getState().currentProjectId}`, "chart");
    render(<ChatPanel />);
    expect(screen.getByText("图表制作")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ChatPanel 破坏性操作确认", () => {
  it("confirm-request 后弹确认框，确认后应用删除并追加系统消息", async () => {
    const mine = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(mine);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s1", pending: [{ id: mine.id, description: "删除「矩形」" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "snapshot", canvas: { width: 1600, height: 1000, elements: [] }, touched: [mine.id] },
          { type: "confirm-done", results: [{ id: mine.id, description: "删除「矩形」", approved: true }] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "删掉矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    expect(screen.getByText(/删除「矩形」/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("确认"));
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(0));
    await waitFor(() => expect(screen.getByText(/已确认：删除「矩形」/)).toBeInTheDocument());
    expect(useCanvasStore.getState().aiLockedIds).toHaveLength(0);
  });

  it("确认清空画布后所有元素移除", async () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    const b = makeElement("ellipse", 200, 200, 40, 40);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s3", pending: [{ id: "clear", description: "清空画布（2 个元素）" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          // touched 必须含被清空元素 id：route 实际会因 applyClear 的 touch 产生，
          // 前端据此加锁后才不会被 mergePreserved 当作"用户本地新增"保留
          { type: "snapshot", canvas: { width: 1600, height: 1000, elements: [] }, touched: [a.id, b.id] },
          { type: "confirm-done", results: [{ id: "clear", description: "清空画布（2 个元素）", approved: true }] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "清空画布" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认"));
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(0));
    await waitFor(() => expect(screen.getByText(/已确认：清空画布/)).toBeInTheDocument());
    expect(useCanvasStore.getState().aiLockedIds).toHaveLength(0);
  });

  it("取消后元素保留，追加取消消息", async () => {
    const mine = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(mine);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s2", pending: [{ id: mine.id, description: "删除「矩形」" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-done", results: [{ id: mine.id, description: "删除「矩形」", approved: false }] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "删掉矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("取消"));
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/已取消：删除「矩形」/)).toBeInTheDocument());
  });
});
