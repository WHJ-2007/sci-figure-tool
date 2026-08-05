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

  it("缩放视口后拖动元素屏幕跟手（scale=0.25：鼠标屏幕动 40px，元素屏幕动 40px）", () => {
    useCanvasStore.getState().setView({ scale: 0.25, ox: 100, oy: 50 });
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const el = document.querySelector("[data-element-id]")!;
    fireEvent.pointerDown(el, { clientX: 50, clientY: 30, button: 0 });
    // 世界位移 = 屏幕 40px / 0.25 = 160 → 元素屏幕位移 = 160 × 0.25 = 40px，与鼠标一致
    fireEvent.pointerMove(el, { clientX: 90, clientY: 30, buttons: 1 });
    fireEvent.pointerUp(el, { clientX: 90, clientY: 30 });
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(170);
    expect(useCanvasStore.getState().doc.elements[0].y).toBe(10);
  });

  it("拖动中指针移出画布（后续事件派发到 window）仍持续跟随：图形位置与鼠标增量严格一致", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const el = document.querySelector("[data-element-id]")!;
    fireEvent.pointerDown(el, { clientX: 50, clientY: 30, button: 0 });
    // 模拟指针移出 svg：浏览器把 pointermove/up 派发给 window（React 的 svg 监听收不到）
    fireEvent.pointerMove(window, { clientX: 120, clientY: 80, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 100, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 100 });
    const e = useCanvasStore.getState().doc.elements[0];
    // 指针位移 90,70 → 元素跟随 90,70（按下位置 (10,10) 不变，绝对增量跟踪）
    expect(e.x).toBe(100);
    expect(e.y).toBe(80);
  });

  it("拖动中滚轮缩放被锁定（避免视口变化导致换算基准错乱、元素不跟手）", () => {
    const a = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(a);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const el = document.querySelector("[data-element-id]")!;
    fireEvent.pointerDown(el, { clientX: 50, clientY: 30, button: 0 });
    fireEvent.wheel(el, { clientX: 100, clientY: 100, deltaY: -100 });
    expect(useCanvasStore.getState().view.scale).toBe(1);
    fireEvent.pointerUp(el, { clientX: 50, clientY: 30 });
    // 松开后滚轮缩放恢复
    fireEvent.wheel(el, { clientX: 100, clientY: 100, deltaY: -100 });
    expect(useCanvasStore.getState().view.scale).toBeCloseTo(1.1, 5);
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

describe("逻辑节点", () => {
  it("逻辑节点渲染圆角矩形与居中标题", () => {
    const l = makeElement("logic", 100, 100, 120, 60, { text: "处理" });
    useCanvasStore.getState().addElement(l);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const g = document.querySelector("[data-element-id]")!;
    const rect = g.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("6");
    expect(g.querySelector("text")!.textContent).toBe("处理");
  });

  it("选中逻辑节点显示 4 个锚点圆点（bbox 边缘中点）", () => {
    const l = makeElement("logic", 100, 100, 120, 60, { text: "A" });
    useCanvasStore.getState().addElement(l);
    useCanvasStore.getState().setSelection([l.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const dots = document.querySelectorAll("[data-anchor]");
    expect(dots).toHaveLength(4);
    const bySide: Record<string, Element> = {};
    dots.forEach((d) => (bySide[d.getAttribute("data-anchor")!] = d));
    expect(Number(bySide.top.getAttribute("cx"))).toBeCloseTo(160);
    expect(Number(bySide.top.getAttribute("cy"))).toBeCloseTo(100);
    expect(Number(bySide.left.getAttribute("cx"))).toBeCloseTo(100);
    expect(Number(bySide.left.getAttribute("cy"))).toBeCloseTo(130);
    expect(Number(bySide.right.getAttribute("cx"))).toBeCloseTo(220);
    expect(Number(bySide.bottom.getAttribute("cy"))).toBeCloseTo(160);
  });

  it("选中普通矩形不显示锚点", () => {
    const r = makeElement("rect", 10, 10, 100, 60);
    useCanvasStore.getState().addElement(r);
    useCanvasStore.getState().setSelection([r.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelectorAll("[data-anchor]")).toHaveLength(0);
  });

  it("箭头工具绘制时端点吸附到锚点并记录 startId/endId", () => {
    const l = makeElement("logic", 100, 100, 120, 60, { text: "A" });
    useCanvasStore.getState().addElement(l);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    act(() => useCanvasStore.getState().setTool("arrow"));
    const svg = document.querySelector("svg")!;
    // 起点距 left 锚点 (100,130) 5px（<12 阈值）→ 吸附；终点距 right 锚点 (220,130) 5px → 吸附
    fireEvent.pointerDown(svg, { clientX: 95, clientY: 130, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 225, clientY: 130, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 225, clientY: 130 });
    const arrow = useCanvasStore.getState().doc.elements.find((e) => e.type === "arrow")!;
    expect(arrow).toBeDefined();
    expect(arrow.startId).toBe(l.id);
    expect(arrow.endId).toBe(l.id);
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(130);
    expect(arrow.x + arrow.width).toBe(220);
  });

  it("箭头工具悬停时最近锚点高亮（data-anchor-layer 命中标记）", () => {
    const l = makeElement("logic", 100, 100, 120, 60, { text: "A" });
    useCanvasStore.getState().addElement(l);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    act(() => useCanvasStore.getState().setTool("arrow"));
    const svg = document.querySelector("svg")!;
    // 所有逻辑锚点显示为候选圆点
    expect(document.querySelectorAll("[data-anchor-layer]")).toHaveLength(4);
    // 指针悬停到 top 锚点 (160,100) 附近 → 该锚点高亮
    fireEvent.pointerMove(svg, { clientX: 163, clientY: 100 });
    const hl = document.querySelectorAll("[data-anchor-layer][data-active='true']");
    expect(hl).toHaveLength(1);
    expect(hl[0].getAttribute("data-anchor-layer")).toBe("top");
    // 移到远处 → 不高亮
    fireEvent.pointerMove(svg, { clientX: 700, clientY: 500 });
    expect(document.querySelectorAll("[data-anchor-layer][data-active='true']")).toHaveLength(0);
  });
});

describe("画布玻璃边缘", () => {
  it("画布背景为白色矩形且不拦截指针事件", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const bg = document.querySelector("[data-testid='canvas-bg']")!;
    expect(bg).not.toBeNull();
    expect(bg.getAttribute("fill")).toBe("#ffffff");
    expect(bg.getAttribute("pointer-events")).toBe("none");
  });

  it("画布外层为玻璃面板容器（半透明毛玻璃边框包裹 svg）", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const glass = document.querySelector(".glass-canvas")!;
    expect(glass).not.toBeNull();
    expect(glass.querySelector("svg")).not.toBeNull();
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
