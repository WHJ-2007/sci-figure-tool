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

  it("设置按钮为描边风格 SVG 齿轮图标（非 emoji）", () => {
    render(<Toolbar />);
    const link = screen.getByTitle("设置");
    const svg = link.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("circle")).not.toBeNull();
  });

  it("逻辑气泡内逻辑节点按钮：SVG 图标（圆角框 + 4 锚点圆点），点击切换工具", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("逻辑"));
    const btn = screen.getByTitle("逻辑节点");
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("circle")).toHaveLength(4);
    fireEvent.click(btn);
    expect(useCanvasStore.getState().tool).toBe("logic");
  });
});

describe("Toolbar 工具分组气泡", () => {
  it("工具整合为图案/逻辑两个主按钮，子工具收进气泡（默认不显示）", () => {
    render(<Toolbar />);
    expect(screen.getByTitle("图案")).toBeInTheDocument();
    expect(screen.getByTitle("逻辑")).toBeInTheDocument();
    // 常驻工具保留
    expect(screen.getByTitle("选择")).toBeInTheDocument();
    expect(screen.getByTitle("小手（拖动画布）")).toBeInTheDocument();
    // 子工具默认收在气泡里
    expect(screen.queryByTitle("矩形")).toBeNull();
    expect(screen.queryByTitle("逻辑节点")).toBeNull();
  });

  it("点击图案主按钮展开气泡，再点关闭（toggle）", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("图案"));
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
    expect(screen.getByTitle("文字")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("图案"));
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("气泡内点击子工具切换工具但不关闭气泡（可连续切换）", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("图案"));
    fireEvent.click(screen.getByTitle("椭圆"));
    expect(useCanvasStore.getState().tool).toBe("ellipse");
    expect(screen.getByTitle("三角形")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("箭头"));
    expect(useCanvasStore.getState().tool).toBe("arrow");
    expect(screen.getByTitle("文字")).toBeInTheDocument();
  });

  it("逻辑气泡：逻辑节点点击切换工具，气泡不关闭", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("逻辑"));
    fireEvent.click(screen.getByTitle("逻辑节点"));
    expect(useCanvasStore.getState().tool).toBe("logic");
    expect(screen.getByTitle("逻辑节点")).toBeInTheDocument();
  });

  it("点击气泡外部关闭气泡", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("图案"));
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("图案主按钮显示当前选中的子工具图标，组内工具时高亮", () => {
    useCanvasStore.getState().setTool("hexagon");
    render(<Toolbar />);
    const btn = screen.getByTitle("图案");
    expect(btn.textContent).toContain("⬡");
    expect(btn.classList.contains("bg-blue-100")).toBe(true);
  });

  it("当前工具不在组内时主按钮不高亮", () => {
    useCanvasStore.getState().setTool("select");
    render(<Toolbar />);
    const btn = screen.getByTitle("图案");
    expect(btn.classList.contains("bg-blue-100")).toBe(false);
  });
});
