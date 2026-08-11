// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { DraftCanvas } from "./draft";
import { buildTools } from "./tools";
import { runAgent } from "./agent";
import { CANVAS_WIDTH } from "../canvas/geometry";
import { estimateTextSize, logicBoxSize, makeElement } from "../canvas/elements";
import type { ArrowElement, FormulaElement, LogicElement, PolylineElement, RectElement, TextElement } from "../canvas/types";

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
    expect(d.flushActivity().join("")).toContain("修改矩形：填充色");
    d.deleteElement({ id: r.id! });
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("活动文案：{x,y} 同映射名去重，白名单外键不出现在文案", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    d.flushActivity();
    // flipH/flipV 已在白名单（镜像属性，AI 可调）→ 显示为"水平镜像"；未知名键 "bogus" 不出现
    d.updateElement({ id: r.id!, patch: { x: 10, y: 20, flipH: true, bogus: 1 } as unknown as Record<string, unknown> });
    const act = d.flushActivity().join("");
    expect(act).toBe("修改矩形：位置、水平镜像");
    expect(act).not.toContain("bogus");
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
    expect(list.elements[0]).toMatchObject({ type: "text", text: "Encoder" });
    // 含画布总览（现有内容范围 + 建议空白起始位置）
    expect(list.overview).toContain("现有内容范围");
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

  it("createElement 文字支持个性化样式（字号/加粗/斜体/对齐/字体）", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "text", x: 10, y: 10, width: 50, height: 20, text: "Encoder", fontSize: 22, bold: true, italic: true, align: "left", fontFamily: "serif" });
    const el = d.serialize().elements[0];
    expect(el).toMatchObject({ fontSize: 22, bold: true, italic: true, align: "left", fontFamily: "serif", text: "Encoder" });
  });

  it("updateElement 支持修改文字样式", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "text", x: 0, y: 0, width: 50, height: 20, text: "A" });
    const res = d.updateElement({ id: r.id!, patch: { bold: true, fontSize: 30, align: "right" } });
    expect(res.ok).toBe(true);
    expect(d.serialize().elements[0]).toMatchObject({ bold: true, fontSize: 30, align: "right" });
  });

  it("updateElement 改文字后自动重算文字宽高（与框大小匹配）", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "text", x: 10, y: 10, width: 50, height: 20, text: "A", fontSize: 20 });
    d.updateElement({ id: r.id!, patch: { text: "你好世界" } });
    const t = d.serialize().elements[0] as TextElement;
    expect(t.width).toBeCloseTo(80);
  });

  it("updateElement 改逻辑节点标题后自动扩框容纳（与框大小匹配）", () => {
    const d = new DraftCanvas([]);
    const l = d.createElement({ type: "logic", x: 10, y: 10, width: 80, height: 40, text: "A", fontSize: 16 });
    d.updateElement({ id: l.id!, patch: { text: "这是一个很长的标题" } });
    const el = d.serialize().elements.find((e) => e.id === l.id)! as LogicElement;
    expect(el.width).toBeGreaterThanOrEqual(estimateTextSize("这是一个很长的标题", 16).width + 16);
  });

  it("文字元素自动置顶：先建文字再建框，文字仍显示在框之上", () => {
    const d = new DraftCanvas([]);
    // 先创建文字（z 低），后创建矩形（默认会盖住文字）
    const t = d.createElement({ type: "text", x: 10, y: 10, width: 50, height: 20, text: "标题" });
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 200, height: 60 });
    const elements = d.serialize().elements;
    const text = elements.find((e) => e.id === t.id)!;
    const rect = elements.find((e) => e.id === r.id)!;
    expect(text.zIndex).toBeGreaterThan(rect.zIndex);
  });

  it("createElement 支持 logic 类型（圆角框 + 标题 + 多行正文）", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "logic", x: 10, y: 10, width: 100, height: 60, text: "编码", body: "说明一\n说明二", fontSize: 16, bold: true });
    expect(r.ok).toBe(true);
    const el = d.serialize().elements[0];
    expect(el.type).toBe("logic");
    expect(el).toMatchObject({ text: "编码", body: "说明一\n说明二", fontSize: 16, bold: true });
  });

  it("createElement/connectElements 支持箭头样式 head（none/single/double）", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const r = d.createElement({ type: "arrow", x: 10, y: 30, width: 200, height: 0, head: "double" });
    const arrow = d.serialize().elements.find((e) => e.id === r.id)!;
    expect((arrow as ArrowElement).head).toBe("double");
    // connectElements 也可指定 head
    d.createElement({ type: "rect", x: 300, y: 0, width: 100, height: 60 });
    const ids = d.serialize().elements.filter((e) => e.type === "rect").map((e) => e.id);
    const c = d.connectElements({ sourceId: ids[0], targetId: ids[1], head: "none" });
    const conn = d.serialize().elements.find((e) => e.id === c.id)! as ArrowElement;
    expect(conn.head).toBe("none");
    // 缺省 = single（未指定 head 的箭头）
    const c2 = d.connectElements({ sourceId: ids[0], targetId: ids[1] });
    expect((d.serialize().elements.find((e) => e.id === c2.id) as ArrowElement).head).toBeUndefined();
  });

  it("updateElement 支持改箭头样式与层级，活动文案用中文名", () => {
    const d = new DraftCanvas([]);
    const rect = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const r = d.createElement({ type: "arrow", x: 10, y: 30, width: 200, height: 0 });
    // 层级调大 = 相对排序提升（ensureTextOnTop 会按 zIndex 重排并归一化，顶层语义保留）
    d.updateElement({ id: rect.id!, patch: { zIndex: 999 } });
    d.updateElement({ id: r.id!, patch: { head: "none" } });
    const els = d.serialize().elements;
    const rectEl = els.find((e) => e.id === rect.id)!;
    const arrowEl = els.find((e) => e.id === r.id)! as ArrowElement;
    expect(arrowEl.head).toBe("none");
    expect(rectEl.zIndex).toBeGreaterThan(arrowEl.zIndex);
    const log = d.flushActivity().join(" ");
    expect(log).toContain("箭头样式");
    expect(log).toContain("层级");
  });

  it("updateElement 修改折点时保留向左/向上的有向箭头几何", () => {
    const d = new DraftCanvas([]);
    const right = d.createElement({ type: "rect", x: 320, y: 220, width: 100, height: 60 });
    const left = d.createElement({ type: "rect", x: 80, y: 80, width: 100, height: 60 });
    const connected = d.connectElements({ sourceId: right.id!, targetId: left.id! });
    const before = d.serialize().elements.find((e) => e.id === connected.id)!;
    expect(before.width).toBeLessThan(0);
    expect(before.height).toBeLessThan(0);
    d.updateElement({ id: connected.id!, patch: { midPoints: [{ x: before.width / 2, y: 0 }] } });
    const after = d.serialize().elements.find((e) => e.id === connected.id)!;
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it("listElements 摘要含正文/箭头样式/层级", () => {
    const d = new DraftCanvas([]);
    const l = d.createElement({ type: "logic", x: 10, y: 10, width: 100, height: 60, text: "编码", body: "要点" });
    const a = d.createElement({ type: "arrow", x: 10, y: 30, width: 200, height: 0, head: "double" });
    const summary = d.listElements();
    expect(summary.elements.find((e) => e.id === l.id)?.body).toBe("要点");
    const arrow = summary.elements.find((e) => e.id === a.id);
    expect(arrow?.head).toBe("double");
    expect(typeof arrow?.zIndex).toBe("number");
  });

  it("updateElement 修改逻辑节点正文后自动扩框容纳（正文与框大小匹配）", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "logic", x: 10, y: 10, width: 100, height: 40, text: "A" });
    d.updateElement({ id: r.id!, patch: { body: "很长的正文内容\n第二行内容" } });
    const el = d.serialize().elements.find((e) => e.id === r.id)! as LogicElement;
    expect(el.height).toBeGreaterThan(40);
  });

  it("connectElements 逻辑节点优先走锚点（源右锚点 → 目标左锚点）", () => {
    const d = new DraftCanvas([]);
    const a = d.createElement({ type: "logic", x: 0, y: 0, width: 100, height: 60, text: "A" });
    const b = d.createElement({ type: "logic", x: 200, y: 0, width: 100, height: 60, text: "B" });
    const r = d.connectElements({ sourceId: a.id!, targetId: b.id! });
    expect(r.ok).toBe(true);
    const arrow = d.serialize().elements.find((e) => e.type === "arrow")!;
    // 源右锚点 (100,30) → 目标左锚点 (200,30)
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(30);
    expect(arrow.width).toBe(100);
    expect(arrow.height).toBe(0);
    expect(arrow.startId).toBe(a.id);
    expect(arrow.endId).toBe(b.id);
  });

  it("connectElements 逻辑节点与矩形混合连接时逻辑侧用锚点", () => {
    const d = new DraftCanvas([]);
    const l = d.createElement({ type: "logic", x: 0, y: 0, width: 100, height: 60, text: "A" });
    const r = d.createElement({ type: "rect", x: 200, y: 0, width: 100, height: 60 });
    d.connectElements({ sourceId: l.id!, targetId: r.id! });
    const arrow = d.serialize().elements.find((e) => e.type === "arrow")!;
    expect(arrow.x).toBe(100); // 源右锚点
    expect(arrow.width).toBe(100); // 终点仍是矩形左边缘
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

  it("applyGraph 一键布局：TB 三节点同列、y 递增、箭头 startId/endId 正确映射", () => {
    const d = new DraftCanvas([]);
    const r = d.applyGraph({
      nodes: [
        { id: "a", text: "输入" },
        { id: "b", text: "处理" },
        { id: "c", text: "输出" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      direction: "TB",
    });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    const logics = els.filter((e) => e.type === "logic");
    expect(logics).toHaveLength(3);
    // dagre 对齐的是节点中心，等宽标题 → 左上角 x 一致
    expect(logics[0].x).toBeCloseTo(logics[1].x, 5);
    expect(logics[1].x).toBeCloseTo(logics[2].x, 5);
    expect(logics[1].y).toBeGreaterThan(logics[0].y);
    expect(logics[2].y).toBeGreaterThan(logics[1].y);
    const arrows = els.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(2);
    const byText = new Map(logics.map((l) => [l.text, l.id]));
    expect(arrows[0].startId).toBe(byText.get("输入"));
    expect(arrows[0].endId).toBe(byText.get("处理"));
    expect(arrows[1].startId).toBe(byText.get("处理"));
    expect(arrows[1].endId).toBe(byText.get("输出"));
    expect(d.flushActivity().join("")).toContain("完成流程图");
  });

  it("applyGraph edges 引用不存在的节点时报错且不创建任何元素", () => {
    const d = new DraftCanvas([]);
    const r = d.applyGraph({
      nodes: [{ id: "a", text: "A" }],
      edges: [{ from: "a", to: "missing" }],
    });
    expect(r.ok).toBe(false);
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("applyGraph 空节点列表报错", () => {
    const d = new DraftCanvas([]);
    const r = d.applyGraph({ nodes: [], edges: [] });
    expect(r.ok).toBe(false);
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("applyGraph 传递正文与填充色，框尺寸自动容纳正文", () => {
    const d = new DraftCanvas([]);
    const r = d.applyGraph({
      nodes: [{ id: "a", text: "预处理", body: "去噪\n归一化", fill: "#eef4ff" }],
      edges: [],
    });
    expect(r.ok).toBe(true);
    const l = d.serialize().elements[0] as LogicElement;
    expect(l).toMatchObject({ text: "预处理", body: "去噪\n归一化", fill: "#eef4ff" });
    expect(l.width).toBeGreaterThanOrEqual(logicBoxSize("预处理", "去噪\n归一化", 14).width);
    expect(l.height).toBeGreaterThanOrEqual(logicBoxSize("预处理", "去噪\n归一化", 14).height);
  });

  it("applyGraph zones 分区容器：浅色虚线圆角框包围成员节点 + 分区标签", () => {
    const d = new DraftCanvas([]);
    const r = d.applyGraph({
      nodes: [
        { id: "a", text: "输入" },
        { id: "b", text: "编码" },
        { id: "c", text: "输出" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      zones: [{ label: "预训练阶段", nodeIds: ["a", "b"] }],
    });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    const zone = els.find((e) => e.type === "rect" && e.dash);
    expect(zone).toBeDefined();
    expect(zone!.fillOpacity).toBe(0.5);
    expect(zone!.dash).toEqual([6, 4]);
    // 分区框必须包围成员节点（含 24px 内边距）
    const logics = els.filter((e) => e.type === "logic");
    const zoneRect = zone!;
    for (const l of logics.filter((x) => ["输入", "编码"].includes(x.text))) {
      expect(l.x).toBeGreaterThanOrEqual(zoneRect.x);
      expect(l.y).toBeGreaterThanOrEqual(zoneRect.y);
      expect(l.x + l.width).toBeLessThanOrEqual(zoneRect.x + zoneRect.width);
      expect(l.y + l.height).toBeLessThanOrEqual(zoneRect.y + zoneRect.height);
    }
    // 分区标签文字
    const label = els.find((e) => e.type === "text" && e.text === "预训练阶段") as TextElement | undefined;
    expect(label).toBeDefined();
    expect(label!.bold).toBe(true);
  });

  it("applyGraph zones 引用不存在的节点时报错且不创建任何元素", () => {
    const d = new DraftCanvas([]);
    const r = d.applyGraph({
      nodes: [{ id: "a", text: "A" }],
      edges: [],
      zones: [{ label: "坏分区", nodeIds: ["a", "missing"] }],
    });
    expect(r.ok).toBe(false);
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("applyMechanism 生成空间区室、膜结构、生物学节点与机制关系", () => {
    const d = new DraftCanvas([]);
    const r = d.applyMechanism({
      title: "EGFR–MAPK 信号转导机制",
      compartments: [
        { id: "extra", label: "胞外空间", kind: "extracellular" },
        { id: "mem", label: "细胞膜", kind: "membrane" },
        { id: "cyto", label: "细胞质", kind: "cytoplasm" },
        { id: "nuc", label: "细胞核", kind: "nucleus" },
      ],
      nodes: [
        { id: "egf", text: "EGF", compartment: "extra", role: "ligand" },
        { id: "egfr", text: "EGFR", compartment: "mem", role: "receptor", detail: "二聚化\n自磷酸化", badge: "P" },
        { id: "ras", text: "RAS-GTP", compartment: "cyto", role: "protein" },
        { id: "erk", text: "ERK", compartment: "cyto", role: "kinase", badge: "P" },
        { id: "gene", text: "靶基因转录", compartment: "nuc", role: "gene" },
      ],
      edges: [
        { from: "egf", to: "egfr", relation: "binding", label: "结合" },
        { from: "egfr", to: "ras", relation: "activation" },
        { from: "ras", to: "erk", relation: "activation", label: "激酶级联" },
        { from: "erk", to: "gene", relation: "translocation", label: "核转位" },
      ],
    });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    expect(els.some((e) => e.type === "text" && e.text === "EGFR–MAPK 信号转导机制")).toBe(true);
    expect(els.some((e) => e.type === "text" && e.text === "细胞膜")).toBe(true);
    expect(els.filter((e) => e.type === "ellipse").length).toBeGreaterThan(10); // 配体 + 膜磷脂 + 徽标
    expect(els.some((e) => e.type === "logic" && e.text === "EGFR")).toBe(true);
    expect(els.some((e) => e.type === "arrow" && e.head === "double")).toBe(true);
    expect(els.some((e) => e.type === "arrow" && e.dash?.join(",") === "8,5")).toBe(true);
    expect(d.flushActivity().join("")).toContain("完成机制图");
  });

  it("applyScientificDiagram 为机器学习流水线生成角色化节点、功能分区和反馈线", () => {
    const d = new DraftCanvas([]);
    const r = d.applyScientificDiagram({
      title: "面向恶意流量检测的深度学习框架",
      subtitle: "训练、评估与在线推理闭环",
      domain: "machine-learning",
      layout: "pipeline",
      groups: [
        { id: "data", label: "数据与特征", semantic: "input" },
        { id: "model", label: "模型训练", semantic: "model" },
        { id: "eval", label: "评估与部署", semantic: "evaluation" },
      ],
      nodes: [
        { id: "raw", text: "网络流量", role: "data", group: "data" },
        { id: "feat", text: "特征张量", role: "tensor", group: "data", detail: "B × T × F" },
        { id: "net", text: "Transformer", role: "neural-network", group: "model", badge: "Train" },
        { id: "metric", text: "F1 / AUC", role: "metric", group: "eval" },
        { id: "pred", text: "威胁分类", role: "output", group: "eval", badge: "Online" },
      ],
      edges: [
        { from: "raw", to: "feat", relation: "data-flow", label: "窗口化" },
        { from: "feat", to: "net", relation: "data-flow", label: "Batch" },
        { from: "net", to: "metric", relation: "dependency" },
        { from: "metric", to: "net", relation: "feedback", label: "调参" },
        { from: "net", to: "pred", relation: "data-flow" },
      ],
      notes: [{ text: "反馈仅作用于训练阶段", target: "net", tone: "neutral" }],
    });
    expect(r.ok).toBe(true);
    expect(r.quality?.passed).toBe(true);
    expect(r.quality?.hardFailures).toBe(0);
    const els = d.serialize().elements;
    expect(els.some((e) => e.type === "text" && e.text === "面向恶意流量检测的深度学习框架")).toBe(true);
    expect(els.filter((e) => e.type === "rect" && e.fillOpacity === 0.42)).toHaveLength(3);
    expect(els.filter((e) => e.type === "rect").length).toBeGreaterThan(5); // 分组 + 堆叠张量 + 注释卡片
    expect(els.some((e) => e.type === "arrow" && e.dash?.join(",") === "8,4" && e.midPoints?.length)).toBe(true);
    expect(els.some((e) => e.type === "text" && e.text === "Train")).toBe(true);
    expect(d.flushActivity().join("")).toContain("完成科研图");
  });

  it("applyPenMotif 用可编辑画笔和基础形状生成科研语义图元", () => {
    const d = new DraftCanvas([]);
    const result = d.applyPenMotif({
      kind: "neural-network",
      x: 120,
      y: 140,
      width: 220,
      height: 150,
      scientificId: "encoder-detail",
      regionId: "model",
    });
    expect(result.ok).toBe(true);
    expect(result.ids?.length).toBeGreaterThan(8);
    const elements = d.serialize().elements;
    expect(elements.filter((e) => e.type === "pen").length).toBeGreaterThan(5);
    expect(elements.some((e) => e.type === "ellipse")).toBe(true);
    expect(elements.every((e) => e.scientificRole === "decoration")).toBe(true);
    expect(elements.every((e) => e.scientificId === "encoder-detail")).toBe(true);
  });

  it("applyPenMotif custom 将归一化笔迹限制在指定边界框", () => {
    const d = new DraftCanvas([]);
    const result = d.applyPenMotif({
      kind: "custom", x: 100, y: 200, width: 120, height: 80,
      strokes: [[{ x: -1, y: 0.5 }, { x: 0.5, y: 2 }, { x: 1, y: 0 }]],
    });
    expect(result.ok).toBe(true);
    const pen = d.serialize().elements.find((e) => e.type === "pen");
    expect(pen?.type === "pen" ? pen.points : []).toEqual([
      { x: 100, y: 240 }, { x: 160, y: 280 }, { x: 220, y: 200 },
    ]);
  });

  it("applyScientificDiagram 长流水线自动折行、分区避碰、注释就近换行且跨行连线正交", () => {
    const d = new DraftCanvas([]);
    const nodes = Array.from({ length: 9 }, (_, i) => ({
      id: `n${i + 1}`,
      text: `阶段 ${i + 1}`,
      role: "process" as const,
      group: i < 7 ? "feature" : "head",
      detail: "执行关键处理并输出中间特征",
    }));
    const edges = nodes.slice(0, -1).map((node, i) => ({ from: node.id, to: nodes[i + 1].id, relation: "data-flow" as const }));
    const result = d.applyScientificDiagram({
      title: "论文级模型流水线",
      domain: "machine-learning",
      layout: "pipeline",
      groups: [
        { id: "feature", label: "特征学习", semantic: "model" },
        { id: "head", label: "任务头", semantic: "evaluation" },
      ],
      nodes,
      edges,
      notes: [{ text: "该说明较长，用于验证注释会在紧邻主图的位置自动换行，而不是被固定到画布最底部。", target: "n7" }],
    });
    expect(result.ok).toBe(true);
    expect(result.quality?.passed).toBe(true);
    const els = d.serialize().elements;
    const boxes = els.filter((e) => e.type === "logic");
    expect(boxes).toHaveLength(9);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
    const groupPanels = els.filter((e) => e.type === "rect" && e.fillOpacity === 0.42);
    expect(groupPanels.length).toBeGreaterThanOrEqual(3); // 第一分区跨行后拆为两个连续面板
    const crossRow = els.find((e) => e.type === "arrow" && e.startId === boxes[5].id && e.endId === boxes[6].id);
    expect(crossRow?.type === "arrow" ? crossRow.midPoints : undefined).toHaveLength(2);
    const noteCard = els.find((e) => e.type === "rect" && e.fillOpacity === 0.7);
    expect(noteCard).toBeTruthy();
    expect(noteCard!.y).toBeLessThan(750);
    const noteLines = els.filter((e) => e.type === "text" && e.fontSize === 12 && e.y >= noteCard!.y && e.y < noteCard!.y + noteCard!.height);
    expect(noteLines.length).toBeGreaterThan(1);
  });

  it("applyScientificDiagram 为网络安全图区分攻击路径、防御关系和信任边界", () => {
    const d = new DraftCanvas([]);
    const r = d.applyScientificDiagram({
      title: "零信任环境下的攻击检测与响应",
      domain: "cybersecurity",
      layout: "layered-lr",
      nodes: [
        { id: "actor", text: "攻击者", role: "threat" },
        { id: "edge", text: "边界网络", role: "network" },
        { id: "ids", text: "入侵检测", role: "defense" },
        { id: "siem", text: "SIEM", role: "storage" },
        { id: "response", text: "自动响应", role: "output" },
      ],
      edges: [
        { from: "actor", to: "edge", relation: "attack", label: "恶意流量" },
        { from: "edge", to: "ids", relation: "trust", label: "身份校验" },
        { from: "ids", to: "siem", relation: "data-flow", label: "告警" },
        { from: "response", to: "edge", relation: "defense", label: "隔离" },
      ],
    });
    expect(r.ok).toBe(true);
    const arrows = d.serialize().elements.filter((e) => e.type === "arrow");
    expect(arrows.some((e) => e.stroke === "#c43d3d")).toBe(true);
    expect(arrows.some((e) => e.stroke === "#16806f")).toBe(true);
    expect(arrows.some((e) => e.head === "double" && e.dash?.join(",") === "3,3")).toBe(true);
  });

  it("applyScientificDiagram 在引用未知分组/节点时不产生半成品", () => {
    const d = new DraftCanvas([]);
    expect(d.applyScientificDiagram({
      title: "非法输入",
      groups: [{ id: "g", label: "分组" }],
      nodes: [{ id: "a", text: "A", role: "data", group: "missing" }],
      edges: [],
    }).ok).toBe(false);
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("applyMechanism 对未知区室和未知节点引用 fail-fast，且不创建元素", () => {
    const d1 = new DraftCanvas([]);
    expect(d1.applyMechanism({
      compartments: [{ id: "cyto", label: "细胞质" }],
      nodes: [{ id: "a", text: "A", compartment: "missing" }],
      edges: [],
    }).ok).toBe(false);
    expect(d1.serialize().elements).toHaveLength(0);

    const d2 = new DraftCanvas([]);
    expect(d2.applyMechanism({
      compartments: [{ id: "cyto", label: "细胞质" }],
      nodes: [{ id: "a", text: "A", compartment: "cyto" }],
      edges: [{ from: "a", to: "missing" }],
    }).ok).toBe(false);
    expect(d2.serialize().elements).toHaveLength(0);
  });

  it("createElement 支持 dash 虚线描边并透传到元素", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60, dash: [8, 4] });
    expect(r.ok).toBe(true);
    expect(d.serialize().elements[0]).toMatchObject({ type: "rect", dash: [8, 4] });
    // 箭头虚线（辅助流语义）
    const a = d.createElement({ type: "arrow", x: 10, y: 10, width: 80, height: 40, dash: [6, 3] });
    expect(a.ok).toBe(true);
    expect(d.serialize().elements.some((e) => e.type === "arrow" && e.dash)).toBe(true);
  });

  it("connectElements 支持 dash 虚线箭头（跳连/梯度回传）", () => {
    const d = new DraftCanvas([]);
    const src = d.createElement({ type: "rect", x: 0, y: 0, width: 60, height: 40 });
    const tgt = d.createElement({ type: "rect", x: 200, y: 0, width: 60, height: 40 });
    const r = d.connectElements({ sourceId: src.id!, targetId: tgt.id!, dash: [8, 4] });
    expect(r.ok).toBe(true);
    const arrow = d.serialize().elements.find((e) => e.type === "arrow")!;
    expect(arrow.dash).toEqual([8, 4]);
    expect(arrow.startId).toBe(src.id);
    expect(arrow.endId).toBe(tgt.id);
  });

  it("updateElement 支持 dash 属性（白名单含 dash）", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const u = d.updateElement({ id: r.id!, patch: { dash: [5, 5] } });
    expect(u.ok).toBe(true);
    expect(d.serialize().elements[0]).toMatchObject({ dash: [5, 5] });
  });

  it("createElement 支持 formula 公式元素（LaTeX 源码 + 衬线斜体），updateElement 重算宽高", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "formula", x: 100, y: 100, width: 80, height: 40, text: "E = mc^2" });
    expect(r.ok).toBe(true);
    const el = d.serialize().elements[0] as FormulaElement;
    expect(el.type).toBe("formula");
    expect(el.text).toBe("E = mc^2");
    expect(el.italic).toBe(true);
    expect(el.fontFamily).toContain("serif");
    // 更新公式内容后宽度随渲染文本（latexToUnicode 后）重算
    const u = d.updateElement({ id: r.id!, patch: { text: "\\frac{a}{b}" } });
    expect(u.ok).toBe(true);
    const el2 = d.serialize().elements[0] as FormulaElement;
    expect(el2.text).toBe("\\frac{a}{b}");
    expect(el2.width).toBeGreaterThan(0);
  });

  it("applyMindMap 生成中心主题 + 一级分支 + 曲线 + 子分支关键词", () => {
    const d = new DraftCanvas([]);
    const r = d.applyMindMap({
      topic: "深度学习",
      branches: [
        { keyword: "数据处理", children: [{ keyword: "归一化" }] },
        { keyword: "模型" },
      ],
    });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    const logics = els.filter((e) => e.type === "logic");
    expect(logics).toHaveLength(3); // 主题 + 2 个一级分支
    const topic = logics.find((l) => l.text === "深度学习")!;
    expect(topic.fontSize).toBe(18);
    expect(topic.bold).toBe(true);
    expect(els.filter((e) => e.type === "curve")).toHaveLength(3); // 主题→2 分支 + 数据→归一化
    expect(els.filter((e) => e.type === "text")).toHaveLength(1);  // 子分支关键词
    expect(d.flushActivity().join("")).toContain("思维导图");
  });

  it("applyMindMap 校验：空主题 / 空分支 / 分支过多报错且不创建元素", () => {
    const d = new DraftCanvas([]);
    expect(d.applyMindMap({ topic: "  ", branches: [] }).ok).toBe(false);
    expect(d.applyMindMap({ topic: "T", branches: [] }).ok).toBe(false);
    expect(d.applyMindMap({ topic: "T", branches: Array.from({ length: 9 }, (_, i) => ({ keyword: `b${i}` })) }).ok).toBe(false);
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("applyChart 柱状图：坐标轴 + 柱 + 刻度 + 数据标签", () => {
    const d = new DraftCanvas([]);
    const r = d.applyChart({ type: "bar", title: "季度销售额", data: [{ label: "Q1", value: 120 }, { label: "Q2", value: 80 }] });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    expect(els.filter((e) => e.type === "arrow")).toHaveLength(2);
    expect(els.filter((e) => e.type === "rect")).toHaveLength(2);
    expect(els.filter((e) => e.type === "text").some((t) => t.text === "季度销售额")).toBe(true);
    expect(d.flushActivity().join("")).toContain("图表");
  });

  it("applyChart 饼图：扇形 + 百分比标签 + 图例", () => {
    const d = new DraftCanvas([]);
    const r = d.applyChart({ type: "pie", data: [{ label: "A", value: 3 }, { label: "B", value: 1 }] });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    expect(els.filter((e) => e.type === "sector")).toHaveLength(2);
    expect(els.filter((e) => e.type === "text").some((t) => t.text === "75%")).toBe(true);
  });

  it("applyChart 多系列折线图：多条无箭头折线 + 图例", () => {
    const d = new DraftCanvas([]);
    const r = d.applyChart({
      type: "line",
      data: [
        { label: "A", value: 1, series: "x" },
        { label: "A", value: 2, series: "y" },
        { label: "B", value: 3, series: "x" },
        { label: "B", value: 4, series: "y" },
      ],
    });
    expect(r.ok).toBe(true);
    const els = d.serialize().elements;
    const lines = els.filter((e) => e.type === "polyline");
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.arrow === false)).toBe(true);
  });

  it("applyChart 元素带 chartId 且登记 charts，快照序列化含 charts", () => {
    const d = new DraftCanvas([]);
    const r = d.applyChart({ type: "bar", title: "T", data: [{ label: "A", value: 1 }, { label: "B", value: 2 }, { label: "C", value: 3 }] });
    expect(r.ok).toBe(true);
    const ser = d.serialize();
    expect(ser.elements.every((e) => e.chartId)).toBe(true);
    expect(ser.charts && Object.keys(ser.charts)).toHaveLength(1);
    expect(ser.charts!["c-"] !== undefined).toBe(false); // chartId 随机，断言存在即可
    expect(Object.values(ser.charts!)[0].type).toBe("bar");
  });

  it("createElement 支持 rx 圆角弧度 / 箭头折点 / 折线点列，updateElement 白名单含 rx/flip", () => {
    const d = new DraftCanvas([]);
    // 圆角矩形：rx 透传
    const r1 = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60, rx: 12 });
    expect(r1.ok).toBe(true);
    const rect = d.serialize().elements[0] as RectElement;
    expect(rect.rx).toBe(12);
    // 箭头折点透传（相对坐标）
    const r2 = d.createElement({ type: "arrow", x: 10, y: 10, width: 80, height: 40, midPoints: [{ x: 40, y: -10 }, { x: 60, y: 30, smooth: true }] });
    expect(r2.ok).toBe(true);
    const arrow = d.serialize().elements.find((e) => e.type === "arrow") as ArrowElement;
    expect(arrow.midPoints).toEqual([{ x: 40, y: -10 }, { x: 60, y: 30, smooth: true }]);
    // 折线点列透传（世界坐标）
    const r3 = d.createElement({ type: "polyline", x: 0, y: 0, width: 0, height: 0, points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 20 }] });
    expect(r3.ok).toBe(true);
    const pl = d.serialize().elements.find((e) => e.type === "polyline") as PolylineElement;
    expect(pl.points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 20 }]);
    // updateElement：rx / flipH / flipV 可改（白名单已含）
    const u = d.updateElement({ id: rect.id, patch: { rx: 4, flipH: true } });
    expect(u.ok).toBe(true);
    expect(d.serialize().elements[0]).toMatchObject({ rx: 4, flipH: true });
  });

  it("applyChart 多图自动平铺：第二张图表自动分配网格位置（0.5 缩放 + 平移），不与第一张重叠", () => {
    const d = new DraftCanvas([]);
    const r1 = d.applyChart({ type: "bar", title: "图一", data: [{ label: "A", value: 1 }, { label: "B", value: 2 }] });
    expect(r1.ok).toBe(true);
    const r2 = d.applyChart({ type: "pie", title: "图二", data: [{ label: "X", value: 3 }, { label: "Y", value: 1 }] });
    expect(r2.ok).toBe(true);
    const els = d.serialize().elements;
    // 两张图共登记 2 个 charts；第二张带 at 平铺参数
    const charts = Object.values(d.serialize().charts ?? {});
    expect(charts).toHaveLength(2);
    expect(charts[1].at).toBeDefined();
    expect(charts[1].at!.scale).toBe(0.5);
    // 两张图的标题文字 x 坐标错开（不叠在默认区域中心）
    const titles = els.filter((e) => e.type === "text" && (e.text === "图一" || e.text === "图二"));
    expect(titles).toHaveLength(2);
    const xs = titles.map((t) => t.x);
    expect(new Set(xs).size).toBe(2); // x 不相同 = 已错开
  });

  it("applyChart 校验：空数据 / 负值 / 未知类型报错；大量数据（>60 项）不设上限可正常创建", () => {
    const d = new DraftCanvas([]);
    expect(d.applyChart({ type: "bar", data: [] }).ok).toBe(false);
    expect(d.applyChart({ type: "bar", data: [{ label: "a", value: -1 }] }).ok).toBe(false);
    // 数据量上限已移除：61 项（如 61 年/61 国）不再被拒绝，可正常生成图表
    const big = d.applyChart({ type: "bar", data: Array.from({ length: 61 }, (_, i) => ({ label: `d${i}`, value: i + 1 })) });
    expect(big.ok).toBe(true);
    expect(d.serialize().elements.length).toBeGreaterThan(0);
    expect(d.applyChart({ type: "weird" as never, data: [{ label: "a", value: 1 }] }).ok).toBe(false);
  });

  it("createElement 把字面 \\n 转成真换行（模型转义修复）", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "logic", x: 0, y: 0, width: 100, height: 60, text: "标题\\n第二行", body: "正文一\\n正文二" });
    const l = d.serialize().elements[0];
    if (l.type === "logic") {
      expect(l.text).toBe("标题\n第二行");
      expect(l.body).toBe("正文一\n正文二");
    }
  });

  it("updateElement 把 patch 里字面 \\n 转成真换行", () => {
    const d = new DraftCanvas([]);
    const t = d.createElement({ type: "text", x: 0, y: 0, width: 100, height: 20, text: "旧" });
    d.updateElement({ id: t.id!, patch: { text: "第一行\\n第二行" } });
    const el = d.serialize().elements[0];
    if (el.type === "text") expect(el.text).toBe("第一行\n第二行");
    // 已有真换行不受影响（不重复转义）
    const l = d.createElement({ type: "logic", x: 0, y: 0, width: 100, height: 60, text: "A", body: "行1\n行2" });
    d.updateElement({ id: l.id!, patch: { body: "行1\n行2\\n行3" } });
    const le = d.serialize().elements.find((e) => e.id === l.id);
    if (le && le.type === "logic") expect(le.body).toBe("行1\n行2\n行3");
  });

  it("updateElement 支持填充/边框透明度与阴影（白名单扩展），文案为中文", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const res = d.updateElement({
      id: r.id!,
      patch: { fillOpacity: 0.5, strokeOpacity: 0.8, shadow: { color: "#000000", blur: 8, dx: 2, dy: 2, opacity: 0.3 } },
    });
    expect(res.ok).toBe(true);
    const el = d.serialize().elements[0];
    expect(el.fillOpacity).toBe(0.5);
    expect(el.strokeOpacity).toBe(0.8);
    expect(el.shadow).toEqual({ color: "#000000", blur: 8, dx: 2, dy: 2, opacity: 0.3 });
    const act = d.flushActivity().join("");
    expect(act).toContain("填充透明度");
    expect(act).toContain("边框透明度");
    expect(act).toContain("阴影");
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

  it("askUser 工具：execute 无副作用，不写画布也不记活动日志", async () => {
    const d = new DraftCanvas([]);
    const tools = buildTools(d);
    const res = await (tools as any).askUser.execute({ question: "请问要画什么数据？" });
    expect(res).toContain("提问");
    expect(d.serialize().elements).toHaveLength(0);
    expect(d.flushActivity()).toHaveLength(0);
  });

  it("searchWeb 工具：配置 key 时返回搜索结果，未配置时返回估算提示", async () => {
    // 未配置 key：直接返回估算提示，不发起网络请求
    const d1 = new DraftCanvas([]);
    const r1 = await (buildTools(d1) as any).searchWeb.execute({ query: "2023 年中国 GDP" });
    expect(r1).toContain("搜索失败");
    expect(r1).toContain("估算");
    // 配置 key：mock Tavily 返回结果
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: "中国 GDP", url: "https://www.stats.gov.cn/x", content: "126 万亿元" }] }),
    }));
    const d2 = new DraftCanvas([]);
    const r2 = await (buildTools(d2, "tvly-test") as any).searchWeb.execute({ query: "2023 年中国 GDP" });
    expect(r2).toContain("126 万亿元");
    expect(r2).toContain("https://www.stats.gov.cn");
    vi.unstubAllGlobals();
  });
});

describe("DraftCanvas onChange", () => {
  it("变更成功触发 onChange，失败操作不触发", () => {
    const onChange = vi.fn();
    const d = new DraftCanvas([], {}, onChange);
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
    // 空画布 clear 无破坏性：直接跳过、不触发 onChange
    d.clear();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(d.pending).toHaveLength(0);
    // 非空画布 clear 挂起确认：不立即清空、不触发 onChange，确认后才清空
    d.createElement({ type: "ellipse", x: 0, y: 0, width: 40, height: 30 });
    expect(onChange).toHaveBeenCalledTimes(4);
    d.clear();
    expect(d.pending.map((p) => p.id)).toEqual(["clear-canvas"]);
    expect(onChange).toHaveBeenCalledTimes(4); // 未确认不触发
    expect(d.serialize().elements).toHaveLength(1);
    d.pending[0].apply();
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(d.serialize().elements).toHaveLength(0);
  });
});

describe("DraftCanvas 破坏性操作确认（仅画布级）", () => {
  it("删除用户已有元素直接删除，不挂起确认", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const userEl = d.serialize().elements[0];
    // 模拟"用户已有"元素：重建 DraftCanvas 把该元素作为初始内容
    const d2 = new DraftCanvas([userEl]);
    const res = d2.deleteElement({ id: userEl.id });
    expect(res.ok).toBe(true);
    expect(d2.pending.length).toBe(0);
    expect(d2.serialize().elements).toHaveLength(0);
  });

  it("AI 本轮创建的元素删除直接删除", () => {
    const d = new DraftCanvas([]);
    const r = d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    const res = d.deleteElement({ id: r.id! });
    expect(res.ok).toBe(true);
    expect(d.pending.length).toBe(0);
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("空画布 clear 不挂起：直接跳过并记录活动", () => {
    const d = new DraftCanvas([]);
    const res = d.clear();
    expect(res.ok).toBe(true);
    expect(d.pending).toHaveLength(0);
    expect(d.flushActivity().join("")).toContain("已是空的");
  });

  it("clear 挂起确认（用户允许后才清空）；newCanvas 挂起等确认", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    d.clear();
    expect(d.pending.map((p) => p.id)).toEqual(["clear-canvas"]);
    // 未确认：画布内容保留
    expect(d.serialize().elements).toHaveLength(1);
    d.pending[0].apply();
    expect(d.serialize().elements).toHaveLength(0);
    d.newCanvas();
    // clear 的挂起条目 apply 后仍留在 pending 列表（会话层管理删除），newCanvas 追加其后
    expect(d.pending.map((p) => p.id)).toContain("new-canvas");
    d.pending[d.pending.length - 1].apply();
    expect(d.serialize().elements).toHaveLength(0);
  });

  it("clear 重复挂起去重：重复调用只挂起一次", () => {
    const d = new DraftCanvas([]);
    d.createElement({ type: "rect", x: 0, y: 0, width: 100, height: 60 });
    d.clear();
    expect(d.clear().note).toMatch(/已在等待确认/);
    expect(d.pending.map((p) => p.id)).toEqual(["clear-canvas"]);
  });

  it("重复挂起去重：newCanvas 重复调用只挂起一次", () => {
    const d = new DraftCanvas([]);
    d.newCanvas();
    expect(d.newCanvas().note).toMatch(/已在等待确认/);
    expect(d.pending.map((p) => p.id)).toEqual(["new-canvas"]);
  });

  it("确认后 applyNewCanvas touch 被移除元素（确认快照 touched 据此加锁）", () => {
    // 关键场景是构造期已存在的用户元素（从未被 touch）：createElement 产生的 id 已自带 touch，
    // 用构造器元素才能模拟「确认后 touched 为空、mergePreserved 全部保留」的原 bug
    const c = makeElement("rect", 10, 10, 60, 40);
    const d = new DraftCanvas([c]);
    d.newCanvas();
    d.pending[0].apply();
    expect(d.serialize().elements).toHaveLength(0);
    expect(d.takeTouched().sort()).toEqual([c.id]);
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
    expect(events[0]).toMatchObject({ type: "status", phase: "thinking" });
    const drawingIndex = events.findIndex((e) => e.type === "status" && e.phase === "drawing");
    const progressIndex = events.findIndex((e) => e.type === "progress");
    const firstSnapshotIndex = events.findIndex((e) => e.type === "snapshot");
    expect(drawingIndex).toBeGreaterThan(0);
    expect(progressIndex).toBeGreaterThan(drawingIndex);
    expect(firstSnapshotIndex).toBeGreaterThan(progressIndex);
    const snapshots = events.filter((e) => e.type === "snapshot");
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].canvas.elements).toHaveLength(1);
    const complete = events.find((e) => e.type === "complete");
    expect(complete.canvas.elements).toEqual(snapshots[snapshots.length - 1].canvas.elements);
    expect(events[events.length - 1].type).toBe("complete");
  });

  it("readCanvas 跨画布读取：返回其他画布摘要并触发 referenced 事件（不切换画布）", async () => {
    mockGenerateText.mockImplementation(async ({ tools, onStepFinish }: any) => {
      const res = await (tools as any).readCanvas.execute({ canvasName: "画布 2" });
      expect(res).toContain("画布 2");
      expect(res).toContain("rect");
      onStepFinish?.({ toolResults: [{ toolName: "readCanvas", result: res }] });
      return { text: "参考了画布 2 的布局" };
    });
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "参考画布 2 的风格画一张" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      canvases: [{ id: "p2", name: "画布 2", elements: [{ type: "rect", x: 0, y: 0, width: 100, height: 60 }] }],
      onEvent: (ev) => events.push(ev),
    });
    // 读取其他画布 → referenced 事件（前端显示「引用了…画布」图标）
    expect(events.some((e) => e.type === "referenced" && e.canvasName === "画布 2")).toBe(true);
    // 不切换画布：无 new-canvas 事件，主生成 normal complete 收尾
    expect(events.some((e) => e.type === "new-canvas")).toBe(false);
    const complete = events.find((e) => e.type === "complete");
    expect(complete).toBeTruthy();
  });

  it("readCanvas 未找到画布时返回可用画布列表提示", async () => {
    mockGenerateText.mockImplementation(async ({ tools, onStepFinish }: any) => {
      const res = await (tools as any).readCanvas.execute({ canvasName: "不存在的画布" });
      expect(res).toContain("未找到画布");
      onStepFinish?.({ toolResults: [] });
      return { text: "没找到" };
    });
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "看看别的画布" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      canvases: [{ id: "p1", name: "画布 1", elements: [] }],
      onEvent: (ev) => events.push(ev),
    });
    // 未读取成功：不触发 referenced
    expect(events.some((e) => e.type === "referenced")).toBe(false);
  });

  it("删除用户已有元素直接删除：complete 收尾，元素已移除", async () => {
    const userEl = makeElement("rect", 0, 0, 100, 60);
    mockGenerateText.mockImplementation(async ({ tools, onStepFinish }: any) => {
      await (tools as any).deleteElement.execute({ id: userEl.id });
      onStepFinish?.({ toolResults: [] });
      return { text: "已删除矩形" };
    });
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "删掉矩形" }],
      canvas: { width: 1600, height: 1000, elements: [userEl] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      onEvent: (ev) => events.push(ev),
    });
    expect(events.some((e) => e.type === "confirm-request")).toBe(false);
    const complete = events.find((e) => e.type === "complete");
    expect(complete).toBeTruthy();
    expect(complete.canvas.elements).toHaveLength(0);
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

  it("手动模式在系统提示中注入模式锁", async () => {
    mockGenerateText.mockClear();
    mockGenerateText.mockImplementation(async ({ system }: any) => ({ text: "好" }));
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "梳理一下深度学习" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      modes: ["mindmap"],
      onEvent: (ev) => events.push(ev),
    });
    const system = mockGenerateText.mock.calls[0][0].system as string;
    expect(system).toContain("思维导图");
    expect(system).toContain("多图种组合");
    expect(system).not.toContain("自动识别");
  });

  it("auto/缺省模式系统提示包含自动识别规则与全部三节", async () => {
    mockGenerateText.mockClear();
    mockGenerateText.mockImplementation(async ({ system }: any) => ({ text: "好" }));
    await runAgent({
      messages: [{ role: "user", content: "画个架构图" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      onEvent: () => {},
    });
    const system = mockGenerateText.mock.calls[0][0].system as string;
    expect(system).toContain("自动识别");
    expect(system).toContain("科研绘图");
    expect(system).toContain("思维导图");
    expect(system).toContain("图表制作");
  });

  it("askUser 工具调用：stopWhen 命中后主生成以 question 事件收尾，不发 complete/confirm-request", async () => {
    mockGenerateText.mockImplementation(async ({ tools, stopWhen, onStepFinish }: any) => {
      // 模拟 AI 提问前先画了元素（防呆场景）：元素操作照常执行，结果按问题优先丢弃
      const res = await (tools as any).createElement.execute({ type: "rect", x: 10, y: 10, width: 100, height: 60 });
      onStepFinish?.({ toolResults: [{ toolName: "createElement", result: res }] });
      // 模拟 AI SDK 的 stopWhen 检测：askUser 命中立即停止，其他工具不命中
      const stops = Array.isArray(stopWhen) ? stopWhen : [stopWhen];
      expect(stops[0]({ steps: [{ toolCalls: [{ toolName: "askUser", input: { question: "请问这个图要表达什么主题？" } }] }] })).toBe(true);
      expect(stops[0]({ steps: [{ toolCalls: [{ toolName: "createElement", input: { type: "rect" } }] }] })).toBe(false);
      return { text: "需要先确认", steps: [{ toolCalls: [{ toolName: "askUser", input: { question: "请问这个图要表达什么主题？" } }] }] };
    });
    const events: any[] = [];
    await runAgent({
      messages: [{ role: "user", content: "帮我画个图" }],
      canvas: { width: 1600, height: 1000, elements: [] },
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      onEvent: (ev) => events.push(ev),
    });
    const question = events.find((e) => e.type === "question");
    expect(question).toBeDefined();
    expect(question.question).toContain("主题");
    expect(events.some((e) => e.type === "complete")).toBe(false);
    expect(events.some((e) => e.type === "confirm-request")).toBe(false);
    // 提问前画的元素不参与任何结果提交（无 complete 画布）
    expect(events.every((e) => e.type !== "complete")).toBe(true);
  });
});
