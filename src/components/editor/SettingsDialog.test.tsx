import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsDialog from "./SettingsDialog";
import { isSaveDirSupported, selectSaveDirectory, getSaveDirectoryName, clearSaveDirectory } from "@/lib/canvas/saveTarget";

vi.mock("@/lib/canvas/saveTarget", () => ({
  isSaveDirSupported: vi.fn(() => true),
  selectSaveDirectory: vi.fn(async () => "我的画布目录"),
  getSaveDirectoryName: vi.fn(async () => null),
  clearSaveDirectory: vi.fn(async () => {}),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("设置弹窗", () => {
  it("关闭时为空；打开后显示保存卡 + AI 设置卡", () => {
    const { rerender } = render(<SettingsDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("heading", { name: "保存" })).toBeNull();
    rerender(<SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI 设置" })).toBeInTheDocument();
  });

  it("挂载后读取已保存设置", async () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ apiKey: "sk-123", model: "deepseek-reasoner", baseURL: "https://api.deepseek.com" }));
    render(<SettingsDialog open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect((screen.getByPlaceholderText("sk-...") as HTMLInputElement).value).toBe("sk-123");
    });
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("deepseek-reasoner");
  });

  it("AI 设置保存写入 localStorage", () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const key = screen.getByPlaceholderText("sk-...");
    fireEvent.change(key, { target: { value: "sk-save" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const saved = JSON.parse(localStorage.getItem("fig-tool-settings")!);
    expect(saved.apiKey).toBe("sk-save");
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("Tavily API Key 可选字段：缺省为空，保存后写入 localStorage", () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const tv = screen.getByPlaceholderText("tvly-...");
    expect((tv as HTMLInputElement).value).toBe("");
    fireEvent.change(tv, { target: { value: "tvly-save" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const saved = JSON.parse(localStorage.getItem("fig-tool-settings")!);
    expect(saved.tavilyApiKey).toBe("tvly-save");
  });

  it("Tavily API Key 挂载后回显已保存值", async () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ apiKey: "sk-1", tavilyApiKey: "tvly-123" }));
    render(<SettingsDialog open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect((screen.getByPlaceholderText("tvly-...") as HTMLInputElement).value).toBe("tvly-123");
    });
  });

  it("测试连接成功显示「连接成功」（不带多余内容）", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true, text: "OK" }) });
    render(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("测试连接"));
    await waitFor(() => {
      expect(screen.getByText("连接成功")).toBeInTheDocument();
    });
    expect(screen.queryByText(/连接成功：OK/)).toBeNull();
  });

  it("测试连接失败显示错误", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: false, error: "401 Unauthorized" }) });
    render(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("测试连接"));
    await waitFor(() => {
      expect(screen.getByText("失败：401 Unauthorized")).toBeInTheDocument();
    });
  });

  it("关闭按钮回调 onClose", () => {
    const onClose = vi.fn();
    render(<SettingsDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTitle("关闭设置"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("保存功能", () => {
  it("选择保存目录后显示目录名，可更换", async () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("选择保存目录"));
    await waitFor(() => {
      expect(screen.getByText(/目录：我的画布目录/)).toBeInTheDocument();
    });
    expect(selectSaveDirectory).toHaveBeenCalled();
    expect(screen.getByText("更换保存目录")).toBeInTheDocument();
  });

  it("移除目录后恢复选择按钮", async () => {
    (getSaveDirectoryName as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce("旧目录");
    render(<SettingsDialog open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/目录：旧目录/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("移除"));
    await waitFor(() => {
      expect(screen.getByText("选择保存目录")).toBeInTheDocument();
    });
    expect(clearSaveDirectory).toHaveBeenCalled();
  });

  it("浏览器不支持时禁用按钮并提示", () => {
    const mock = vi.mocked(isSaveDirSupported);
    mock.mockReturnValue(false);
    render(<SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.getByText(/当前浏览器不支持本地保存目录/)).toBeInTheDocument();
    expect(screen.getByText("选择保存目录")).toBeDisabled();
    mock.mockReturnValue(true);
  });
});
