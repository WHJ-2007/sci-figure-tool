import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import EditorHost from "./EditorHost";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

describe("快捷键", () => {
  it("Delete 删除选中", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("Ctrl+Z 撤销 / Ctrl+Y 重做", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });

  it("Ctrl+D 复制选中", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(2);
  });

  it("Ctrl+D 复制 polyline 时 points 同步偏移", () => {
    const a = makeElement("polyline", 0, 0, 0, 0, { points: [{ x: 10, y: 20 }, { x: 80, y: 90 }] });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    const copy = useCanvasStore.getState().doc.elements[1];
    expect(copy.type).toBe("polyline");
    if (copy.type === "polyline") {
      expect(copy.points[0]).toEqual({ x: 30, y: 40 });
      expect(copy.points[1]).toEqual({ x: 100, y: 110 });
      expect(copy.x).toBe(20);
      expect(copy.y).toBe(20);
    }
  });

  it("输入框内快捷键不拦截", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<EditorHost />);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: "Delete" });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
    document.body.removeChild(ta);
  });

  it("AI 生成中快捷键忽略", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    useCanvasStore.getState().setGenerating(true);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useCanvasStore.getState().doc.elements).toHaveLength(1);
  });
});
