import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from "./settings";

beforeEach(() => localStorage.clear());

describe("settings", () => {
  it("默认设置", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("保存后可读取", () => {
    saveSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", canvasGestureSensitivity: "very-high" });
    const s = loadSettings();
    expect(s.apiKey).toBe("sk-test");
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
    expect(s.canvasGestureSensitivity).toBe("very-high");
  });
  it("旧设置缺少画布灵敏度时使用新的高灵敏度默认档", () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ apiKey: "", model: "deepseek-chat", baseURL: "https://api.deepseek.com" }));
    expect(loadSettings().canvasGestureSensitivity).toBe("high");
  });
  it("损坏数据回退默认", () => {
    localStorage.setItem("fig-tool-settings", "{bad json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("读取旧设置时删除 Tavily 付费渠道密钥", () => {
    localStorage.setItem("fig-tool-settings", JSON.stringify({ ...DEFAULT_SETTINGS, tavilyApiKey: "tvly-old" }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings(loadSettings());
    expect(JSON.parse(localStorage.getItem("fig-tool-settings")!)).not.toHaveProperty("tavilyApiKey");
  });
});
