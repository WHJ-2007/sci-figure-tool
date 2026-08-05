import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
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

  it("缩放手柄中心在包围盒之外（点元素本体/边缘拖动不误触缩放）", () => {
    const a = makeElement("rect", 10, 10, 40, 30);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const nw = document.querySelector('[data-handle="nw"]')!;
    const se = document.querySelector('[data-handle="se"]')!;
    // 元素 bbox (10,10)-(50,40)；手柄中心外移 8px：nw 中心 (2,2)、se 中心 (58,48)
    expect(Number(nw.getAttribute("x"))).toBe(-2);
    expect(Number(nw.getAttribute("y"))).toBe(-2);
    expect(Number(se.getAttribute("x"))).toBe(54);
    expect(Number(se.getAttribute("y"))).toBe(44);
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

  it("群组拖动吸附到其他元素边缘", () => {
    const a = makeElement("rect", 0, 100, 40, 40);
    const b = makeElement("rect", 50, 100, 40, 40);
    const anchor = makeElement("rect", 100, 0, 40, 40);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    useCanvasStore.getState().addElement(anchor);
    useCanvasStore.getState().setSelection([a.id, b.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    // 命中 a（DOM 首序），a 已在选择中 → 保持多选群组
    const el = document.querySelector("[data-element-id]")!;
    // 拖 95px：组 bbox minX=95，距 anchor 左边 100 差 5px（<6 阈值）→ 吸附 dx=5 → 实际位移 100
    drag(el, { x: 20, y: 120 }, { x: 115, y: 120 });
    const doc = useCanvasStore.getState().doc.elements;
    expect(doc.find((e) => e.id === a.id)!.x).toBe(100); // 0 + 95 + 5(snap)
    expect(doc.find((e) => e.id === b.id)!.x).toBe(150); // 50 + 95 + 5
  });

  it("Shift+点击追加多选；再次 shift+点击已选元素保持选区（不移除，避免拖动乱动）", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    const b = makeElement("ellipse", 200, 200, 40, 30);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const els = document.querySelectorAll("[data-element-id]");
    // shift+点击 a → 单选
    fireEvent.pointerDown(els[0], { clientX: 50, clientY: 30, button: 0, shiftKey: true });
    fireEvent.pointerUp(els[0], { clientX: 50, clientY: 30 });
    expect(useCanvasStore.getState().selection).toEqual([a.id]);
    // shift+点击 b → 追加
    fireEvent.pointerDown(els[1], { clientX: 220, clientY: 220, button: 0, shiftKey: true });
    fireEvent.pointerUp(els[1], { clientX: 220, clientY: 220 });
    expect(useCanvasStore.getState().selection).toEqual([a.id, b.id]);
    // 再次 shift+点击已选 a → 保持 [a,b]（点击已选元素后拖动必须跟手，toggle 移除会让"点它拖它"变成别的元素动）
    fireEvent.pointerDown(els[0], { clientX: 50, clientY: 30, button: 0, shiftKey: true });
    fireEvent.pointerUp(els[0], { clientX: 50, clientY: 30 });
    expect(useCanvasStore.getState().selection).toEqual([a.id, b.id]);
  });

  it("Shift+点击追加多选后不松手继续拖动被点击元素：整组跟手移动（回归修复：点 B 拖 B 却只有 A 动）", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    const b = makeElement("ellipse", 200, 200, 40, 30);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const els = document.querySelectorAll("[data-element-id]");
    // shift+点击 b 追加到 [a]
    fireEvent.pointerDown(els[1], { clientX: 220, clientY: 220, button: 0, shiftKey: true });
    fireEvent.pointerUp(els[1], { clientX: 220, clientY: 220 });
    expect(useCanvasStore.getState().selection).toEqual([a.id, b.id]);
    // 不松 shift 直接按住 b 拖动 30px：b 必须在选区内并跟手移动
    fireEvent.pointerDown(els[1], { clientX: 220, clientY: 220, button: 0, shiftKey: true });
    fireEvent.pointerMove(els[1], { clientX: 250, clientY: 220, buttons: 1 });
    fireEvent.pointerUp(els[1], { clientX: 250, clientY: 220 });
    const doc = useCanvasStore.getState().doc.elements;
    expect(doc.find((e) => e.id === b.id)!.x).toBe(230);
    expect(doc.find((e) => e.id === a.id)!.x).toBe(40);
    expect(useCanvasStore.getState().selection).toEqual([a.id, b.id]);
  });

  it("Shift+空白框选追加到现有选区", () => {
    const a = makeElement("rect", 400, 400, 100, 60);
    const b = makeElement("ellipse", 10, 10, 40, 30);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().addElement(b);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    // shift 在空白处框选：b 加入，a 保留
    fireEvent.pointerDown(svg, { clientX: 0, clientY: 0, button: 0, shiftKey: true });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 300, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 300 });
    expect(useCanvasStore.getState().selection).toEqual([a.id, b.id]);
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

describe("小手工具", () => {
  it("hand 工具下拖拽平移视口（内容跟随鼠标）", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    useCanvasStore.getState().setTool("hand");
    const svg = document.querySelector("svg")!;
    drag(svg, { x: 100, y: 50 }, { x: 160, y: 90 });
    const v = useCanvasStore.getState().view;
    expect(v.ox).toBe(60);
    expect(v.oy).toBe(40);
  });

  it("hand 拖拽不选中、不移动元素", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    useCanvasStore.getState().setTool("hand");
    const el = document.querySelector("[data-element-id]")!;
    drag(el, { x: 50, y: 30 }, { x: 80, y: 90 });
    const e = useCanvasStore.getState().doc.elements[0];
    expect(e.x).toBe(10);
    expect(e.y).toBe(10);
    expect(useCanvasStore.getState().view.ox).toBe(30);
    expect(useCanvasStore.getState().view.oy).toBe(60);
  });

  it("hand 模式光标 grab，拖拽中 grabbing", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const svg = document.querySelector("svg")!;
    expect(svg.classList.contains("cursor-grab")).toBe(false);
    act(() => useCanvasStore.getState().setTool("hand"));
    expect(svg.classList.contains("cursor-grab")).toBe(true);
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 50, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 120, clientY: 60, buttons: 1 });
    expect(svg.classList.contains("cursor-grabbing")).toBe(true);
    fireEvent.pointerUp(svg, { clientX: 120, clientY: 60 });
    expect(svg.classList.contains("cursor-grabbing")).toBe(false);
    expect(svg.classList.contains("cursor-grab")).toBe(true);
  });
});
