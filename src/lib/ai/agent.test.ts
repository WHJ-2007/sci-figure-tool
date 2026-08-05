// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DraftCanvas } from "./draft";
import { buildTools } from "./tools";
import { runAgent } from "./agent";

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

  it("listElements 返回可序列化摘要", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "text", x: 0, y: 0, width: 50, height: 20, text: "Encoder" });
    const list = d.listElements();
    expect(list[0]).toMatchObject({ type: "text", text: "Encoder" });
    expect(JSON.stringify(list)).toContain("Encoder");
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

describe("runAgent", () => {
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
