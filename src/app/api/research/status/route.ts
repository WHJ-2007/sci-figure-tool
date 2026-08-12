export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isReady(url: string, headers?: HeadersInit): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store", headers });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const searxng = (process.env.SEARXNG_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const crawl4ai = (process.env.CRAWL4AI_URL || "http://127.0.0.1:11235").replace(/\/$/, "");
  const tika = (process.env.TIKA_URL || "http://127.0.0.1:9998").replace(/\/$/, "");
  const [search, extract, documents] = await Promise.all([
    isReady(`${searxng}/`),
    isReady(`${crawl4ai}/health`, { Authorization: `Bearer ${process.env.CRAWL4AI_API_TOKEN || "sci-figure-local-crawl-token"}` }),
    isReady(`${tika}/version`),
  ]);
  return Response.json({ ok: search && extract && documents, search, extract, documents });
}
