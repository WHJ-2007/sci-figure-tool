export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export async function searchWeb(apiKey: string, query: string): Promise<SearchResult[]> {
  if (!apiKey) throw new Error("未配置 Tavily API Key");
  const res = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5 }),
  });
  if (!res.ok) throw new Error("搜索服务不可用");
  const data = (await res.json()) as { results?: { title?: unknown; url?: unknown; content?: unknown }[] };
  return (data.results ?? []).map((r) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    content: String(r.content ?? "").slice(0, 200),
  }));
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "未搜到相关结果";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   来源：${r.url}\n   内容：${r.content}`)
    .join("\n");
}
