import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Canvas from "./Canvas";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0 });
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, buttons: 1 });
  fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y });
}

describe("绘制工具", () => {
  it("矩形工具拖拽创建矩形", () => {
    useCanvasStore.getState().setTool("rect");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 100 }, { x: 250, y: 180 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("rect");
    expect(e.x).toBe(100);
    expect(e.y).toBe(100);
    expect(e.width).toBe(150);
    expect(e.height).toBe(80);
  });

  it("文字工具点击创建文字并进入编辑", () => {
    useCanvasStore.getState().setTool("text");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("text");
    expect(document.querySelector('[data-testid="text-editor"]')).toBeTruthy();
  });

  it("双击文字进入编辑、回车提交", () => {
    useCanvasStore.getState().addElement(makeElement("text", 50, 50, 60, 20, { text: "旧文字" }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.doubleClick(svg, { clientX: 80, clientY: 60 });
    const input = document.querySelector('[data-testid="text-editor"]')!;
    fireEvent.change(input, { target: { value: "新文字" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const e = useCanvasStore.getState().doc.elements[0];
    expect((e as any).text).toBe("新文字");
  });
});
