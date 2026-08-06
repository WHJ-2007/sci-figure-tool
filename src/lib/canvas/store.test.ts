import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "./store";
import { makeElement, estimateTextSize } from "./elements";
import { layoutChart, PLOT, type ChartSpec } from "./chartLayout";
import type { ArrowElement, LogicElement, PolylineElement, RectElement, SectorElement, TextElement } from "./types";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

describe("canvas store", () => {
  it("addElement 追加元素并分配 zIndex", () => {
    const s = useCanvasStore.getState();
    const a = makeElement("rect", 0, 0, 100, 60);
    s.addElement(a);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    const b = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(b);
    expect(useCanvasStore.getState().doc.elements[1].zIndex).toBeGreaterThan(useCanvasStore.getState().doc.elements[0].zIndex);
  });

  it("updateElement 改属性且入历史可撤销", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().updateElement(a.id, { fill: "#ff0000" });
    expect(useCanvasStore.getState().doc.elements[0].fill).toBe("#ff0000");
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements[0].fill).toBe("#ffffff");
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.elements[0].fill).toBe("#ff0000");
  });

  it("updateElement 修改文字内容后自动重算文字元素宽高（文字与选中框大小匹配）", () => {
    const t = makeElement("text", 0, 0, 0, 0, { text: "A", fontSize: 20 });
    useCanvasStore.getState().addElement(t);
    useCanvasStore.getState().updateElement(t.id, { text: "你好世界" });
    const el = useCanvasStore.getState().doc.elements[0] as TextElement;
    expect(el.width).toBeCloseTo(80);
    expect(el.height).toBeCloseTo(20 * 1.4);
  });

  it("updateElement 修改逻辑节点标题后自动扩展框宽以容纳（文字与框大小匹配）", () => {
    const l = makeElement("logic", 0, 0, 80, 40, { text: "A", fontSize: 16 });
    useCanvasStore.getState().addElement(l);
    useCanvasStore.getState().updateElement(l.id, { text: "这是一个很长的标题" });
    const el = useCanvasStore.getState().doc.elements[0] as LogicElement;
    expect(el.width).toBeGreaterThanOrEqual(estimateTextSize("这是一个很长的标题", 16).width + 16);
    expect(el.x).toBe(0); // 左对齐扩展：x 不变
  });

  it("updateElement 修改逻辑节点正文后自动扩展框高容纳（正文与框大小匹配）", () => {
    const l = makeElement("logic", 0, 0, 100, 40, { text: "A", fontSize: 14 });
    useCanvasStore.getState().addElement(l);
    useCanvasStore.getState().updateElement(l.id, { body: "第一行\n第二行\n第三行" });
    const el = useCanvasStore.getState().doc.elements[0] as LogicElement;
    // 浮点乘加顺序不同会差 1ulp，容差 0.01
    expect(el.height).toBeGreaterThanOrEqual(14 * 1.4 + 3 * 12 * 1.4 + 10 - 0.01);
  });

  it("updateElement 改字号/加粗也会重算文字宽高", () => {
    const t = makeElement("text", 0, 0, 0, 0, { text: "你好", fontSize: 16 });
    useCanvasStore.getState().addElement(t);
    useCanvasStore.getState().updateElement(t.id, { fontSize: 32, bold: true });
    const el = useCanvasStore.getState().doc.elements[0] as TextElement;
    expect(el.width).toBeCloseTo(32 * 2 * 1.06);
  });

  it("reorderElements 按列表顺序重分配 zIndex（第一个最顶层），一步撤销恢复", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    const b = makeElement("ellipse", 10, 10, 50, 50);
    const c = makeElement("text", 20, 20, 80, 20, { text: "T" });
    useCanvasStore.getState().addElements([a, b, c]); // zIndex 1,2,3（c 最顶层）
    // c 移到最底层、a 提到中间：顺序 [b, c, a]
    useCanvasStore.getState().reorderElements([b.id, c.id, a.id]);
    const byId = new Map(useCanvasStore.getState().doc.elements.map((e) => [e.id, e.zIndex]));
    expect(byId.get(b.id)).toBe(3);
    expect(byId.get(c.id)).toBe(2);
    expect(byId.get(a.id)).toBe(1);
    // 一步撤销恢复原层级
    useCanvasStore.getState().undo();
    const back = new Map(useCanvasStore.getState().doc.elements.map((e) => [e.id, e.zIndex]));
    expect(back.get(a.id)).toBe(1);
    expect(back.get(b.id)).toBe(2);
    expect(back.get(c.id)).toBe(3);
  });

  it("reorderElements 未列入列表的元素保持原相对顺序接到尾部", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    const b = makeElement("ellipse", 10, 10, 50, 50);
    useCanvasStore.getState().addElements([a, b]);
    useCanvasStore.getState().reorderElements([b.id]); // 仅提 b 到最顶
    const byId = new Map(useCanvasStore.getState().doc.elements.map((e) => [e.id, e.zIndex]));
    expect(byId.get(b.id)).toBe(2);
    expect(byId.get(a.id)).toBe(1);
  });

  it("deleteElements 删除并支持撤销恢复", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().deleteElements([a.id]);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });

  it("moveElements 批量移动并吸附返回偏移", () => {
    const a = makeElement("rect", 10, 10, 50, 50);
    const b = makeElement("rect", 200, 200, 50, 50);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    useCanvasStore.getState().moveElements([a.id, b.id], 30, -10);
    const elems = useCanvasStore.getState().doc.elements;
    expect(elems[0].x).toBe(40);
    expect(elems[0].y).toBe(0);
    expect(elems[1].x).toBe(230);
    expect(elems[1].y).toBe(190);
  });

  it("selection 单选/多选/清空", () => {
    const s = useCanvasStore.getState();
    const a = makeElement("rect", 0, 0, 10, 10);
    const b = makeElement("ellipse", 0, 0, 10, 10);
    s.addElement(a);
    s.addElement(b);
    s.setSelection([a.id]);
    expect(useCanvasStore.getState().selection).toEqual([a.id]);
    s.setSelection([a.id, b.id]);
    expect(useCanvasStore.getState().selection).toHaveLength(2);
    s.setSelection([]);
    expect(useCanvasStore.getState().selection).toHaveLength(0);
  });

  it("setDoc 整体替换（AI 生成后应用）", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setDoc({ width: 1600, height: 1000, elements: [] });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("applyAISnapshot 替换画布、清空选择且不入历史栈", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    // 生成前基线 = 当前全部元素（ChatPanel 生成开始时设置）：基线内元素允许被 AI 快照替换
    useCanvasStore.getState().setAiBaseline([a.id]);
    useCanvasStore.getState().setSelection([a.id]);
    useCanvasStore.getState().applyAISnapshot({ width: 1600, height: 1000, elements: [] });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    expect(useCanvasStore.getState().selection).toHaveLength(0);
    // undo 弹回 addElement 前的空画布：证明 applyAISnapshot 未入栈（若入栈，undo 会回到有 a 的状态）
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("applyAIResult 以生成前基线入栈，undo 一步回到基线、redo 回到结果", () => {
    const base = { width: 1600, height: 1000, elements: [makeElement("rect", 0, 0, 100, 60)] };
    useCanvasStore.getState().setDoc(base);
    // 生成前基线 = 画布当前元素（ChatPanel 生成开始时设置）：基线内元素允许被 AI 快照替换
    useCanvasStore.getState().setAiBaseline(base.elements.map((e) => e.id));
    // 生成中：两个中间快照不入栈（快照后 AI 触碰的元素计入锁定集，供合并排除与交互锁定）
    const aiEl = makeElement("ellipse", 10, 10, 50, 50);
    useCanvasStore.getState().applyAISnapshot({ width: 1600, height: 1000, elements: [base.elements[0], aiEl] });
    useCanvasStore.getState().setAiLocked([aiEl.id]);
    const result = { width: 1600, height: 1000, elements: [base.elements[0], aiEl, makeElement("text", 0, 0, 60, 20, { text: "AI" })] };
    useCanvasStore.getState().applyAIResult(result, base);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(3);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(3);
  });

  it("addElements 按序分配 zIndex 且不改动入参对象", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    const b = makeElement("ellipse", 10, 10, 50, 50);
    expect(a.zIndex).toBe(0);
    expect(b.zIndex).toBe(0);
    useCanvasStore.getState().addElements([a, b]);
    const elems = useCanvasStore.getState().doc.elements;
    // 按传入顺序分配 1、2（store 内部基于当前最大 zIndex 递增）
    expect(elems[0].zIndex).toBe(1);
    expect(elems[1].zIndex).toBe(2);
    // 入参对象未被改动：store 内部克隆后再改 zIndex
    expect(a.zIndex).toBe(0);
    expect(b.zIndex).toBe(0);
  });

  it("手势快照语义：fast 更新不入历史，commitHistory 记录手势前状态", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);

    // 1) fast 更新本身不入历史：先做一次普通更新入历史（快照含元素 x=0），
    //    再 fast 更新到 x=500，undo 应回到快照的 x=0（fast 未产生历史条目）
    useCanvasStore.getState().updateElement(a.id, { stroke: "#000000" });
    useCanvasStore.getState().updateElementFast(a.id, { x: 500 });
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(500);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(0);

    // 2) 手势流程：交互层在拖动前先 commitHistory（快照=手势前 x=0），
    //    拖动过程全部走 fast 更新，不产生历史条目
    useCanvasStore.getState().commitHistory();
    useCanvasStore.getState().updateElementFast(a.id, { x: 500 });
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(500);
    // 手势结束 undo：弹出的是手势前快照 → x=0（而非 fast 更新后的 500）
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(0);
    // redo：恢复手势最终位置
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(500);
  });

  it("moveElements 平移 polyline 的坐标与各点", () => {
    const p = makeElement("polyline", 0, 0, 100, 100);
    useCanvasStore.getState().addElement(p);
    useCanvasStore.getState().moveElements([p.id], 10, 20);
    const moved = useCanvasStore.getState().doc.elements[0] as PolylineElement;
    expect(moved.x).toBe(10);
    expect(moved.y).toBe(20);
    // 默认点为 (0,0)/(100,100)，整体平移 (10,20)
    expect(moved.points).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 120 },
    ]);
  });

  it("moveElements 平移带折点的箭头：折点为相对坐标，整体移动无需改动", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { midPoints: [{ x: 200, y: 60, smooth: true }, { x: 250, y: 40 }] });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().moveElements([a.id], 30, -20);
    const moved = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    expect(moved.x).toBe(130);
    expect(moved.y).toBe(80);
    // 相对坐标原样保留：箭头移动后折点自动跟随（世界位置 = 新起点 + 相对偏移）
    expect(moved.midPoints).toEqual([
      { x: 200, y: 60, smooth: true },
      { x: 250, y: 40 },
    ]);
  });

  it("deleteElements 删除正在编辑的元素时清空 editingText", () => {
    const a = makeElement("text", 0, 0, 100, 30, { text: "hi" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setEditingText(a.id);
    expect(useCanvasStore.getState().editingText).toBe(a.id);
    useCanvasStore.getState().deleteElements([a.id]);
    expect(useCanvasStore.getState().editingText).toBeNull();
  });
});

describe("多画布", () => {
  it("新建画布并切换，原画布内容保留", () => {
    const s = useCanvasStore.getState();
    const a = makeElement("rect", 0, 0, 100, 60);
    s.addElement(a);
    const first = s.currentProjectId;
    const second = useCanvasStore.getState().createProject();
    expect(second).not.toBe(first);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    expect(useCanvasStore.getState().projects).toHaveLength(2);
    useCanvasStore.getState().setCurrentProject(first);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });

  it("新建画布默认名递增（画布 2、画布 3）", () => {
    useCanvasStore.getState().createProject();
    expect(useCanvasStore.getState().projects[1].name).toBe("画布 2");
    useCanvasStore.getState().createProject();
    expect(useCanvasStore.getState().projects[2].name).toBe("画布 3");
  });

  it("撤销栈按画布隔离", () => {
    const a = makeElement("rect", 0, 0, 100, 60);
    useCanvasStore.getState().addElement(a);
    const first = useCanvasStore.getState().currentProjectId;
    const second = useCanvasStore.getState().createProject();
    useCanvasStore.getState().addElement(makeElement("ellipse", 10, 10, 50, 50));
    // B 画布 undo：回到 B 的空态
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    // 切回 A：undo 作用于 A 的历史（回到 A 的空态）
    useCanvasStore.getState().setCurrentProject(first);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    // A 的 redo 仍可用（历史未被 B 污染）
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    // 切回 B：undo/redo 状态独立
    useCanvasStore.getState().setCurrentProject(second);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });

  it("删除当前画布切到相邻画布，最后一张不可删", () => {
    useCanvasStore.getState().createProject();
    useCanvasStore.getState().createProject();
    const s = useCanvasStore.getState();
    expect(s.projects).toHaveLength(3);
    // 删除中间画布（当前是第 3 张）
    const third = s.currentProjectId;
    s.deleteProject(third);
    const s2 = useCanvasStore.getState();
    expect(s2.projects).toHaveLength(2);
    expect(s2.currentProjectId).not.toBe(third);
    // 删到最后一张不可删
    s2.deleteProject(s2.projects[0].id);
    s2.deleteProject(s2.projects[0].id);
    expect(useCanvasStore.getState().projects).toHaveLength(1);
  });

  it("重命名画布", () => {
    const id = useCanvasStore.getState().currentProjectId;
    useCanvasStore.getState().renameProject(id, "Transformer 图");
    expect(useCanvasStore.getState().projects[0].name).toBe("Transformer 图");
  });
});

describe("删除画布的撤销/重做", () => {
  it("删除当前画布后 undo 恢复并切回，redo 再次删除并切走", () => {
    const s = useCanvasStore.getState();
    const first = s.currentProjectId;
    const second = s.createProject();
    s.deleteProject(second);
    expect(useCanvasStore.getState().projects).toHaveLength(1);
    expect(useCanvasStore.getState().currentProjectId).toBe(first);
    // undo：恢复画布 2 并切回
    useCanvasStore.getState().undo();
    const st = useCanvasStore.getState();
    expect(st.projects).toHaveLength(2);
    expect(st.currentProjectId).toBe(second);
    // redo：再次删除画布 2
    useCanvasStore.getState().redo();
    const st2 = useCanvasStore.getState();
    expect(st2.projects).toHaveLength(1);
    expect(st2.currentProjectId).toBe(first);
  });

  it("删除非当前画布后 undo 恢复但不切换，redo 再次删除", () => {
    const s = useCanvasStore.getState();
    const first = s.currentProjectId;
    const second = s.createProject();
    s.setCurrentProject(first);
    s.deleteProject(second);
    expect(useCanvasStore.getState().projects).toHaveLength(1);
    expect(useCanvasStore.getState().currentProjectId).toBe(first);
    useCanvasStore.getState().undo();
    const st = useCanvasStore.getState();
    expect(st.projects).toHaveLength(2);
    expect(st.currentProjectId).toBe(first);
    expect(st.projects.map((p) => p.id)).toContain(second);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().projects).toHaveLength(1);
    expect(useCanvasStore.getState().currentProjectId).toBe(first);
  });

  it("删除的画布恢复后内容与撤销栈完好", () => {
    const s = useCanvasStore.getState();
    const first = s.currentProjectId;
    const a = makeElement("rect", 0, 0, 100, 60);
    s.addElement(a);
    const second = s.createProject();
    s.deleteProject(second);
    useCanvasStore.getState().undo();
    const st = useCanvasStore.getState();
    expect(st.projects).toHaveLength(2);
    expect(st.doc.elements).toHaveLength(0); // 恢复的画布 2 是新建的空画布
    // 切回画布 1：内容仍在，undo/redo 未受影响
    useCanvasStore.getState().setCurrentProject(first);
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });

  it("恢复后做编辑打断重做链：redo 不再重复删除画布", () => {
    const s = useCanvasStore.getState();
    const second = s.createProject();
    s.deleteProject(second);
    useCanvasStore.getState().undo();
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 50, 30));
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().projects).toHaveLength(2);
  });

  it("删除中间画布后恢复回到原位置", () => {
    const s = useCanvasStore.getState();
    const first = s.currentProjectId;
    const second = s.createProject();
    const third = s.createProject();
    s.setCurrentProject(first);
    s.deleteProject(second);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().projects.map((p) => p.id)).toEqual([first, second, third]);
  });
});

describe("applyChartEdit", () => {
  it("生成图表：元素带 chartId 并登记 charts，一步撤销移除", () => {
    const s = useCanvasStore.getState();
    const spec: ChartSpec = { type: "bar", title: "销售", data: [{ label: "Q1", value: 10 }, { label: "Q2", value: 20 }, { label: "Q3", value: 15 }] };
    const els = layoutChart(spec).map((e) => ({ ...e, chartId: "c1" }));
    s.applyChartEdit("c1", spec, els, []);
    const st = useCanvasStore.getState();
    expect(st.doc.charts?.["c1"]).toEqual(spec);
    expect(st.doc.elements.filter((e) => e.chartId === "c1").length).toBeGreaterThan(0);
    st.undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("编辑图表：替换旧元素并更新 charts，一步撤销恢复旧图", () => {
    const s = useCanvasStore.getState();
    const spec1: ChartSpec = { type: "bar", data: [{ label: "A", value: 1 }, { label: "B", value: 2 }, { label: "C", value: 3 }] };
    const els1 = layoutChart(spec1).map((e) => ({ ...e, chartId: "c1" }));
    s.applyChartEdit("c1", spec1, els1, []);
    const oldIds = useCanvasStore.getState().doc.elements.filter((e) => e.chartId === "c1").map((e) => e.id);
    const spec2: ChartSpec = { type: "pie", data: [{ label: "X", value: 4 }, { label: "Y", value: 6 }, { label: "Z", value: 5 }] };
    const els2 = layoutChart(spec2).map((e) => ({ ...e, chartId: "c1" }));
    useCanvasStore.getState().applyChartEdit("c1", spec2, els2, oldIds);
    const st = useCanvasStore.getState();
    expect(st.doc.charts?.["c1"].type).toBe("pie");
    expect(st.doc.elements.filter((e) => e.chartId === "c1").length).toBe(els2.length);
    st.undo();
    expect(useCanvasStore.getState().doc.elements.length).toBe(els1.length);
    expect(useCanvasStore.getState().doc.charts?.["c1"].type).toBe("bar");
  });
});

describe("aiLockedIds 与快照合并", () => {
  it("快照不包含用户生成中新增的元素时保留该元素", () => {
    const s = useCanvasStore.getState();
    const mine = makeElement("rect", 0, 0, 50, 30);
    s.addElement(mine);
    s.setAiBaseline(s.doc.elements.map((e) => e.id).filter((id) => id !== mine.id));
    // AI 快照只含它自己的元素：用户生成中新增的 mine 应被保留
    const aiEl = makeElement("ellipse", 100, 100, 40, 40);
    s.applyAISnapshot({ width: 1600, height: 1000, elements: [aiEl] });
    const ids = useCanvasStore.getState().doc.elements.map((e) => e.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(aiEl.id);
  });

  it("AI 已触碰的元素不因快照合并被保留（锁定集内）", () => {
    const s = useCanvasStore.getState();
    const aiEl = makeElement("rect", 0, 0, 50, 30);
    s.addElement(aiEl);
    s.setAiBaseline([]);
    s.setAiLocked([aiEl.id]);
    s.applyAISnapshot({ width: 1600, height: 1000, elements: [] }); // AI 删掉了它
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("生成前的元素被 AI 删除时不被快照合并保留", () => {
    const s = useCanvasStore.getState();
    const old = makeElement("rect", 0, 0, 50, 30);
    s.addElement(old);
    s.setAiBaseline([old.id]);
    s.applyAISnapshot({ width: 1600, height: 1000, elements: [] });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });
});

describe("画布背景", () => {
  it("setBackground 设置背景并入历史，undo 恢复缺省、redo 恢复设置", () => {
    const s = useCanvasStore.getState();
    s.setBackground("#eef4ff");
    expect(useCanvasStore.getState().doc.background).toBe("#eef4ff");
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.background).toBeUndefined();
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.background).toBe("#eef4ff");
  });

  it("setBackground 传 undefined 清除背景（回到缺省纯白语义）", () => {
    useCanvasStore.getState().setBackground("#eef4ff");
    useCanvasStore.getState().setBackground(undefined);
    expect(useCanvasStore.getState().doc.background).toBeUndefined();
  });
});

describe("A5 画布切换：AI 锁定/基线随项目切换重置", () => {
  it("setCurrentProject 清空 aiLockedIds/aiBaselineIds", () => {
    useCanvasStore.getState().createProject();
    const second = useCanvasStore.getState().currentProjectId;
    const first = useCanvasStore.getState().projects.find((p) => p.id !== second)!.id;
    useCanvasStore.getState().setAiLocked(["e1"]);
    useCanvasStore.getState().setAiBaseline(["e1"]);
    useCanvasStore.getState().setCurrentProject(first);
    expect(useCanvasStore.getState().aiLockedIds).toEqual([]);
    expect(useCanvasStore.getState().aiBaselineIds).toEqual([]);
  });

  it("createProject 新建画布时清空 AI 锁定", () => {
    useCanvasStore.getState().setAiLocked(["e1"]);
    useCanvasStore.getState().setAiBaseline(["e1"]);
    useCanvasStore.getState().createProject();
    expect(useCanvasStore.getState().aiLockedIds).toEqual([]);
    expect(useCanvasStore.getState().aiBaselineIds).toEqual([]);
  });

  it("deleteProject 删除当前画布 / undo 恢复 / redo 再切走：全部清空 AI 锁定", () => {
    const first = useCanvasStore.getState().currentProjectId;
    useCanvasStore.getState().createProject();
    const second = useCanvasStore.getState().currentProjectId;
    useCanvasStore.getState().setAiLocked(["e1"]);
    useCanvasStore.getState().deleteProject(second);
    expect(useCanvasStore.getState().aiLockedIds).toEqual([]);
    expect(useCanvasStore.getState().currentProjectId).toBe(first);
    useCanvasStore.getState().setAiLocked(["e1"]);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().currentProjectId).toBe(second);
    expect(useCanvasStore.getState().aiLockedIds).toEqual([]);
    useCanvasStore.getState().setAiLocked(["e1"]);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().currentProjectId).toBe(first);
    expect(useCanvasStore.getState().aiLockedIds).toEqual([]);
  });
});

describe("B4 多选旋转 rotateSelection", () => {
  it("两个矩形绕包围盒中心旋转 90°，位置与 rotation 均更新", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 100, 60));
    useCanvasStore.getState().addElement(makeElement("rect", 200, 0, 100, 60));
    useCanvasStore.getState().setSelection([useCanvasStore.getState().doc.elements[0].id, useCanvasStore.getState().doc.elements[1].id]);
    useCanvasStore.getState().rotateSelection(90);
    const [a, b] = useCanvasStore.getState().doc.elements;
    // 包围盒中心 (150,30)；A 左上角 (0,0)→(180,-120)（元素中心 (50,30)→(150,-70)）
    expect(a.x).toBeCloseTo(180, 5);
    expect(a.y).toBeCloseTo(-120, 5);
    expect(a.rotation).toBeCloseTo(90, 5);
    // B 左上角 (200,0)→(180,80)（元素中心 (250,30)→(150,130)）
    expect(b.x).toBeCloseTo(180, 5);
    expect(b.y).toBeCloseTo(80, 5);
    expect(b.rotation).toBeCloseTo(90, 5);
  });

  it("polyline 点列绕包围盒中心旋转（世界坐标）", () => {
    useCanvasStore.getState().addElement(makeElement("polyline", 0, 0, 0, 0, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    useCanvasStore.getState().addElement(makeElement("rect", 0, 100, 100, 60));
    useCanvasStore.getState().setSelection(useCanvasStore.getState().doc.elements.map((e) => e.id));
    useCanvasStore.getState().rotateSelection(90);
    const pl = useCanvasStore.getState().doc.elements[0] as PolylineElement;
    // 包围盒中心 (50,80)，(0,0)→(130,30)，(100,0)→(130,130)
    expect(pl.points[0].x).toBeCloseTo(130, 5);
    expect(pl.points[0].y).toBeCloseTo(30, 5);
    expect(pl.points[1].x).toBeCloseTo(130, 5);
    expect(pl.points[1].y).toBeCloseTo(130, 5);
  });

  it("箭头 midPoints 相对坐标随元素位置一起旋转", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 0, 0, 100, 0, { midPoints: [{ x: 50, y: 40 }] }));
    useCanvasStore.getState().addElement(makeElement("rect", 200, 0, 100, 60));
    useCanvasStore.getState().setSelection(useCanvasStore.getState().doc.elements.map((e) => e.id));
    useCanvasStore.getState().rotateSelection(90);
    const arrow = useCanvasStore.getState().doc.elements[0] as ArrowElement;
    // 包围盒中心 (150,30)；箭头起点 (0,0)→(180,-120)，折点世界 (50,40)→(140,-70)，相对 →(-40,50)
    expect(arrow.x).toBeCloseTo(180, 5);
    expect(arrow.y).toBeCloseTo(-120, 5);
    expect(arrow.midPoints![0].x).toBeCloseTo(-40, 5);
    expect(arrow.midPoints![0].y).toBeCloseTo(50, 5);
  });

  it("未选满两个元素时空操作", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 100, 60));
    useCanvasStore.getState().setSelection([useCanvasStore.getState().doc.elements[0].id]);
    const before = useCanvasStore.getState().doc;
    useCanvasStore.getState().rotateSelection(45);
    expect(useCanvasStore.getState().doc).toBe(before);
  });

  it("undo 一步恢复旋转前状态", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 0, 0, 100, 60));
    useCanvasStore.getState().addElement(makeElement("rect", 200, 0, 100, 60));
    useCanvasStore.getState().setSelection(useCanvasStore.getState().doc.elements.map((e) => e.id));
    useCanvasStore.getState().rotateSelection(90);
    useCanvasStore.getState().undo();
    const [a, b] = useCanvasStore.getState().doc.elements;
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    expect(a.rotation).toBe(0);
    expect(b.x).toBe(200);
    expect(b.y).toBe(0);
    expect(b.rotation).toBe(0);
  });
});

describe("C 图表公式化 bind 联动", () => {
  function pieChart() {
    const spec: ChartSpec = { type: "pie", data: [{ label: "A", value: 50 }, { label: "B", value: 30 }, { label: "C", value: 20 }] };
    useCanvasStore.getState().applyChartEdit("c1", spec, layoutChart(spec, "c1"), []);
  }

  it("updateChartDrag 实时改数据 + 扇形角度与百分比标签跟手（不入历史）", () => {
    pieChart();
    useCanvasStore.getState().updateChartDrag("c1", 0, 90);
    const doc = useCanvasStore.getState().doc;
    expect(doc.charts!["c1"].data[0].value).toBe(90);
    const sec = doc.elements.find((e) => e.type === "sector" && e.bind?.index === 0)! as SectorElement;
    // total=140 → sweep = 90/140×2π（拖动路径先夹紧数值，角度按新占比跟手）
    expect(sec.endAngle - sec.startAngle).toBeCloseTo((90 / 140) * Math.PI * 2, 5);
    const label = doc.elements.find((e) => e.type === "text" && e.bind?.role === "pie-label" && e.bind.index === 0)! as TextElement;
    expect(label.text).toBe("64%");
  });

  it("拖动全流程：recomputeChart 整图重排替换绑定元素（标签/图例同步），一步撤销回到拖动前", () => {
    pieChart();
    const originalId = useCanvasStore.getState().doc.elements.find((e) => e.type === "sector" && e.bind?.index === 0)!.id;
    const baseline = useCanvasStore.getState().doc;
    useCanvasStore.getState().updateChartDrag("c1", 0, 90);
    useCanvasStore.getState().recomputeChart("c1", baseline);
    const doc = useCanvasStore.getState().doc;
    // 全部绑定元素被新元素替换（旧 id 消失），图例与标签按新数据重排
    expect(doc.elements.some((e) => e.id === originalId)).toBe(false);
    const labels = doc.elements.filter((e) => e.type === "text" && e.bind?.role === "pie-label") as TextElement[];
    expect(labels.map((l) => l.text)).toEqual(["64%", "21%", "14%"]);
    expect(doc.elements.filter((e) => e.type === "sector")).toHaveLength(3);
    // 一步撤销：回到拖动前（原 id 恢复、数据 50/30/20）
    useCanvasStore.getState().undo();
    const back = useCanvasStore.getState().doc;
    expect(back.charts!["c1"].data[0].value).toBe(50);
    expect(back.elements.some((e) => e.id === originalId)).toBe(true);
  });

  it("updateChartDrag 柱状图：柱体 y/height 与数值标签跟随新数值", () => {
    const spec: ChartSpec = { type: "bar", data: [{ label: "Q1", value: 120 }, { label: "Q2", value: 80 }] };
    useCanvasStore.getState().applyChartEdit("c2", spec, layoutChart(spec, "c2"), []);
    const plotH = PLOT.bottom - PLOT.top;
    useCanvasStore.getState().updateChartDrag("c2", 0, 60);
    const doc = useCanvasStore.getState().doc;
    expect(doc.charts!["c2"].data[0].value).toBe(60);
    const bar = doc.elements.find((e) => e.type === "rect" && e.bind?.role === "bar" && e.bind.index === 0)! as RectElement;
    // y 上限按当前数据 niceScale(80).max = 80（拖动中比例尺自适应）
    expect(bar.height).toBeCloseTo((60 / 80) * plotH, 5);
    expect(bar.y).toBeCloseTo(PLOT.bottom - (60 / 80) * plotH, 5);
    const label = doc.elements.find((e) => e.type === "text" && e.bind?.role === "bar-label" && e.bind.index === 0)! as TextElement;
    expect(label.text).toBe("60");
  });

  it("detachChart：全部绑定元素移除 bind/chartId 变普通元素，charts 登记删除，可自由编辑；不入历史", () => {
    pieChart();
    useCanvasStore.getState().detachChart("c1");
    const doc = useCanvasStore.getState().doc;
    expect(doc.charts?.["c1"]).toBeUndefined();
    expect(doc.elements.some((e) => e.bind)).toBe(false);
    expect(doc.elements.some((e) => e.chartId)).toBe(false);
    // 不入历史：undo 回到最近一次提交（applyChartEdit 前 = 空画布），关联不会恢复
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("解除关联后元素变普通元素：可自由改色（updateElement 正常入历史）", () => {
    pieChart();
    useCanvasStore.getState().detachChart("c1");
    const sec = useCanvasStore.getState().doc.elements.find((e) => e.type === "sector")!;
    useCanvasStore.getState().updateElement(sec.id, { fill: "#ff0000" });
    expect(useCanvasStore.getState().doc.elements.find((e) => e.id === sec.id)!.fill).toBe("#ff0000");
    // 一步撤销回到解除关联后的状态（图表元素仍在，只是去绑定了）
    useCanvasStore.getState().undo();
    const back = useCanvasStore.getState().doc;
    expect(back.elements.find((e) => e.id === sec.id)!.fill).toBe("#eef4ff");
    expect(back.elements.some((e) => e.bind)).toBe(false);
  });
});
