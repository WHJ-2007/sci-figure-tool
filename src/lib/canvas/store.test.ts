import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "./store";
import { makeElement } from "./elements";

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
});
