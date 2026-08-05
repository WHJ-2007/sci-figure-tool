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

describe("Canvas 交互", () => {
  it("点击元素选中", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    // jsdom 不做命中测试，事件必须直接发在元素节点上（生产环境由浏览器命中到图元后 closest 上溯）
    const el = document.querySelector("[data-element-id]")!;
    fireEvent.pointerDown(el, { clientX: 50, clientY: 30, button: 0 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 30 });
    expect(useCanvasStore.getState().selection).toEqual([a.id]);
  });

  it("拖动元素移动", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const el = document.querySelector("[data-element-id]")!;
    drag(el, { x: 50, y: 30 }, { x: 80, y: 90 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.x).toBe(40);
    expect(e.y).toBe(70);
  });

  it("空白处框选", () => {
    const a = makeElement("rect", 400, 400, 100, 60);
    const b = makeElement("ellipse", 10, 10, 40, 30);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 0, y: 0 }, { x: 300, y: 300 });
    expect(useCanvasStore.getState().selection).toEqual([b.id]);
  });

  it("缩放手柄拖动改变宽高", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const se = document.querySelector('[data-handle="se"]')!;
    drag(se, { x: 110, y: 70 }, { x: 160, y: 120 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.width).toBe(150);
    expect(e.height).toBe(110);
  });

  it("旋转手柄拖动改变旋转角", () => {
    const a = makeElement("rect", 100, 100, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const rot = document.querySelector('[data-handle="rotate"]')!;
    // 中心 (150,130)，手柄在正上方 (150,84)，拖到正右方 (194,130) → 顺时针 90°
    drag(rot, { x: 150, y: 84 }, { x: 194, y: 130 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.rotation).toBeCloseTo(90, 0);
  });

  it("空白点击清空选择", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 700, clientY: 500, button: 0 });
    fireEvent.pointerUp(svg, { clientX: 700, clientY: 500 });
    expect(useCanvasStore.getState().selection).toEqual([]);
  });
});
