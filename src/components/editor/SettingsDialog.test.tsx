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
    expect((screen.getByRole("combobox", { name: "模型" }) as HTMLSelectElement).value).toBe("deepseek-reasoner");
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

  it("画布手势灵敏度默认更高，选择后立即保存", () => {
    render(<SettingsDialog open={true} onClose={() => {}} />);
    const select = screen.getByTestId("canvas-gesture-sensitivity") as HTMLSelectElement;
    expect(select.value).toBe("high");
    fireEvent.change(select, { target: { value: "very-high" } });
    expect(JSON.parse(localStorage.getItem("fig-tool-settings")!).canvasGestureSensitivity).toBe("very-high");
    expect(screen.getByText("画布手势灵敏度已保存")).toBeInTheDocument();
  });

  it("移除 Tavily 付费渠道，显示本地开源检索状态", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === "/api/research/status") return Promise.resolve({ json: async () => ({ ok: true, search: true, extract: true, documents: true }) });
      return Promise.resolve({ json: async () => ({}) });
    });
    render(<SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.queryByPlaceholderText("tvly-...")).toBeNull();
    expect(screen.getByText("SearXNG 搜索 + Crawl4AI 网页抽取 + Apache Tika 文档解析")).toBeInTheDocument();
    expect(screen.queryByText("npm run research:up")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("research-status")).toHaveTextContent("已就绪"));
  });

  it("旧设置中的 Tavily Key 不再回显或继续保存", async () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ apiKey: "sk-1", tavilyApiKey: "tvly-123" }));
    render(<SettingsDialog open={true} onClose={() => {}} />);
    expect(screen.queryByPlaceholderText("tvly-...")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(JSON.parse(localStorage.getItem("fig-tool-settings")!)).not.toHaveProperty("tavilyApiKey");
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
