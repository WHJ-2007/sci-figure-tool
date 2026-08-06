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

  it("点击具体模式后请求体带 modes 数组且持久化；自动互斥", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockStream([{ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "好" }]));
    render(<ChatPanel />);
    fireEvent.click(screen.getByText("思维导图"));
    fireEvent.click(screen.getByText("图表制作"));
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "梳理概念" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/好/)).toBeInTheDocument());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.modes).toEqual(["mindmap", "chart"]);
    expect(localStorage.getItem(`chartMode-${useCanvasStore.getState().currentProjectId}`)).toBe(JSON.stringify(["mindmap", "chart"]));
  });

  it("再点已选模式取消选中；点自动清空全部具体模式", async () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByText("思维导图"));
    expect(screen.getByText("思维导图").closest("button")!).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("思维导图"));
    expect(screen.getByText("思维导图").closest("button")!).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByText("图表制作"));
    fireEvent.click(screen.getByText("自动"));
    expect(screen.getByText("自动").closest("button")!).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("图表制作").closest("button")!).toHaveAttribute("aria-pressed", "false");
  });

  it("刷新后从 localStorage 恢复模式选择", () => {
    localStorage.setItem(`chartMode-${useCanvasStore.getState().currentProjectId}`, "chart");
    render(<ChatPanel />);
    expect(screen.getByText("图表制作").closest("button")!).toHaveAttribute("aria-pressed", "true");
  });

  it("恢复新格式 JSON 数组；非法数组与全部取消后回到自动", () => {
    localStorage.setItem(`chartMode-${useCanvasStore.getState().currentProjectId}`, JSON.stringify(["mindmap", "chart"]));
    const { unmount } = render(<ChatPanel />);
    expect(screen.getByText("思维导图").closest("button")!).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("图表制作").closest("button")!).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("自动").closest("button")!).toHaveAttribute("aria-pressed", "false");
    unmount();

    // 全部具体模式取消 → 自动并持久化 "auto"
    localStorage.setItem(`chartMode-${useCanvasStore.getState().currentProjectId}`, JSON.stringify(["mindmap", "chart"]));
    const { unmount: unmount2 } = render(<ChatPanel />);
    fireEvent.click(screen.getByText("思维导图"));
    fireEvent.click(screen.getByText("图表制作"));
    expect(screen.getByText("自动").closest("button")!).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(`chartMode-${useCanvasStore.getState().currentProjectId}`)).toBe("auto");
    unmount2();

    // 非法内容 → 默认自动
    localStorage.setItem(`chartMode-${useCanvasStore.getState().currentProjectId}`, "garbage{");
    render(<ChatPanel />);
    expect(screen.getByText("自动").closest("button")!).toHaveAttribute("aria-pressed", "true");
  });

  it("模式按钮为纯文字无图标（SVG）", () => {
    render(<ChatPanel />);
    for (const label of ["自动", "科研绘图", "思维导图", "图表制作"]) {
      const btn = screen.getByText(label).closest("button")!;
      expect(btn.querySelector("svg")).toBeNull();
    }
  });

  it("生成中显示 AI 流式光标气泡", async () => {
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("ai-typing")).toBeInTheDocument());
  });

  it("AI 提问澄清：question 事件显示问题气泡与等待提示，回答后复用主流程继续生成", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockStream([{ type: "question", question: "请问要画柱状图还是折线图？" }]))
      .mockResolvedValueOnce(
        mockStream([
          { type: "complete", canvas: { width: 1600, height: 1000, elements: [makeElement("rect", 0, 0, 50, 30)] }, summary: "画好了" },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "帮我画个图" } });
    fireEvent.click(screen.getByText("一键生成"));
    // 问题气泡 + 等待提示 + 输入框切换为回答提示
    await waitFor(() => expect(screen.getByText(/柱状图还是折线图/)).toBeInTheDocument());
    expect(screen.getByTestId("waiting-answer")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/回答后继续生成/), { target: { value: "柱状图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    // 回答后等待提示消失
    expect(screen.queryByTestId("waiting-answer")).toBeNull();
    // 第二次请求上下文完整：问题（assistant）+ 回答（user）
    const body2 = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
    expect(body2.messages).toEqual([
      { role: "user", content: "帮我画个图" },
      { role: "assistant", content: "请问要画柱状图还是折线图？" },
      { role: "user", content: "柱状图" },
    ]);
  });

  it("AI 提问前若已画元素：恢复生成前基线（防呆丢弃 AI 变更）", async () => {
    const base = makeElement("rect", 0, 0, 50, 30);
    useCanvasStore.setState({ doc: { width: 1600, height: 1000, elements: [base] } });
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        {
          type: "snapshot",
          canvas: { width: 1600, height: 1000, elements: [base, makeElement("ellipse", 100, 100, 40, 40, { id: "e2" })] },
          touched: ["e2"],
        },
        { type: "question", question: "请问要画什么？" },
      ])
    );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/请问要画什么/)).toBeInTheDocument());
    // AI 的椭圆被丢弃，画布恢复为生成前仅一个矩形
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    expect(useCanvasStore.getState().doc.elements[0].type).toBe("rect");
  });
});

describe("ChatPanel 画布级操作确认", () => {
  it("confirm-request 后弹确认框，确认后新建画布并追加系统消息", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s1", summary: "画好了，等您确认", pending: [{ id: "new-canvas", description: "新建空白画布并切换到它" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "new-canvas" },
          { type: "snapshot", canvas: { width: 1600, height: 1000, elements: [] }, touched: [] },
          { type: "confirm-done", results: [{ id: "new-canvas", description: "新建空白画布并切换到它", approved: true }] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "换个画布画" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    expect(screen.getByText(/新建空白画布/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("允许"));
    // new-canvas 事件触发 createProject：多出一张画布
    await waitFor(() => expect(useCanvasStore.getState().projects).toHaveLength(2));
    await waitFor(() => expect(screen.getByText(/已确认：新建空白画布/)).toBeInTheDocument());
    expect(useCanvasStore.getState().aiLockedIds).toHaveLength(0);
  });

  it("取消后不新建画布，追加取消消息", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s2", summary: "已准备新建画布，等您确认", pending: [{ id: "new-canvas", description: "新建空白画布并切换到它" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-done", results: [{ id: "new-canvas", description: "新建空白画布并切换到它", approved: false }] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "换个画布画" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("不允许"));
    await waitFor(() => expect(useCanvasStore.getState().projects).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/已取消：新建空白画布/)).toBeInTheDocument());
  });

  it("确认完成后可再次发起生成（无死锁）", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "sx", summary: "好的", pending: [{ id: "new-canvas", description: "新建空白画布并切换到它" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "new-canvas" },
          { type: "snapshot", canvas: { width: 1600, height: 1000, elements: [] }, touched: [] },
          { type: "confirm-done", results: [{ id: "new-canvas", description: "新建空白画布并切换到它", approved: true }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "第二次生成", touched: [] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "换个画布画" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("允许"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    // 再次生成：confirmReq 若残留真值，send() 守卫会永久 return，这里死锁
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "再来" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/第二次生成/)).toBeInTheDocument());
  });

  it("确认请求失败（会话过期 404）时对话框关闭，不卡死", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s-expired", summary: "等您确认", pending: [{ id: "new-canvas", description: "新建空白画布并切换到它" }] },
        ])
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "确认会话已过期，请重新生成" }), { status: 404, headers: { "Content-Type": "application/json" } })
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "换个画布画" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByText("允许"));
    // 404：不新建画布、对话框必须关闭（否则用户永远卡在弹窗里）、显示错误
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(useCanvasStore.getState().projects).toHaveLength(1);
    expect(screen.getByText(/确认会话已过期/)).toBeInTheDocument();
  });

  it("点击遮罩不能跳过：必须点允许/不允许才关闭", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-request", sessionId: "s3", summary: "等您确认", pending: [{ id: "new-canvas", description: "新建空白画布并切换到它" }] },
        ])
      )
      .mockResolvedValueOnce(
        mockStream([
          { type: "confirm-done", results: [{ id: "new-canvas", description: "新建空白画布并切换到它", approved: true }] },
        ])
      );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "换个画布画" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument());
    // 点遮罩弹窗不关闭：敏感操作不能跳过
    fireEvent.click(screen.getByTestId("confirm-dialog"));
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(useCanvasStore.getState().projects).toHaveLength(1); // 未新建画布
    // 必须点允许才关闭
    fireEvent.click(screen.getByText("允许"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
  });
});

describe("ChatPanel A5 画布切换守卫", () => {
  it("生成中切换画布：迟到事件全部丢弃，提示已丢弃，不污染新画布", async () => {
    useCanvasStore.getState().addElement(makeElement("ellipse", 10, 10, 40, 30));
    const firstId = useCanvasStore.getState().currentProjectId;
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    const enc = new TextEncoder();
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
    // 生成中切到新画布（模拟侧边栏点击）
    useCanvasStore.getState().createProject();
    expect(useCanvasStore.getState().currentProjectId).not.toBe(firstId);
    // 迟到的 snapshot/complete 必须被丢弃：不应用画布、不追加总结、不残留 AI 锁定
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "snapshot", canvas: { width: 1600, height: 1000, elements: [makeElement("rect", 0, 0, 50, 30)] }, touched: ["r1"] }) + "\n"));
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [makeElement("rect", 0, 0, 50, 30)] }, summary: "画好了" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText(/画布已切换，本次生成已丢弃/)).toBeInTheDocument());
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    expect(useCanvasStore.getState().aiLockedIds).toHaveLength(0);
    expect(useCanvasStore.getState().aiBaselineIds).toHaveLength(0);
    expect(screen.queryByText(/画好了/)).toBeNull();
    // 对话会话已随切换清空：用户消息不残留
    expect(screen.queryByText("画图")).toBeNull();
  });
});
