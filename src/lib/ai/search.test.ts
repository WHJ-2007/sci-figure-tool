// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { searchWeb, formatSearchResults } from "./search";

afterEach(() => vi.unstubAllGlobals());

describe("searchWeb", () => {
  it("调用 Tavily API 并返回精简结果（内容截断 200 字）", async () => {
    const longContent = "数".repeat(500);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "中国 GDP", url: "https://www.stats.gov.cn/x", content: longContent },
          { title: "第二篇", url: "https://example.com/2", content: "短内容" },
        ],
      }),
    }));
    const results = await searchWeb("tvly-test", "2023 年中国 GDP");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: "tvly-test", query: "2023 年中国 GDP", search_depth: "basic", max_results: 5 }),
    });
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("中国 GDP");
    expect(results[0].content).toHaveLength(200);
    expect(results[1].content).toBe("短内容");
  });

  it("无 apiKey 时报错", async () => {
    await expect(searchWeb("", "GDP")).rejects.toThrow("Tavily");
  });

  it("HTTP 失败时报错（搜索服务不可用）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(searchWeb("tvly-test", "GDP")).rejects.toThrow("搜索服务不可用");
  });

  it("无 results 字段时返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await searchWeb("tvly-test", "GDP")).toEqual([]);
  });
});

describe("formatSearchResults", () => {
  it("格式化结果列表，空结果返回提示", () => {
    const s = formatSearchResults([
      { title: "T1", url: "https://a.com", content: "C1" },
      { title: "T2", url: "https://b.com", content: "C2" },
    ]);
    expect(s).toContain("1. T1");
    expect(s).toContain("来源：https://a.com");
    expect(s).toContain("2. T2");
    expect(formatSearchResults([])).toBe("未搜到相关结果");
  });
});
