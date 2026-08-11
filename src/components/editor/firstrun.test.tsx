import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FirstRunHint from "./FirstRunHint";
import { saveSettings } from "@/lib/settings";

beforeEach(() => localStorage.clear());

describe("FirstRunHint", () => {
  it("未配置 Key 时显示引导", () => {
    render(<FirstRunHint />);
    expect(screen.getByText(/前往设置/)).toBeInTheDocument();
  });

  it("已配置 Key 时不显示引导", () => {
    saveSettings({ apiKey: "test-key", model: "deepseek-chat", baseURL: "https://api.deepseek.com" });
    render(<FirstRunHint />);
    expect(screen.queryByText(/前往设置/)).not.toBeInTheDocument();
  });

  it("挂载后配置 Key 并保存：自动隐藏引导（无需刷新）", async () => {
    render(<FirstRunHint />);
    expect(screen.getByText(/前往设置/)).toBeInTheDocument();
    saveSettings({ apiKey: "sk-later", model: "deepseek-chat", baseURL: "https://api.deepseek.com" });
    window.dispatchEvent(new CustomEvent("settings-saved"));
    await waitFor(() => {
      expect(screen.queryByText(/前往设置/)).not.toBeInTheDocument();
    });
  });

  it("点击「前往设置」派发 open-settings 事件（打开设置弹窗）", () => {
    const spy = vi.fn();
    window.addEventListener("open-settings", spy);
    render(<FirstRunHint />);
    fireEvent.click(screen.getByText(/前往设置/));
    expect(spy).toHaveBeenCalled();
    window.removeEventListener("open-settings", spy);
  });

  it("点击 × 关闭引导", () => {
    render(<FirstRunHint />);
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(screen.queryByText(/尚未配置/)).not.toBeInTheDocument();
  });
});
