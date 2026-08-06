import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "./Toolbar";
import { useCanvasStore } from "@/lib/canvas/store";
import { exportSvgFile, exportPng } from "@/lib/canvas/exporter";

// 导出在 jsdom 依赖 URL.createObjectURL（未实现），mock 掉文件导出
vi.mock("@/lib/canvas/exporter", () => ({
  exportSvgFile: vi.fn(),
  exportPng: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  useCanvasStore.setState(useCanvasStore.getInitialState());
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("Toolbar 画布管理", () => {
  it("点击 + 新建画布并作为标签切换过去", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("新建画布"));
    expect(useCanvasStore.getState().projects).toHaveLength(2);
    expect(useCanvasStore.getState().currentProjectId).toBe(useCanvasStore.getState().projects[1].id);
    const tabs = screen.getAllByTestId("project-tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toContain("画布 1");
    expect(tabs[1].textContent).toContain("画布 2");
  });

  it("点击标签切换不同画布，当前标签高亮", () => {
    const s = useCanvasStore.getState();
    const secondId = s.createProject();
    render(<Toolbar />);
    fireEvent.click(screen.getByText("画布 1"));
    expect(useCanvasStore.getState().currentProjectId).toBe(s.projects[0].id);
    fireEvent.click(screen.getByText("画布 2"));
    expect(useCanvasStore.getState().currentProjectId).toBe(secondId);
    const activeTab = screen.getAllByTestId("project-tab").find((t) => t.getAttribute("data-active") === "true")!;
    expect(activeTab.textContent).toContain("画布 2");
  });

  it("右键标签弹重命名菜单，确认后生效，取消不变", () => {
    vi.stubGlobal("prompt", vi.fn(() => "实验图"));
    render(<Toolbar />);
    fireEvent.contextMenu(screen.getAllByTestId("project-tab")[0]);
    fireEvent.click(screen.getByTitle("重命名"));
    expect(useCanvasStore.getState().projects[0].name).toBe("实验图");
    expect(screen.getByText("实验图")).toBeInTheDocument();

    vi.stubGlobal("prompt", vi.fn(() => null));
    fireEvent.contextMenu(screen.getAllByTestId("project-tab")[0]);
    fireEvent.click(screen.getByTitle("重命名"));
    expect(useCanvasStore.getState().projects[0].name).toBe("实验图");
  });

  it("右键菜单点击外部关闭", () => {
    render(<Toolbar />);
    fireEvent.contextMenu(screen.getAllByTestId("project-tab")[0]);
    expect(screen.getByTitle("重命名")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTitle("重命名")).toBeNull();
  });

  it("删除画布无需确认：点当前标签 × 直接删除并切到相邻画布", () => {
    const s = useCanvasStore.getState();
    const initialId = s.currentProjectId;
    s.createProject();
    render(<Toolbar />);
    // 新建后当前画布是「画布 2」，点它的 × 删除
    fireEvent.click(screen.getByTitle("删除画布 画布 2"));
    expect(useCanvasStore.getState().projects).toHaveLength(1);
    expect(useCanvasStore.getState().currentProjectId).toBe(initialId);
  });

  it("仅剩一张画布时删除不生效", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("删除画布 画布 1"));
    expect(useCanvasStore.getState().projects).toHaveLength(1);
  });

  it("工具栏所有可点击元素带浮出动效类 lift", () => {
    render(<Toolbar />);
    for (const el of [...screen.getAllByRole("button"), screen.getByTitle("设置")]) {
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
  it("顶栏只有画布标签/导出/设置；坞内撤销/重做最上，依次选择/图形/文本框/逻辑/图表", () => {
    render(<Toolbar />);
    expect(screen.getAllByTestId("project-tab").length).toBeGreaterThan(0);
    expect(screen.getByTitle("导出")).toBeInTheDocument();
    expect(screen.getByTitle("设置")).toBeInTheDocument();
    // 顶栏重命名按钮已移除（改右键标签菜单）
    expect(screen.queryByTitle("重命名画布")).toBeNull();
    const dock = screen.getByTitle("撤销").closest(".fixed")!;
    const titles = [...dock.querySelectorAll("button")].map((b) => b.getAttribute("title"));
    expect(titles).toEqual(["撤销", "重做", "选择", "图形", "箭头", "文本框", "逻辑", "图表", "导入"]);
    // 子工具默认收在气泡里
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("导入按钮为描边 SVG 图片图标；点击打开图片文件选择器", () => {
    render(<Toolbar />);
    const btn = screen.getByTitle("导入");
    expect(btn.querySelector("svg")).not.toBeNull();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("image/*");
    const spy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalled();
  });

  it("导出菜单：点导出图标弹 SVG/PNG 选项，选择后调用对应导出并关闭菜单", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("导出"));
    expect(screen.getByTitle("导出 SVG")).toBeInTheDocument();
    expect(screen.getByTitle("导出 PNG")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("导出 SVG"));
    expect(exportSvgFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle("导出 SVG")).toBeNull();
    // PNG：重新打开菜单选择
    fireEvent.click(screen.getByTitle("导出"));
    fireEvent.click(screen.getByTitle("导出 PNG"));
    expect(exportPng).toHaveBeenCalledTimes(1);
  });

  it("导出菜单点击外部关闭", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("导出"));
    expect(screen.getByTitle("导出 PNG")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTitle("导出 PNG")).toBeNull();
  });

  it("箭头工具为简单直箭头 SVG 图标（直线 + 箭头尖，无弯折、无字符箭头）", () => {
    render(<Toolbar />);
    // 箭头是与图形平级的独立常驻坞按钮，无需展开气泡
    const btn = screen.getByTitle("箭头");
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    const paths = svg!.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    // 第一段是水平直线，第二段是箭头尖
    expect(paths[0].getAttribute("d")).toMatch(/M[^L]+h\d+/);
    expect(paths[1].getAttribute("d")).toMatch(/l-?7/);
    // 不再用文本字符 "→"
    expect(btn.textContent).not.toContain("→");
  });

  it("点击图形按钮展开图案气泡（无逻辑分区/文字，文本框是独立按钮），再点关闭（toggle）", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("图形"));
    expect(screen.getByText("图案")).toBeInTheDocument();
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
    expect(screen.getByTitle("线条")).toBeInTheDocument();
    // 文字已从图案气泡移出：与图形并列的独立分类（常驻坞按钮）
    expect(screen.queryByTitle("文字")).toBeNull();
    expect(screen.queryByText("逻辑")).toBeNull();
    expect(screen.queryByTitle("逻辑节点")).toBeNull();
    fireEvent.click(screen.getByTitle("图形"));
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("气泡内点子工具切换工具但不关闭气泡；逻辑按钮直接切换", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("图形"));
    fireEvent.click(screen.getByTitle("椭圆"));
    expect(useCanvasStore.getState().tool).toBe("ellipse");
    expect(screen.getByTitle("三角形")).toBeInTheDocument();
    // 图形组工具时图形按钮高亮
    expect(screen.getByTitle("图形").classList.contains("bg-blue-100")).toBe(true);
    // 逻辑按钮是常驻按钮：直接切换逻辑工具（无气泡）
    fireEvent.click(screen.getByTitle("逻辑"));
    expect(useCanvasStore.getState().tool).toBe("logic");
  });

  it("点击图形气泡外部关闭气泡", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle("图形"));
    expect(screen.getByTitle("矩形")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTitle("矩形")).toBeNull();
  });

  it("图形按钮图标固定为描边圆形，不随子工具变化；组内工具时高亮", () => {
    useCanvasStore.getState().setTool("hexagon");
    render(<Toolbar />);
    const btn = screen.getByTitle("图形");
    expect(btn.querySelector("circle")).not.toBeNull();
    expect(btn.classList.contains("bg-blue-100")).toBe(true);
  });

  it("文本框按钮：独立常驻分类，点击切到文字工具并高亮", () => {
    render(<Toolbar />);
    const btn = screen.getByTitle("文本框");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.classList.contains("bg-blue-100")).toBe(false);
    fireEvent.click(btn);
    expect(useCanvasStore.getState().tool).toBe("text");
    expect(btn.classList.contains("bg-blue-100")).toBe(true);
    // 文本框不是图形组：图形按钮不高亮
    expect(screen.getByTitle("图形").classList.contains("bg-blue-100")).toBe(false);
  });

  it("选择按钮为光标 SVG 图标；点击切回选择工具并高亮", () => {
    useCanvasStore.getState().setTool("rect");
    render(<Toolbar />);
    const btn = screen.getByTitle("选择");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.classList.contains("bg-blue-100")).toBe(false);
    fireEvent.click(btn);
    expect(useCanvasStore.getState().tool).toBe("select");
    expect(btn.classList.contains("bg-blue-100")).toBe(true);
  });

  it("逻辑工具时逻辑按钮高亮", () => {
    useCanvasStore.getState().setTool("logic");
    render(<Toolbar />);
    expect(screen.getByTitle("逻辑").classList.contains("bg-blue-100")).toBe(true);
  });

  it("逻辑按钮为 SVG 图标（圆角框 + 4 锚点圆点）", () => {
    render(<Toolbar />);
    const svg = screen.getByTitle("逻辑").querySelector("svg");
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
