import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsPage from "./page";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("设置页", () => {
  it("挂载后读取已保存设置", async () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ apiKey: "sk-123", model: "deepseek-reasoner", baseURL: "https://api.deepseek.com" }));
    render(<SettingsPage />);
    await waitFor(() => {
      expect((screen.getByPlaceholderText("sk-...") as HTMLInputElement).value).toBe("sk-123");
    });
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("deepseek-reasoner");
  });

  it("保存写入 localStorage", () => {
    render(<SettingsPage />);
    const key = screen.getByPlaceholderText("sk-...");
    fireEvent.change(key, { target: { value: "sk-save" } });
    fireEvent.click(screen.getByText("保存"));
    const saved = JSON.parse(localStorage.getItem("fig-tool-settings")!);
    expect(saved.apiKey).toBe("sk-save");
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("测试连接成功显示结果", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true, text: "OK" }) });
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("测试连接"));
    await waitFor(() => {
      expect(screen.getByText("连接成功：OK")).toBeInTheDocument();
    });
  });

  it("测试连接失败显示错误", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: false, error: "401 Unauthorized" }) });
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("测试连接"));
    await waitFor(() => {
      expect(screen.getByText("失败：401 Unauthorized")).toBeInTheDocument();
    });
  });
});
