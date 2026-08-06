import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("生成中 Delete 可删除用户自己的元素（锁定元素不可选，选区不含锁定）", () => {
    const mine = makeElement("rect", 0, 0, 50, 30);
    const aiEl = makeElement("ellipse", 100, 100, 40, 40);
    useCanvasStore.getState().addElement(mine);
    useCanvasStore.getState().addElement(aiEl);
    useCanvasStore.getState().setGenerating(true);
    useCanvasStore.getState().setAiLocked([aiEl.id]);
    useCanvasStore.getState().setSelection([mine.id]);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useCanvasStore.getState().doc.elements.map((e) => e.id)).toEqual([aiEl.id]);
  });

  it("WASD 按下即动：W 上 / A 左 / S 下 / D 右（相机语义，每次 50px）", () => {
    render(<EditorHost />);
    const v0 = useCanvasStore.getState().view;
    fireEvent.keyDown(window, { key: "w" });
    expect(useCanvasStore.getState().view.oy).toBe(v0.oy + 50); // 上：内容下移
    fireEvent.keyUp(window, { key: "w" });
    fireEvent.keyDown(window, { key: "s" });
    expect(useCanvasStore.getState().view.oy).toBe(v0.oy); // 下：回到原位
    fireEvent.keyUp(window, { key: "s" });
    fireEvent.keyDown(window, { key: "a" });
    expect(useCanvasStore.getState().view.ox).toBe(v0.ox + 50); // 左
    fireEvent.keyUp(window, { key: "a" });
    fireEvent.keyDown(window, { key: "d" });
    expect(useCanvasStore.getState().view.ox).toBe(v0.ox); // 右：回到原位
    fireEvent.keyUp(window, { key: "d" });
    expect(useCanvasStore.getState().view.scale).toBe(v0.scale); // 缩放不变
  });

  it("按住 W 持续移动（33ms 一步），松手停止", () => {
    render(<EditorHost />);
    // 渲染后再开假定时器：React 初始渲染用真实调度，keydown 后循环才用假 rAF
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    try {
      const v0 = useCanvasStore.getState().view;
      fireEvent.keyDown(window, { key: "w" });
      expect(useCanvasStore.getState().view.oy).toBe(v0.oy + 50); // 按下即动
      vi.advanceTimersByTime(100);
      // 假 rAF 帧在 t≈16/32/48/64/80/96（16ms 对齐）：t-lastMove≥33 的帧（48/96）各 +50，共 +100
      expect(useCanvasStore.getState().view.oy).toBe(v0.oy + 150);
      fireEvent.keyUp(window, { key: "w" });
      const after = useCanvasStore.getState().view.oy;
      vi.advanceTimersByTime(200);
      expect(useCanvasStore.getState().view.oy).toBe(after); // 松手后不再移动
    } finally {
      vi.useRealTimers();
    }
  });

  it("同时按住 W+D 斜向移动", () => {
    render(<EditorHost />);
    const v0 = useCanvasStore.getState().view;
    fireEvent.keyDown(window, { key: "w" });
    fireEvent.keyDown(window, { key: "d" });
    expect(useCanvasStore.getState().view.ox).toBe(v0.ox - 50);
    // D 的"按下即动"步是完整对角步（W 仍按住，dy 含 w）→ oy 在 W 的 +50 之上再 +50
    expect(useCanvasStore.getState().view.oy).toBe(v0.oy + 100);
    fireEvent.keyUp(window, { key: "w" });
    fireEvent.keyUp(window, { key: "d" });
  });

  it("窗口失焦清空按键：松手前失焦不再移动", () => {
    render(<EditorHost />);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    try {
      const v0 = useCanvasStore.getState().view;
      fireEvent.keyDown(window, { key: "a" });
      expect(useCanvasStore.getState().view.ox).toBe(v0.ox + 50);
      fireEvent.blur(window);
      const after = useCanvasStore.getState().view.ox;
      vi.advanceTimersByTime(200);
      expect(useCanvasStore.getState().view.ox).toBe(after); // blur 后循环停止
    } finally {
      vi.useRealTimers();
    }
  });

  it("WASD 平移不改变选中元素位置", () => {
    const a = makeElement("rect", 0, 0, 50, 50);
    useCanvasStore.getState().addElement(a);
    useCanvasStore.getState().setSelection([a.id]);
    render(<EditorHost />);
    fireEvent.keyDown(window, { key: "d" });
    expect(useCanvasStore.getState().doc.elements[0].x).toBe(0);
    fireEvent.keyUp(window, { key: "d" });
  });

  it("Ctrl+W 等修饰键组合不触发平移（保留浏览器/系统快捷键）", () => {
    render(<EditorHost />);
    const v0 = useCanvasStore.getState().view;
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    expect(useCanvasStore.getState().view.ox).toBe(v0.ox);
    expect(useCanvasStore.getState().view.oy).toBe(v0.oy);
  });

  it("输入框内按 WASD 不触发平移（打字不移动画布）", () => {
    render(<EditorHost />);
    const v0 = useCanvasStore.getState().view;
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(ta, { key: "a" });
    expect(useCanvasStore.getState().view.ox).toBe(v0.ox);
    document.body.removeChild(ta);
  });

  it("AI 生成中 WASD 仍可平移（边看 AI 绘制边导航）", () => {
    useCanvasStore.getState().setGenerating(true);
    render(<EditorHost />);
    const v0 = useCanvasStore.getState().view;
    fireEvent.keyDown(window, { key: "d" });
    expect(useCanvasStore.getState().view.ox).toBe(v0.ox - 50);
    fireEvent.keyUp(window, { key: "d" });
  });
});
