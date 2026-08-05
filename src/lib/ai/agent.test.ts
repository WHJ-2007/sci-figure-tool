// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DraftCanvas } from "./draft";
import { buildTools } from "./tools";
import { runAgent } from "./agent";
import { CANVAS_WIDTH } from "../canvas/geometry";

// vi.mock 工厂被提升执行时引用外部变量会 TDZ 报错，必须用 vi.hoisted 创建 mock；
// 只替换 generateText，保留真实的 tool（tools.ts 依赖它构造工具对象）
const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ai")>();
  return { ...mod, generateText: (...args: unknown[]) => mockGenerateText(...args) };
});

describe("DraftCanvas", () => {
  it("createElement 钳制越界坐标", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: -100, y: 2000, width: 100, height: 60 });
    expect(r.ok).toBe(true);
    const el = d.serialize().elements[0];
    expect(el.x).toBe(0);
    expect(el.y).toBe(1000 - 60);
  });

  it("createElement 记录活动日志", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "rect", x: 10, y: 10, width: 100, height: 60 });
    expect(d.flushActivity()).toHaveLength(1);
    expect(d.flushActivity()).toHaveLength(0);
  });

  it("updateElement 修改与日志、deleteElement 删除", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    d.updateElement({ id: r.id!, patch: { fill: "#ff0000" } });
    expect(d.serialize().elements[0].fill).toBe("#ff0000");
    d.deleteElement({ id: r.id! });
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("updateElement 对不存在的 id 报错", () => {
    const d = new DraftCanvas([]);
    const res = d.updateElement({ id: "missing", patch: { x: 10 } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/不存在/);
  });

  it("deleteElement 对不存在的 id 报错", () => {
    const d = new DraftCanvas([]);
    const res = d.deleteElement({ id: "missing" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/不存在/);
  });

  it("updateElement 忽略白名单外的键", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const res = d.updateElement({ id: r.id!, patch: { zIndex: 999, evil: true } as unknown as Record<string, unknown> });
    expect(res.ok).toBe(true);
    const el = d.serialize().elements[0];
    expect(el.zIndex).toBe(1);
    expect("evil" in el).toBe(false);
  });

  it("updateElement 先钳最小尺寸再钳位置，缩小宽度的元素不越界", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 50 });
    const res = d.updateElement({ id: r.id!, patch: { x: 1598, width: 2 } });
    expect(res.ok).toBe(true);
    const el = d.serialize().elements[0];
    expect(el.width).toBe(4);
    expect(el.x).toBe(CANVAS_WIDTH - 4);
  });

  it("listElements 返回可序列化摘要", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "text", x: 0, y: 0, width: 50, height: 20, text: "Encoder" });
    const list = d.listElements();
    expect(list[0]).toMatchObject({ type: "text", text: "Encoder" });
    expect(JSON.stringify(list)).toContain("Encoder");
  });

  it("connectElements 箭头精确落在两个矩形边缘（水平相邻）", () => {
    const d = new DraftCanvas([]);
    const a = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const b = d.createElement({ type: "rect", x: 200, y: 0, width: 100, height: 60 });
    const r = d.connectElements({ sourceId: a.id!, targetId: b.id! });
    expect(r.ok).toBe(true);
    const arrow = d.serialize().elements.find((e) => e.type === "arrow")!;
    // 起点在源右边缘中点 (100,30)，终点在目标左边缘中点 (200,30)
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(30);
    expect(arrow.width).toBe(100);
    expect(arrow.height).toBe(0);
  });

  it("connectElements 垂直连接精确落在上下边缘", () => {
    const d = new DraftCanvas([]);
    const a = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const b = d.createElement({ type: "rect", x: 0, y: 80, width: 100, height: 60 });
    const r = d.connectElements({ sourceId: a.id!, targetId: b.id! });
    expect(r.ok).toBe(true);
    const arrow = d.serialize().elements.find((e) => e.type === "arrow")!;
    expect(arrow.x).toBe(50);
    expect(arrow.y).toBe(60);
    expect(arrow.width).toBe(0);
    expect(arrow.height).toBe(20);
  });

  it("connectElements 椭圆源锚点精确在椭圆轮廓上", () => {
    const d = new DraftCanvas([]);
    const a = d.createElement({ type: "ellipse", x: 0, y: 0, width: 100, height: 60 });
    const b = d.createElement({ type: "rect", x: 200, y: 0, width: 100, height: 60 });
    d.connectElements({ sourceId: a.id!, targetId: b.id! });
    const arrow = d.serialize().elements.find((e) => e.type === "arrow")!;
    expect(arrow.x).toBe(100); // 椭圆最右点 (中心 50,30 + 半轴 50)
    expect(arrow.y).toBe(30);
    expect(arrow.width).toBe(100);
  });

  it("connectElements 对不存在 id / 中心重合 / 非形状端点报错", () => {
    const d = new DraftCanvas([]);
    const a = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    expect(d.connectElements({ sourceId: "missing", targetId: a.id! }).ok).toBe(false);
    expect(d.connectElements({ sourceId: a.id!, targetId: "missing" }).ok).toBe(false);
    const same = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    expect(d.connectElements({ sourceId: a.id!, targetId: same.id! }).ok).toBe(false);
    const ar = d.createElement({ type: "arrow", x: 0, y: 0, width: 50, height: 30 });
    expect(d.connectElements({ sourceId: a.id!, targetId: ar.id! }).ok).toBe(false);
  });
});

describe("tools", () => {
  it("工具对非法 type 报错", async () => {
    const d = new DraftCanvas([]);
    const tools = buildTools(d);
    // v5 的 Tool.execute 类型为可选双参签名（真实调用由 generateText 提供 options），测试直接调用需断言
    const res = await (tools as any).createElement.execute({ type: "nonsense", x: 0, y: 0, width: 10, height: 10 });
    expect(res.ok).toBe(false);
  });
});

describe("DraftCanvas onChange", () => {
  it("变更成功触发 onChange，失败操作不触发", () => {
    const onChange = vi.fn();
    const d = new DraftCanvas([], onChange);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    expect(onChange).toHaveBeenCalledTimes(1);
    d.updateElement({ id: r.id!, patch: { fill: "#ff0000" } });
    expect(onChange).toHaveBeenCalledTimes(2);
    d.updateElement({ id: "missing", patch: { x: 1 } });
    expect(onChange).toHaveBeenCalledTimes(2);
    d.deleteElement({ id: r.id! });
    expect(onChange).toHaveBeenCalledTimes(3);
    d.deleteElement({ id: "missing" });
    expect(onChange).toHaveBeenCalledTimes(3);
    d.clear();
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe("runAgent", () => {
  it("每个元素操作触发 snapshot 事件，complete 收尾且画布与快照一致", async () => {
    mockGenerateText.mockImplementation(async ({ tools, onStepFinish }: any) => {
      const res = await (tools as any).createElement.execute({ type: "rect", x: 10, y: 10, width: 100, height: 60 });
      onStepFinish?.({ toolResults: [{ toolName: "createElement", result: res }] });
      return { text: "已创建矩形" };
    });
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "画一个矩形" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      onEvent: (ev) => events.push(ev),
    });
    const snapshots = events.filter((e) => e.type === "snapshot");
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].canvas.elements).toHaveLength(1);
    const complete = events.find((e) => e.type === "complete");
    expect(complete.canvas.elements).toEqual(snapshots[snapshots.length - 1].canvas.elements);
    expect(events[events.length - 1].type).toBe("complete");
  });

  it("newCanvas 工具清空草稿、发出 new-canvas 事件，新内容落在新画布", async () => {
    mockGenerateText.mockImplementation(async ({ tools, onStepFinish }: any) => {
      await (tools as any).createElement.execute({ type: "rect", x: 0, y: 0, width: 50, height: 30 });
      await (tools as any).newCanvas.execute({});
      await (tools as any).createElement.execute({ type: "ellipse", x: 10, y: 10, width: 40, height: 30 });
      onStepFinish?.({ toolResults: [] });
      return { text: "已新建画布" };
    });
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "换个画布画" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      onEvent: (ev) => events.push(ev),
    });
    expect(events.some((e) => e.type === "new-canvas")).toBe(true);
    const complete = events.find((e) => e.type === "complete");
    // newCanvas 清空旧元素，final 只有新画布上的元素
    expect(complete.canvas.elements).toHaveLength(1);
    expect(complete.canvas.elements[0].type).toBe("ellipse");
  });

  it("驱动模型调用工具并把结果应用到草稿、发出 complete 事件", async () => {
    mockGenerateText.mockImplementation(async ({ tools, onStepFinish }: any) => {
      const res = await (tools as any).createElement.execute({ type: "rect", x: 10, y: 10, width: 100, height: 60 });
      onStepFinish?.({ toolResults: [{ toolName: "createElement", result: res }] });
      return { text: "已创建矩形" };
    });
    const events: any[] = [];
    const summary = await runAgent({
      messages: [{ role: "user", content: "画一个矩形" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      onEvent: (ev) => events.push(ev),
    });
    expect(events.some((e) => e.type === "progress")).toBe(true);
    const complete = events.find((e) => e.type === "complete");
    expect(complete.canvas.elements).toHaveLength(1);
    expect(summary).toBe("已创建矩形");
  });
});
