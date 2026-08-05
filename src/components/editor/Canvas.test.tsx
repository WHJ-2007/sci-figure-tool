import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Canvas from "./Canvas";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));

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

    act(() => useCanvasStore.getState().setView({ scale: 4, ox: 0, oy: 0 }));
    fireEvent.wheel(document.querySelector("div.relative")!, { clientX: 100, clientY: 100, deltaY: -100 });
    view = useCanvasStore.getState().view;
    expect(view.scale).toBe(4);
  });

  it("旋转元素内层 g 带旋转 transform", () => {
    useCanvasStore.getState().addElement(makeElement("rect", 10, 10, 100, 60, { rotation: 45 }));
    render(<Canvas viewportWidth={800} viewportHeight={600} />);
    expect(document.querySelector("g[transform*='rotate(45']")).toBeTruthy();
  });
});
