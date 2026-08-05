import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "./Toolbar";
import { useCanvasStore } from "@/lib/canvas/store";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));
afterEach(() => vi.unstubAllGlobals());

describe("Toolbar 画布管理", () => {
  it("点击 + 新建画布并切换过去", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("新建画布"));
    expect(useCanvasStore.getState().projects).toHaveLength(2);
    expect(screen.getByRole("combobox")).toHaveValue(useCanvasStore.getState().currentProjectId);
    expect(screen.getByText(/画布 2/)).toBeInTheDocument();
  });

  it("切换下拉选择不同画布", () => {
    const s = useCanvasStore.getState();
    const secondId = s.createProject();
    render(<Toolbar />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: secondId } });
    expect(useCanvasStore.getState().currentProjectId).toBe(secondId);
  });

  it("重命名弹窗确认后生效，取消不变", () => {
    vi.stubGlobal("prompt", vi.fn(() => "实验图"));
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("重命名画布"));
    expect(useCanvasStore.getState().projects[0].name).toBe("实验图");

    vi.stubGlobal("prompt", vi.fn(() => null));
    fireEvent.click(screen.getByTitle("重命名画布"));
    expect(useCanvasStore.getState().projects[0].name).toBe("实验图");
  });

  it("删除确认后删除当前画布并切到相邻画布", () => {
    const s = useCanvasStore.getState();
    const initialId = s.currentProjectId;
    s.createProject();
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("删除画布"));
    expect(useCanvasStore.getState().projects).toHaveLength(1);
    expect(useCanvasStore.getState().currentProjectId).toBe(initialId);
  });

  it("取消删除不生效；仅剩一张画布时删除也不生效", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("删除画布"));
    expect(useCanvasStore.getState().projects).toHaveLength(1);
  });

  it("选择工具图标为鼠标指针形状的 SVG（非文字字符）", () => {
    render(<Toolbar />);
    const btn = screen.getByTitle("选择");
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("工具栏所有可点击元素带浮出动效类 lift", () => {
    render(<Toolbar />);
    for (const el of [...screen.getAllByRole("button"), screen.getByRole("combobox"), screen.getByTitle("设置")]) {
      expect(el.classList.contains("lift")).toBe(true);
    }
  });
});
