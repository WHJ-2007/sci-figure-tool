import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GenerationToast from "./GenerationToast";
import { useCanvasStore } from "@/lib/canvas/store";

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState()));
afterEach(() => vi.useRealTimers());

describe("GenerationToast", () => {
  it("未生成时不显示，生成中显示最新步骤，结束收缩消失", async () => {
    vi.useFakeTimers();
    render(<GenerationToast />);
    expect(screen.queryByTestId("generation-toast")).toBeNull();
    act(() => {
      useCanvasStore.getState().setGenerating(true);
      useCanvasStore.setState({ activity: ["在 (100, 50) 创建矩形", "在 (300, 200) 创建逻辑节点「编码器」"] });
    });
    expect(screen.getByTestId("generation-toast")).toBeInTheDocument();
    // 折叠态只显示最新一条
    expect(screen.getByText(/编码器/)).toBeInTheDocument();
    expect(screen.queryByText(/创建矩形/)).toBeNull();
    // 无活动时显示兜底文案
    act(() => useCanvasStore.setState({ activity: [] }));
    expect(screen.getByText(/AI 正在生成/)).toBeInTheDocument();
    // 生成结束：先收缩（opacity-0），动画后卸载
    act(() => useCanvasStore.getState().setGenerating(false));
    expect(screen.getByTestId("generation-toast").classList.contains("opacity-0")).toBe(true);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByTestId("generation-toast")).toBeNull();
  });

  it("点击展开显示完整时间线，再点收起", () => {
    act(() => {
      useCanvasStore.getState().setGenerating(true);
      useCanvasStore.setState({ activity: ["创建矩形", "创建箭头", "创建逻辑节点"] });
    });
    render(<GenerationToast />);
    fireEvent.click(screen.getByTestId("generation-toast"));
    expect(screen.getByText("创建矩形")).toBeInTheDocument();
    expect(screen.getByText("创建箭头")).toBeInTheDocument();
    expect(screen.getByText("创建逻辑节点")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("generation-toast"));
    expect(screen.queryByText("创建矩形")).toBeNull();
  });

  it("最新一条带动画类 toast-in（每次新动作重挂载）", () => {
    act(() => {
      useCanvasStore.getState().setGenerating(true);
      useCanvasStore.setState({ activity: ["第一步"] });
    });
    render(<GenerationToast />);
    const el = screen.getByText("第一步").closest("span")!;
    expect(el.className).toContain("toast-in");
  });
});
