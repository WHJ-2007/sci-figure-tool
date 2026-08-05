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
});
