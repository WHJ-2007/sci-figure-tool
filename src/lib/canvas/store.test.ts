import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "./store";
import { makeElement } from "./elements";
import type { PolylineElement } from "./types";

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
