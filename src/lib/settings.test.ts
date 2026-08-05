import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from "./settings";

beforeEach(() => localStorage.clear());

describe("settings", () => {
  it("默认设置", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("保存后可读取", () => {
    saveSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test" });
    const s = loadSettings();
    expect(s.apiKey).toBe("sk-test");
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
  });
  it("损坏数据回退默认", () => {
    localStorage.setItem("fig-tool-settings", "{bad json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
