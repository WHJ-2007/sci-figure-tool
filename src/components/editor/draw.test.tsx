import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import Canvas from "./Canvas";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0 });
  // 模拟真实拖拽的多次 pointermove（捕获每帧累积点这类 bug），最后必须移动到终点
  for (let i = 1; i <= 2; i++) {
    fireEvent.pointerMove(el, {
      clientX: from.x + ((to.x - from.x) * i) / 3,
      clientY: from.y + ((to.y - from.y) * i) / 3,
      buttons: 1,
    });
  }
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

  it("polyline 拖拽只保留起点与终点两点", () => {
    useCanvasStore.getState().setTool("polyline");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 100 }, { x: 250, y: 180 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("polyline");
    if (e.type === "polyline") {
      expect(e.points.length).toBe(2);
      expect(e.points[0]).toEqual({ x: 100, y: 100 });
      expect(e.points[1]).toEqual({ x: 250, y: 180 });
    }
  });

  it("过小形状丢弃", () => {
    useCanvasStore.getState().setTool("rect");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 100 }, { x: 102, y: 103 });
    expect(useCanvasStore.getState().doc.elements).toEqual([]);
  });

  it("draw-line 单点点击不创建", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    expect(useCanvasStore.getState().doc.elements).toEqual([]);
  });

  it("Escape 取消不写回", () => {
    useCanvasStore.getState().addElement(makeElement("text", 50, 50, 60, 20, { text: "旧文字" }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.doubleClick(svg, { clientX: 80, clientY: 60 });
    const input = document.querySelector('[data-testid="text-editor"]')!;
    fireEvent.change(input, { target: { value: "新文字" } });
    // 同一次 act 中依次派发 Escape 与 blur：blur 时编辑器尚未卸载，模拟浏览器里
    // Escape 关闭后紧跟的失焦写回（修复前 blur 会把输入内容写回，断言先失败）
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });
    const e = useCanvasStore.getState().doc.elements[0];
    if (e.type === "text") expect(e.text).toBe("旧文字");
    expect(useCanvasStore.getState().editingText).toBeNull();
  });

  it("文字工具双击只创建一个", () => {
    useCanvasStore.getState().setTool("text");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    expect(useCanvasStore.getState().doc.elements.length).toBe(1);
  });

  it("arrow 负向拖拽选中框正常", () => {
    useCanvasStore.getState().setTool("arrow");
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 200, y: 200 }, { x: 100, y: 100 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.type).toBe("arrow");
    expect(e.width).toBe(-100);
    expect(e.height).toBe(-100);
    const rect = document.querySelector('svg rect[stroke="#2563eb"]')!;
    expect(rect.getAttribute("width")).toBe("100");
  });
});
