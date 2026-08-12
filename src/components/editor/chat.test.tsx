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
  it("支持拖拽解析附件并把正文作为隐藏研究上下文发送", async () => {
    const longName = `${"超长科研论文方法与实验结果附件".repeat(8)}.pdf`;
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ ok: true, file: {
        id: "file-1", name: longName, mimeType: "application/pdf", size: 2048,
        text: "Transformer encoder and attention mechanism", characters: 43, truncated: false,
      } }))
      .mockResolvedValueOnce(mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "已根据论文绘图" },
      ]));
    render(<ChatPanel />);
    const file = new File(["fake-pdf"], longName, { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("chat-file-dropzone"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("pending-attachments")).toHaveTextContent(longName));
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画出方法架构" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText("已根据论文绘图")).toBeInTheDocument());

    const chatCall = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/chat");
    const requestBody = JSON.parse(String((chatCall?.[1] as RequestInit).body));
    expect(requestBody.messages[0].content).toContain("UNTRUSTED UPLOADED DOCUMENT");
    expect(requestBody.messages[0].content).toContain("Transformer encoder");
    expect(screen.getByText("画出方法架构")).toBeInTheDocument();
    expect(screen.getByTestId("message-attachments")).toHaveTextContent(longName);
    expect(screen.getByText("画出方法架构").closest("[data-testid='message-bubble']")).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    expect(screen.getByTestId("message-attachment")).toHaveClass("w-full", "min-w-0", "overflow-hidden");
    expect(screen.getByText(longName)).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(screen.queryByText(/UNTRUSTED UPLOADED DOCUMENT/)).toBeNull();
  });

  it("点击上传按钮会打开隐藏文件选择器", () => {
    render(<ChatPanel />);
    const input = screen.getByTestId("chat-file-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByLabelText("上传文件"));
    expect(click).toHaveBeenCalledOnce();
    expect(input.accept).toContain(".docx");
    expect(input.accept).toContain(".ppt");
    expect(input.accept).toContain(".xlsx");
  });

  it("新版复制按钮写入剪贴板并显示成功对勾状态", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.mocked(fetch).mockResolvedValueOnce(mockStream([
      { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "可复制的科研说明" },
    ]));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "生成说明" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText("可复制的科研说明")).toBeInTheDocument());

    const copyButtons = screen.getAllByLabelText("复制消息");
    fireEvent.click(copyButtons[copyButtons.length - 1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("可复制的科研说明"));
    expect(screen.getByLabelText("已复制")).toBeInTheDocument();
  });

  it("streams planning and drawing status while canvas snapshots apply before completion", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "draw a pipeline" } });
    fireEvent.click(screen.getByText("一键生成"));

    const enc = new TextEncoder();
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "status", phase: "thinking", message: "Analyzing the requested structure" }) + "\n"));
    await waitFor(() => expect(screen.getByText("Analyzing the requested structure")).toBeInTheDocument());
    expect(screen.getByTestId("canvas-sync-receipt")).toHaveTextContent("规划阶段 · 画布未变更");

    ctrl.enqueue(enc.encode(JSON.stringify({ type: "status", phase: "drawing", message: "Creating the model nodes" }) + "\n"));
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "progress", activity: ["Created model node"] }) + "\n"));
    const node = makeElement("rect", 10, 10, 100, 60);
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "snapshot", canvas: { width: 1600, height: 1000, elements: [node] } }) + "\n"));
    await waitFor(() => expect(screen.getByText("Creating the model nodes")).toBeInTheDocument());
    expect(screen.getByText("Created model node")).toBeInTheDocument();
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    expect(screen.getByTestId("canvas-sync-receipt")).toHaveTextContent("已同步 1 次 · 1 个对象");

    ctrl.enqueue(enc.encode(JSON.stringify({ type: "status", phase: "checking", message: "Checking layout" }) + "\n"));
    await waitFor(() => expect(screen.getByText("Checking layout")).toBeInTheDocument());
    expect(screen.getByTestId("canvas-sync-receipt")).toHaveTextContent("已同步 1 次 · 1 个对象");

    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [node] }, summary: "Done" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText("Done")).toBeInTheDocument());
    expect(screen.queryByTestId("ai-typing")).toBeNull();
  });

  it("发送消息显示在对话中，生成中思考步骤出现，生成完成后应用画布", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    // 生成中：对话气泡内出现思考步骤（活动日志不再单独挂外部气泡）
    await waitFor(() => expect(screen.getByTestId("ai-typing")).toBeInTheDocument());
    const enc = new TextEncoder();
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "progress", activity: ["创建矩形"] }) + "\n"));
    await waitFor(() => expect(screen.getByText("创建矩形")).toBeInTheDocument());
    expect(screen.getByTestId("thinking-steps")).toBeInTheDocument();
    // 生成完成
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [makeElement("rect", 10, 10, 100, 60)] }, summary: "画好了" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText(/画好了/)).toBeInTheDocument());
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    // 思考步骤随生成结束收起
    await waitFor(() => expect(screen.queryByTestId("thinking-steps")).toBeNull());
  });

  it("AI 执行时对话气泡内显示思考步骤：最新步骤实时更新，结束收起", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画一个流程" } });
    fireEvent.click(screen.getByText("一键生成"));
    // 生成中：对话气泡内出现思考步骤，逐步推送最新步骤
    await waitFor(() => expect(screen.getByTestId("ai-typing")).toBeInTheDocument());
    const enc = new TextEncoder();
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "progress", activity: ["创建矩形"] }) + "\n"));
    await waitFor(() => expect(screen.getByText("创建矩形")).toBeInTheDocument());
    // 再推一条 → 最新步骤实时更新
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "progress", activity: ["连接箭头"] }) + "\n"));
    await waitFor(() => expect(screen.getByText("连接箭头")).toBeInTheDocument());
    // 生成结束气泡收起（动画后卸载）
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "画好了" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.queryByTestId("ai-typing")).toBeNull());
  });

  it("AI 提问带可点击选项：渲染选项按钮，点选即作为回答发送并继续生成", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画个对比" } });
    fireEvent.click(screen.getByText("一键生成"));
    const enc = new TextEncoder();
    // AI 提问 + 选项
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "question", question: "你想用哪种图表？", options: ["柱状图", "折线图", "饼图"] }) + "\n"));
    ctrl.close(); // 提问流结束 → isGenerating 复位，点选项才能发起下一轮
    await waitFor(() => expect(screen.getByText("你想用哪种图表？")).toBeInTheDocument());
    expect(screen.getByTestId("question-options")).toBeInTheDocument();
    expect(screen.getByText("柱状图")).toBeInTheDocument();
    expect(screen.getByText("折线图")).toBeInTheDocument();
    expect(screen.getByText("饼图")).toBeInTheDocument();
    expect(screen.getByText("其他")).toBeInTheDocument();
    // 点选项 → 作为回答发送（第二次 fetch），生成完成
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "柱状图画好了" },
      ])
    );
    fireEvent.click(screen.getByText("饼图"));
    await waitFor(() => expect(screen.getByText(/柱状图画好了/)).toBeInTheDocument());
    // 选项区在回答后消失
    await waitFor(() => expect(screen.queryByTestId("question-options")).toBeNull());
  });

  it("AI 选项最后强制为其他，点击后输入自定义答案再继续生成", async () => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画个模型图" } });
    fireEvent.click(screen.getByText("一键生成"));

    const enc = new TextEncoder();
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "question", question: "想突出哪个部分？", options: ["编码器", "解码器"] }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText("其他")).toBeInTheDocument());
    const optionLabels = Array.from(screen.getByTestId("question-options").querySelectorAll("button")).map((button) => button.textContent?.trim());
    expect(optionLabels.slice(0, 3)).toEqual(["编码器", "解码器", "其他"]);

    fireEvent.click(screen.getByText("其他"));
    expect(screen.getByTestId("custom-answer-box")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    vi.mocked(fetch).mockResolvedValueOnce(mockStream([
      { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "已按自定义重点生成" },
    ]));
    fireEvent.change(screen.getByTestId("custom-answer-input"), { target: { value: "重点展示跨层注意力" } });
    fireEvent.click(screen.getByText("提交"));
    await waitFor(() => expect(screen.getByText("已按自定义重点生成")).toBeInTheDocument());

    const request = JSON.parse(String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body));
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "重点展示跨层注意力" });
    expect(screen.queryByTestId("custom-answer-box")).toBeNull();
  });

  it("A7 对话长期记忆：消息持久化到 localStorage，刷新（重挂载）后恢复", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "AI 记忆回复" },
      ])
    );
    const pid = useCanvasStore.getState().currentProjectId;
    const { unmount } = render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "记住这句话" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/AI 记忆回复/)).toBeInTheDocument());
    // 消息已写入 localStorage（按画布键隔离）
    expect(localStorage.getItem(`chatMessages-${pid}`)).toContain("记住这句话");
    unmount();
    // 模拟刷新：重新挂载 ChatPanel → 对话恢复
    render(<ChatPanel />);
    expect(screen.getByText("记住这句话")).toBeInTheDocument();
    expect(screen.getByText(/AI 记忆回复/)).toBeInTheDocument();
  });

  it("A7 对话按画布隔离：切换画布恢复各自对话，互不污染", async () => {
    const pidA = useCanvasStore.getState().currentProjectId;
    // 画布 A：先放一条历史消息
    localStorage.setItem(`chatMessages-${pidA}`, JSON.stringify([{ role: "user", content: "画布A的旧问题" }]));
    const { unmount } = render(<ChatPanel />);
    await waitFor(() => expect(screen.getByText("画布A的旧问题")).toBeInTheDocument());
    // 新建画布 B：对话应为空
    useCanvasStore.getState().createProject();
    await waitFor(() => expect(screen.queryByText("画布A的旧问题")).toBeNull());
    // 回画布 A：恢复其对话
    useCanvasStore.getState().setCurrentProject(pidA);
    await waitFor(() => expect(screen.getByText("画布A的旧问题")).toBeInTheDocument());
    unmount();
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

  it("消息气泡带 hover 复制按钮（group-hover 显示），点击复制内容到剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "AI 回复内容" },
      ])
    );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "我的问题" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/AI 回复内容/)).toBeInTheDocument());
    // 用户消息 + AI 回复各有一个复制按钮；默认透明且不接收指针，悬停/键盘焦点后显示。
    const copyBtns = screen.getAllByLabelText("复制消息");
    expect(copyBtns.length).toBe(2);
    for (const btn of copyBtns) {
      expect(btn.className).toContain("pointer-events-none");
      expect(btn.className).toContain("opacity-0");
      expect(btn.className).toContain("group-hover/msg:opacity-100");
      expect(btn.className).toContain("focus-visible:opacity-100");
    }
    // 点击复制用户消息内容
    fireEvent.click(copyBtns[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("我的问题"));
    fireEvent.click(copyBtns[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("AI 回复内容"));
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

  it("生成中显示 AI 流式光标气泡", async () => {
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByTestId("ai-typing")).toBeInTheDocument());
  });

  it("旧设置中的 Tavily Key 不再向服务端传输", async () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ apiKey: "sk-1", tavilyApiKey: "tvly-9" }));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([{ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "好" }])
    );
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/描述你想画的图/), { target: { value: "画图" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(screen.getByText(/好/)).toBeInTheDocument());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("tavilyApiKey");
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
    await waitFor(() => expect(screen.getByTestId("confirm-inline")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByTestId("confirm-inline")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByTestId("confirm-inline")).toBeInTheDocument());
    fireEvent.click(screen.getByText("允许"));
    await waitFor(() => expect(screen.queryByTestId("confirm-inline")).toBeNull());
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
    await waitFor(() => expect(screen.getByTestId("confirm-inline")).toBeInTheDocument());
    fireEvent.click(screen.getByText("允许"));
    // 404：不新建画布、对话框必须关闭（否则用户永远卡在弹窗里）、显示错误
    await waitFor(() => expect(screen.queryByTestId("confirm-inline")).toBeNull());
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
    await waitFor(() => expect(screen.getByTestId("confirm-inline")).toBeInTheDocument());
    // 点遮罩弹窗不关闭：敏感操作不能跳过
    fireEvent.click(screen.getByTestId("confirm-inline"));
    expect(screen.getByTestId("confirm-inline")).toBeInTheDocument();
    expect(useCanvasStore.getState().projects).toHaveLength(1); // 未新建画布
    // 必须点允许才关闭
    fireEvent.click(screen.getByText("允许"));
    await waitFor(() => expect(screen.queryByTestId("confirm-inline")).toBeNull());
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

describe("ChatPanel 生成队列", () => {
  // 便捷：开一个挂起的生成流，返回控制句柄用于推事件
  function openGeneration() {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }));
    return { ctrl, enc: new TextEncoder() };
  }

  it("生成中回车发送的消息入队：显示等待队列、输入框清空、不发请求；生成结束自动执行队首", async () => {
    const { ctrl, enc } = openGeneration();
    // 第一条完成后，队列队首的"再加一个圆"自动发起第二次生成
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([{ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "圆画好了" }])
    );
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "画一个矩形" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
    // 生成中输入第二条消息按回车 → 入队（不是立即发送）
    fireEvent.change(input, { target: { value: "再加一个圆" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("generation-queue")).toBeInTheDocument();
    expect(screen.getByText("再加一个圆")).toBeInTheDocument();
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    // 第一条完成 → 队列自动续跑：第二次请求带上排队消息与上轮摘要
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "矩形画好了" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText("圆画好了")).toBeInTheDocument());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string);
    expect(body2.messages).toEqual([
      { role: "user", content: "画一个矩形" },
      { role: "assistant", content: "矩形画好了" },
      { role: "user", content: "再加一个圆" },
    ]);
    // 队首已出队，队列清空
    await waitFor(() => expect(screen.queryByTestId("generation-queue")).toBeNull());
  });

  it("生成中排队多条：按顺序依次自动执行（第二条完成后再执行第三条）", async () => {
    const { ctrl, enc } = openGeneration();
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([{ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "二号完成" }])
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      mockStream([{ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "三号完成" }])
    );
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "一号" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
    // 生成中连排两条
    fireEvent.change(input, { target: { value: "二号" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "三号" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByTestId("queue-item")).toHaveLength(2);
    // 一号完成 → 自动执行二号
    ctrl.enqueue(enc.encode(JSON.stringify({ type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "一号完成" }) + "\n"));
    ctrl.close();
    await waitFor(() => expect(screen.getByText("二号完成")).toBeInTheDocument());
    // 二号完成 → 自动执行三号
    await waitFor(() => expect(screen.getByText("三号完成")).toBeInTheDocument());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.queryByTestId("generation-queue")).toBeNull());
  });

  it("等待队列预览从首字开始单行显示，换行折叠且超出部分交给省略号", async () => {
    openGeneration();
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "先运行当前任务" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));

    const queuedText = "从这里开始展示研究背景与方法设计\n不要生硬地只显示最后一行结论";
    fireEvent.change(input, { target: { value: queuedText } });
    fireEvent.keyDown(input, { key: "Enter" });

    const preview = screen.getByTestId("queue-preview");
    expect(preview).toHaveTextContent("从这里开始展示研究背景与方法设计 不要生硬地只显示最后一行结论");
    expect(preview).toHaveAttribute("title", "从这里开始展示研究背景与方法设计 不要生硬地只显示最后一行结论");
    expect(preview).toHaveClass("overflow-hidden", "text-ellipsis", "whitespace-nowrap");
  });

  it("每条等待消息都可打断当前请求，并优先执行用户点选的队列项", async () => {
    let firstController!: ReadableStreamDefaultController<Uint8Array>;
    let firstSignal!: AbortSignal;
    const firstStream = new ReadableStream<Uint8Array>({ start(controller) { firstController = controller; } });
    vi.mocked(fetch)
      .mockImplementationOnce(async (_url, init) => {
        firstSignal = (init as RequestInit).signal as AbortSignal;
        // 模拟不会因 AbortSignal 立刻结束的顽固代理流：新任务仍必须立即开始，不能等 reader.read() 返回。
        return new Response(firstStream, { headers: { "Content-Type": "application/x-ndjson" } });
      })
      .mockResolvedValueOnce(mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "点选任务已完成" },
      ]))
      .mockResolvedValueOnce(mockStream([
        { type: "complete", canvas: { width: 1600, height: 1000, elements: [] }, summary: "原队首任务已完成" },
      ]));

    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "正在耗时思考的旧任务" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));

    fireEvent.change(input, { target: { value: "立即改画网络安全架构" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "改画联邦学习架构" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const interruptButtons = screen.getAllByTestId("queue-interrupt");
    expect(interruptButtons).toHaveLength(2);
    expect(interruptButtons[0]).toHaveClass("h-5", "w-5", "rounded", "text-slate-400");
    fireEvent.click(interruptButtons[1]);

    expect(firstSignal.aborted).toBe(true);
    // 旧流仍未 close/error，但第二个请求已经发出，证明切换不依赖旧请求完成清理。
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByText("点选任务已完成")).toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3));
    const request = JSON.parse(String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body));
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "改画联邦学习架构" });
    const nextRequest = JSON.parse(String((vi.mocked(fetch).mock.calls[2][1] as RequestInit).body));
    expect(nextRequest.messages.at(-1)).toEqual({ role: "user", content: "立即改画网络安全架构" });
    expect(screen.queryByText(/生成中断/)).toBeNull();
    firstController.close();
  });

  it("队列操作：删除 / 编辑保存 / 点击置顶优先", async () => {
    const { ctrl } = openGeneration();
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "一号" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
    fireEvent.change(input, { target: { value: "二号" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "三号" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByTestId("queue-item")).toHaveLength(2);
    // 删除"三号"（第二项）
    const items = screen.getAllByTestId("queue-item");
    fireEvent.click(items[1].querySelector('[data-testid="queue-delete"]')!);
    expect(screen.getAllByTestId("queue-item")).toHaveLength(1);
    expect(screen.queryByText("三号")).toBeNull();
    // 编辑"二号"→"二B"
    fireEvent.click(screen.getByTestId("queue-edit"));
    const editInput = screen.getByTestId("queue-edit-input");
    fireEvent.change(editInput, { target: { value: "二B" } });
    fireEvent.keyDown(editInput, { key: "Enter" });
    expect(screen.getByText("二B")).toBeInTheDocument();
    // 再加一条，点击置顶优先（点后成为队首）
    fireEvent.change(input, { target: { value: "新来的" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByTestId("queue-item")).toHaveLength(2);
    // 当前顺序 [二B, 新来的]；点击"新来的"置顶 → [新来的, 二B]
    fireEvent.click(screen.getByText("新来的"));
    const ordered = screen.getAllByTestId("queue-item").map((el) => el.textContent);
    expect(ordered[0]).toContain("新来的");
    expect(ordered[1]).toContain("二B");
  });

  it("队列拖拽排序：把第二项拖到第一项位置，顺序交换", async () => {
    const { ctrl } = openGeneration();
    render(<ChatPanel />);
    const input = screen.getByPlaceholderText(/描述你想画的图/);
    fireEvent.change(input, { target: { value: "甲" } });
    fireEvent.click(screen.getByText("一键生成"));
    await waitFor(() => expect(useCanvasStore.getState().isGenerating).toBe(true));
    fireEvent.change(input, { target: { value: "乙" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "丙" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // 顺序 [乙, 丙]：拖"丙"(index1) 到"乙"(index0) 位置 → [丙, 乙]
    let items = screen.getAllByTestId("queue-item");
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragStart(items[1], { dataTransfer });
    fireEvent.dragOver(items[0], { dataTransfer });
    fireEvent.drop(items[0], { dataTransfer });
    items = screen.getAllByTestId("queue-item");
    expect(items[0].textContent).toContain("丙");
    expect(items[1].textContent).toContain("乙");
  });
});
