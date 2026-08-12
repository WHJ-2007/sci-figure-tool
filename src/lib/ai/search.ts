export type AuthorityKind =
  | "government"
  | "international"
  | "standard"
  | "peer-reviewed"
  | "academic"
  | "preprint"
  | "official"
  | "general";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  authority: AuthorityKind;
  authorityScore: number;
  engines: string[];
  publishedDate?: string;
  extracted: boolean;
}

export interface AuthoritySearchOptions {
  category?: "general" | "science" | "statistics" | "cybersecurity" | "technology";
  maxResults?: number;
}

interface SearxResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  engines?: unknown;
  publishedDate?: unknown;
  published_date?: unknown;
}

const SEARXNG_URL = process.env.SEARXNG_URL || "http://127.0.0.1:8080";
const CRAWL4AI_URL = process.env.CRAWL4AI_URL || "http://127.0.0.1:11235";
const CRAWL4AI_API_TOKEN = process.env.CRAWL4AI_API_TOKEN || "sci-figure-local-crawl-token";
const SEARCH_TIMEOUT_MS = 20_000;
const EXTRACT_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; results: SearchResult[] }>();

const HOST_RULES: { kind: AuthorityKind; score: number; test: (host: string) => boolean }[] = [
  { kind: "government", score: 100, test: (h) => /(^|\.)(gov|gov\.cn|go\.jp|go\.kr|gc\.ca|gouv\.fr|bund\.de)$/.test(h) || h.endsWith(".gov.cn") },
  { kind: "international", score: 98, test: (h) => h.endsWith(".int") || ["who.int", "worldbank.org", "oecd.org", "un.org", "unesco.org", "imf.org", "wto.org"].some((d) => h === d || h.endsWith(`.${d}`)) },
  { kind: "standard", score: 96, test: (h) => ["nist.gov", "cisa.gov", "iso.org", "ietf.org", "rfc-editor.org", "w3.org", "itu.int"].some((d) => h === d || h.endsWith(`.${d}`)) },
  { kind: "peer-reviewed", score: 92, test: (h) => ["nature.com", "science.org", "acm.org", "ieee.org", "springer.com", "sciencedirect.com", "cell.com", "thelancet.com", "bmj.com", "jamanetwork.com"].some((d) => h === d || h.endsWith(`.${d}`)) },
  { kind: "academic", score: 88, test: (h) => h.endsWith(".edu") || /(^|\.)ac\.[a-z]{2}$/.test(h) || ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "semanticscholar.org", "openalex.org", "crossref.org", "doi.org"].some((d) => h === d || h.endsWith(`.${d}`)) },
  { kind: "preprint", score: 78, test: (h) => ["arxiv.org", "biorxiv.org", "medrxiv.org", "ssrn.com"].some((d) => h === d || h.endsWith(`.${d}`)) },
  { kind: "official", score: 74, test: (h) => ["pytorch.org", "tensorflow.org", "kubernetes.io", "apache.org", "github.com"].some((d) => h === d || h.endsWith(`.${d}`)) },
];

const CATEGORY_MAP: Record<NonNullable<AuthoritySearchOptions["category"]>, string> = {
  general: "general,science",
  science: "science,general",
  statistics: "science,general",
  cybersecurity: "it,science,general",
  technology: "it,science,general",
};

function authorityFor(url: string): { kind: AuthorityKind; score: number } {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return HOST_RULES.find((rule) => rule.test(host)) ?? { kind: "general", score: 45 };
  } catch {
    return { kind: "general", score: 0 };
  }
}

function safePublicUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") return null;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function markdownFromCrawlResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const item = result as Record<string, unknown>;
  if (typeof item.markdown === "string") return item.markdown;
  if (item.markdown && typeof item.markdown === "object") {
    const md = item.markdown as Record<string, unknown>;
    if (typeof md.fit_markdown === "string" && md.fit_markdown) return md.fit_markdown;
    if (typeof md.raw_markdown === "string") return md.raw_markdown;
  }
  return typeof item.cleaned_html === "string" ? item.cleaned_html.replace(/<[^>]+>/g, " ") : "";
}

async function extractPages(results: SearchResult[]): Promise<Map<string, string>> {
  if (results.length === 0) return new Map();
  try {
    const response = await fetchWithTimeout(`${CRAWL4AI_URL.replace(/\/$/, "")}/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRAWL4AI_API_TOKEN}` },
      body: JSON.stringify({ urls: results.map((r) => r.url), priority: 10 }),
    }, EXTRACT_TIMEOUT_MS);
    if (!response.ok) return new Map();
    const payload = await response.json() as { results?: unknown[] };
    const extracted = new Map<string, string>();
    for (const item of payload.results ?? []) {
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? safePublicUrl(record.url) : null;
      const markdown = markdownFromCrawlResult(item).replace(/\s+/g, " ").trim().slice(0, 6_000);
      if (url && markdown) extracted.set(url, markdown);
    }
    return extracted;
  } catch {
    // Crawl4AI 不可用时仍可使用 SearXNG 的结果摘要，但会明确标记未抽取全文。
    return new Map();
  }
}

export async function searchAuthority(query: string, options: AuthoritySearchOptions = {}): Promise<SearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("搜索词不能为空");
  const category = options.category ?? "general";
  const maxResults = Math.min(8, Math.max(2, options.maxResults ?? 6));
  const cacheKey = `${category}:${maxResults}:${normalizedQuery}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return structuredClone(cached.results);

  const endpoint = new URL(`${SEARXNG_URL.replace(/\/$/, "")}/search`);
  endpoint.searchParams.set("q", normalizedQuery);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("categories", CATEGORY_MAP[category]);
  endpoint.searchParams.set("language", "auto");
  endpoint.searchParams.set("safesearch", "1");

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.toString(), { headers: { Accept: "application/json" } }, SEARCH_TIMEOUT_MS);
  } catch {
    throw new Error("本地权威搜索服务未启动。请运行 npm run research:up，等待 SearXNG 与 Crawl4AI 就绪后重试");
  }
  if (!response.ok) throw new Error(`SearXNG 搜索失败（HTTP ${response.status}）`);
  const data = await response.json() as { results?: SearxResult[] };
  const dedup = new Map<string, SearchResult>();
  for (const raw of data.results ?? []) {
    const url = safePublicUrl(String(raw.url ?? ""));
    if (!url || dedup.has(url)) continue;
    const authority = authorityFor(url);
    dedup.set(url, {
      title: String(raw.title ?? "").trim() || new URL(url).hostname,
      url,
      content: String(raw.content ?? "").replace(/\s+/g, " ").trim().slice(0, 1_200),
      authority: authority.kind,
      authorityScore: authority.score,
      engines: Array.isArray(raw.engines) ? raw.engines.map(String) : [],
      publishedDate: String(raw.publishedDate ?? raw.published_date ?? "") || undefined,
      extracted: false,
    });
  }

  const ranked = [...dedup.values()]
    .sort((a, b) => b.authorityScore - a.authorityScore || b.engines.length - a.engines.length)
    .slice(0, maxResults);
  const extracted = await extractPages(ranked);
  const results = ranked.map((result) => {
    const fullText = extracted.get(result.url);
    return fullText ? { ...result, content: fullText, extracted: true } : result;
  });
  cache.set(cacheKey, { at: Date.now(), results });
  return structuredClone(results);
}

const AUTHORITY_LABEL: Record<AuthorityKind, string> = {
  government: "政府/官方统计",
  international: "国际组织",
  standard: "标准与安全机构",
  "peer-reviewed": "同行评审出版物",
  academic: "高校/学术数据库",
  preprint: "预印本（尚非同行评审）",
  official: "官方技术资料",
  general: "一般网页（需谨慎）",
};

export function formatAuthorityResults(results: SearchResult[]): string {
  if (results.length === 0) return "未检索到可用来源；不得据此编造数据。";
  return results.map((r, index) => [
    `[来源 ${index + 1}] ${r.title}`,
    `权威等级：${AUTHORITY_LABEL[r.authority]}（${r.authorityScore}/100）${r.extracted ? "；已抽取正文" : "；仅搜索摘要"}`,
    `URL：${r.url}`,
    r.publishedDate ? `发布日期：${r.publishedDate}` : "",
    `证据内容：${r.content || "无可用正文"}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}
