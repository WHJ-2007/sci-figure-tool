import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import GenerationToast from "./GenerationToast";
import ChatPanel from "./ChatPanel";
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
      useCanvasStore.setState({ activity: ["创建矩形", "创建箭头"] });
    });
    expect(screen.getByTestId("generation-toast")).toBeInTheDocument();
    expect(screen.getByTestId("generation-toast").classList.contains("active:scale-[0.97]")).toBe(true);
    expect(screen.getByText(/创建箭头/)).toBeInTheDocument();
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

  it("点击气泡聚焦聊天输入框", () => {
    render(
      <>
        <GenerationToast />
        <ChatPanel />
      </>
    );
    act(() => useCanvasStore.getState().setGenerating(true));
    fireEvent.click(screen.getByTestId("generation-toast"));
    expect(document.activeElement).toBe(document.getElementById("chat-input"));
  });
});
