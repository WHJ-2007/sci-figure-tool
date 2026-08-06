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
});

describe("Toolbar 悬浮坞", () => {
  it("顶栏只有画布/导出/设置，左侧坞有工具主按钮与撤销重做", () => {
    render(<Toolbar />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByTitle("导出 SVG")).toBeInTheDocument();
    expect(screen.getByTitle("设置")).toBeInTheDocument();
    expect(screen.getByTitle("工具")).toBeInTheDocument();
    expect(screen.getByTitle("撤销")).toBeInTheDocument();
    expect(screen.getByTitle("重做")).toBeInTheDocument();
    // 子工具默认收在气泡里
    expect(screen.queryByTitle("矩形")).toBeNull();
    expect(screen.queryByTitle("逻辑节点")).toBeNull();
  });

  it("点击工具主按钮展开气泡：图案与逻辑两个分区标题 + 各自子工具", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("工具"));
    expect(screen.getByText("图案")).toBeInTheDocument();
    expect(screen.getByText("逻辑")).toBeInTheDocument();
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
    expect(screen.getByTitle("文字")).toBeInTheDocument();
    expect(screen.getByTitle("逻辑节点")).toBeInTheDocument();
    // 再点主按钮关闭（toggle）
    fireEvent.click(screen.getByTitle("工具"));
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("气泡内点子工具切换工具但不关闭气泡（可连续切换）", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("工具"));
    fireEvent.click(screen.getByTitle("椭圆"));
    expect(useCanvasStore.getState().tool).toBe("ellipse");
    expect(screen.getByTitle("三角形")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("逻辑节点"));
    expect(useCanvasStore.getState().tool).toBe("logic");
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
  });

  it("点击气泡外部关闭气泡", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("工具"));
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("工具主按钮显示当前选中的子工具图标，组内工具时高亮", () => {
    useCanvasStore.getState().setTool("hexagon");
    render(<Toolbar />);
    const btn = screen.getByTitle("工具");
    expect(btn.textContent).toContain("⬡");
    expect(btn.classList.contains("bg-blue-100")).toBe(true);
  });

  it("select 工具时主按钮不高亮且显示光标图标", () => {
    useCanvasStore.getState().setTool("select");
    render(<Toolbar />);
    const btn = screen.getByTitle("工具");
    expect(btn.classList.contains("bg-blue-100")).toBe(false);
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("逻辑节点工具时主按钮高亮", () => {
    useCanvasStore.getState().setTool("logic");
    render(<Toolbar />);
    expect(screen.getByTitle("工具").classList.contains("bg-blue-100")).toBe(true);
  });

  it("逻辑节点按钮为 SVG 图标（圆角框 + 4 锚点圆点）", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("工具"));
    const btn = screen.getByTitle("逻辑节点");
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("circle")).toHaveLength(4);
  });

  it("生成中撤销/重做禁用", () => {
    useCanvasStore.getState().setGenerating(true);
    render(<Toolbar />);
    expect(screen.getByTitle("撤销")).toBeDisabled();
    expect(screen.getByTitle("重做")).toBeDisabled();
  });
});
