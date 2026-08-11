import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import Canvas from "./Canvas";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import type { ImageElement } from "@/lib/canvas/types";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));
afterEach(() => vi.unstubAllGlobals());

// jsdom 的 Image 不加载图片：stub 为立即触发 onload 的假类
function stubImage(w: number, h: number) {
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = w;
    naturalHeight = h;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  });
}

describe("Canvas", () => {
  it("渲染文档内元素", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 10, 20, 100, 60, { fill: "#123456" }));
    useCanvasStore.getState().addElement(makeElement("text", 0, 0, 50, 20, { text: "Encoder" }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector("rect")).toBeTruthy();
    expect(screen.getByText("Encoder")).toBeInTheDocument();
  });

  it("渲染选中框", () => {
    const a = makeElement("rect", 10, 20, 100, 60);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    // 选中框为 SVG SelectionOverlay：虚线框 + 8 个缩放手柄 + 旋转手柄
    expect(document.querySelector('[data-handle="se"]')).toBeTruthy();
    expect(document.querySelector('[data-handle="rotate"]')).toBeTruthy();
  });

  it("选中带折点的箭头渲染折点手柄", () => {
    const a = makeElement("arrow", 100, 100, 200, 0, { id: "a1", midPoints: [{ x: 200, y: 100 }] });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection(["a1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector('[data-midpoint="0"]')).toBeTruthy();
  });

  it("画布容器屏蔽系统文本选择（select-none，避免 Shift 多选时选中页面文字）", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector("div.relative")!.className).toContain("select-none");
  });

  it("滚轮缩放：锚点换算与最大倍数钳制", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    fireEvent.wheel(document.querySelector("div.relative")!, { clientX: 100, clientY: 100, deltaY: -100 });
    let view = useCanvasStore.getState().view;
    expect(view.scale).toBeCloseTo(1.1, 5);
    expect(view.ox).toBeCloseTo(-10, 5);
    expect(view.oy).toBeCloseTo(-10, 5);

    act(() => useCanvasStore.getState().setView({ scale: 16, ox: 0, oy: 0 }));
    fireEvent.wheel(document.querySelector("div.relative")!, { clientX: 100, clientY: 100, deltaY: -100 });
    view = useCanvasStore.getState().view;
    expect(view.scale).toBe(16);
  });

  it("旋转元素内层 g 带旋转 transform", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 10, 10, 100, 60, { rotation: 45 }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector("g[transform*='rotate(45']")).toBeTruthy();
  });

  it("拖入图片文件：在落点创建图片元素并选中", async () => {
    stubImage(1600, 900);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const container = document.querySelector("div.relative")!;
    const file = new File(["fake"], "p.png", { type: "image/png" });
    // jsdom 的 DragEvent 构造不支持 clientX/dataTransfer：用 Event + 注入属性
    const ev = new Event("drop", { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, "dataTransfer", { value: { files: [file] } });
    Object.defineProperty(ev, "clientX", { value: 300 });
    Object.defineProperty(ev, "clientY", { value: 200 });
    container.dispatchEvent(ev);
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    const el = useCanvasStore.getState().doc.elements[0] as ImageElement;
    expect(el.type).toBe("image");
    expect(el.src.startsWith("data:")).toBe(true);
    // 16:9 缩放至 400×225，以落点 (300,200) 为中心
    expect(el.width).toBeCloseTo(400);
    expect(el.height).toBeCloseTo(225);
    expect(el.x).toBeCloseTo(300 - el.width / 2);
    expect(el.y).toBeCloseTo(200 - el.height / 2);
    expect(useCanvasStore.getState().selection).toEqual([el.id]);
  });

  it("拖入非图片文件不创建元素", async () => {
    stubImage(1600, 900);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const container = document.querySelector("div.relative")!;
    const file = new File(["fake"], "a.txt", { type: "text/plain" });
    fireEvent.drop(container, { dataTransfer: { files: [file] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
  });

  it("Ctrl+V 粘贴图片：在视口中心世界坐标创建（默认视口中心 400,300）", async () => {
    stubImage(800, 400);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const file = new File(["fake"], "p.png", { type: "image/png" });
    const ev = new Event("paste") as ClipboardEvent;
    Object.defineProperty(ev, "clipboardData", {
      value: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    window.dispatchEvent(ev);
    await waitFor(() => expect(useCanvasStore.getState().doc.elements).toHaveLength(1));
    const el = useCanvasStore.getState().doc.elements[0] as ImageElement;
    expect(el.type).toBe("image");
    // 800×400 缩放至 400×200，中心 (400,300) → x=200, y=200
    expect(el.width).toBeCloseTo(400);
    expect(el.height).toBeCloseTo(200);
    expect(el.x).toBeCloseTo(200);
    expect(el.y).toBeCloseTo(200);
  });

  it("文字编辑中 Ctrl+V 不拦截粘贴", async () => {
    stubImage(800, 400);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    useCanvasStore.getState().setEditingText("t1");
    const file = new File(["fake"], "p.png", { type: "image/png" });
    const ev = new Event("paste") as ClipboardEvent;
    let prevented = false;
    Object.defineProperty(ev, "clipboardData", {
      value: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    ev.preventDefault = () => { prevented = true; };
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 20));
    expect(useCanvasStore.getState().doc.elements).toHaveLength(0);
    expect(prevented).toBe(false);
  });

  it("箭头渲染透明加宽命中层（细线扩大点击范围）", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const hit = document.querySelector('line[stroke="transparent"]');
    expect(hit).toBeTruthy();
    expect(hit!.getAttribute("stroke-width")).toBe("12");
    expect(hit!.getAttribute("pointer-events")).toBe("all");
  });

  it("带折点的箭头命中层为透明加宽 polyline", () => {
    useCanvasStore.getState().addElement(makeElement("arrow", 100, 100, 200, 0, { midPoints: [{ x: 200, y: 40 }] }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const hit = document.querySelector('polyline[stroke="transparent"]');
    expect(hit).toBeTruthy();
    expect(hit!.getAttribute("stroke-width")).toBe("12");
  });

  it("右键空白画布弹出样式菜单，选纯色背景写入 doc 并渲染", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    fireEvent.contextMenu(document.querySelector("svg")!, { clientX: 300, clientY: 200 });
    expect(screen.getByTestId("canvas-style-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("画布样式 淡蓝"));
    expect(useCanvasStore.getState().doc.background).toBe("#eef4ff");
    expect(document.querySelector('[data-testid="canvas-bg"]')!.getAttribute("fill")).toBe("#eef4ff");
  });

  it("样式菜单选无填充：background none 且画布透明", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    fireEvent.contextMenu(document.querySelector("svg")!, { clientX: 300, clientY: 200 });
    fireEvent.click(screen.getByLabelText("画布样式 无填充"));
    expect(useCanvasStore.getState().doc.background).toBe("none");
    expect(document.querySelector('[data-testid="canvas-bg"]')!.getAttribute("fill")).toBe("none");
  });

  it("样式菜单选渐变：渲染 linearGradient defs 并引用", () => {
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    fireEvent.contextMenu(document.querySelector("svg")!, { clientX: 300, clientY: 200 });
    fireEvent.click(screen.getByLabelText("画布样式 蓝粉渐变"));
    expect(useCanvasStore.getState().doc.background).toBe("linear:#eef4ff,#fdf2f8");
    expect(document.querySelector("linearGradient#canvas-bg-grad")).toBeTruthy();
    expect(document.querySelector('[data-testid="canvas-bg"]')!.getAttribute("fill")).toBe("url(#canvas-bg-grad)");
  });

  it("元素渲染带悬浮动效层（el-hover，锁定元素除外）", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 10, 10, 100, 60));
    useCanvasStore.getState().setAiLocked(["locked1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const g = document.querySelector('[data-element-id] > g');
    expect(g!.getAttribute("class")).toBe("el-hover");
  });

  it("锁定的元素（AI 编辑中）不参与悬浮动效", () => {
    const a = makeElement("rect", 10, 10, 100, 60, { id: "locked1" });
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setAiLocked(["locked1"]);
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    const g = document.querySelector('[data-element-id] > g');
    expect(g!.getAttribute("class")).toBeNull();
  });
});
