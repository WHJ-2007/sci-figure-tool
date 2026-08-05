import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "./store";
import { makeElement, estimateTextSize } from "./elements";
import type { LogicElement, PolylineElement, TextElement } from "./types";

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

  it("updateElement 改字号/加粗也会重算文字宽高", () => {
    const t = makeElement("text", 0, 0, 0, 0, { text: "你好", fontSize: 16 });
    useCanvasStore.getState().addElement(t);
    useCanvasStore.getState().updateElement(t.id, { fontSize: 32, bold: true });
    const el = useCanvasStore.getState().doc.elements[0] as TextElement;
    expect(el.width).toBeCloseTo(32 * 2 * 1.06);
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
    // 生成中：两个中间快照不入栈
    useCanvasStore.getState().applyAISnapshot({ width: 1600, height: 1000, elements: [base.elements[0], makeElement("ellipse", 10, 10, 50, 50)] });
    const result = { width: 1600, height: 1000, elements: [base.elements[0], makeElement("ellipse", 10, 10, 50, 50), makeElement("text", 0, 0, 60, 20, { text: "AI" })] };
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
