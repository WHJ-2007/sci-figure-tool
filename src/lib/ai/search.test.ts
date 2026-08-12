// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAuthorityResults, searchAuthority } from "./search";

afterEach(() => vi.unstubAllGlobals());

describe("searchAuthority", () => {
  it("通过 SearXNG 检索、按权威性排序，并用 Crawl4AI 抽取正文", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [
          { title: "博客", url: "https://example.com/post", content: "二手摘要", engines: ["bing"] },
          { title: "国家统计局", url: "https://www.stats.gov.cn/data", content: "官方摘要", engines: ["google", "bing"] },
        ] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [
          { url: "https://www.stats.gov.cn/data", markdown: { fit_markdown: "2024 年权威统计正文" } },
          { url: "https://example.com/post", markdown: "博客正文" },
        ] }),
      }));

    const results = await searchAuthority(`GDP-${crypto.randomUUID()}`, { category: "statistics" });
    expect(results[0].authority).toBe("government");
    expect(results[0].authorityScore).toBe(100);
    expect(results[0].content).toContain("权威统计正文");
    expect(results[0].extracted).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("format=json");
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("categories=science%2Cgeneral");
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("http://127.0.0.1:11235/crawl");
    expect((vi.mocked(fetch).mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer sci-figure-local-crawl-token" });
  });

  it("拦截搜索结果中的本机和私网 URL，避免 Crawl4AI SSRF", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [
        { title: "本机", url: "http://127.0.0.1/admin" },
        { title: "内网", url: "http://192.168.1.1/private" },
        { title: "官方", url: "https://www.nist.gov/publication", content: "标准" },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) }));
    const results = await searchAuthority(`security-${crypto.randomUUID()}`, { category: "cybersecurity" });
    expect(results).toHaveLength(1);
    expect(results[0].url).toContain("nist.gov");
  });

  it("SearXNG 不可用时给出本地服务启动方法", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(searchAuthority(`offline-${crypto.randomUUID()}`)).rejects.toThrow("npm run research:up");
  });

  it("Crawl4AI 不可用时保留搜索摘要并标明未抽取全文", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [
        { title: "WHO", url: "https://www.who.int/report", content: "摘要证据" },
      ] }) })
      .mockRejectedValueOnce(new Error("extract offline")));
    const results = await searchAuthority(`who-${crypto.randomUUID()}`);
    expect(results[0].content).toBe("摘要证据");
    expect(results[0].extracted).toBe(false);
    expect(formatAuthorityResults(results)).toContain("仅搜索摘要");
  });
});

describe("formatAuthorityResults", () => {
  it("输出来源编号、权威等级、URL 与证据内容", () => {
    const text = formatAuthorityResults([{
      title: "NIST 标准", url: "https://nist.gov/x", content: "正文", authority: "standard",
      authorityScore: 96, engines: ["google"], extracted: true,
    }]);
    expect(text).toContain("[来源 1]");
    expect(text).toContain("标准与安全机构");
    expect(text).toContain("https://nist.gov/x");
    expect(text).toContain("正文");
  });
});
