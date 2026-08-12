import {
  MAX_ATTACHMENT_BYTES,
  MAX_EXTRACTED_CHARS,
  extensionOf,
  isAcceptedAttachment,
} from "@/lib/ai/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIKA_URL = "http://127.0.0.1:9998";
const PARSE_TIMEOUT_MS = 45_000;
const MAX_FORM_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;

function cleanExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export async function POST(req: Request) {
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_FORM_BYTES) {
    return Response.json({ error: "文件过大，单个文件最大支持 20 MB" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "无法读取上传内容" }, { status: 400 });
  }
  const entry = form.get("file");
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function" || typeof entry.name !== "string") {
    return Response.json({ error: "请选择要解析的文件" }, { status: 400 });
  }
  const file = entry as File;
  if (!isAcceptedAttachment(file.name)) {
    return Response.json({ error: "仅支持 DOC、DOCX、PDF、PPT、PPTX、XLS、XLSX、XLSM 文件" }, { status: 415 });
  }
  if (file.size === 0) {
    return Response.json({ error: "文件内容为空" }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Response.json({ error: "文件过大，单个文件最大支持 20 MB" }, { status: 413 });
  }

  const tikaURL = (process.env.TIKA_URL || DEFAULT_TIKA_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
  try {
    const response = await fetch(`${tikaURL}/tika`, {
      method: "PUT",
      headers: {
        Accept: "text/plain",
        "Content-Type": file.type || "application/octet-stream",
        "X-Tika-Resource-Name": encodeURIComponent(file.name),
        "X-Tika-OCRskipOcr": "true",
      },
      body: Buffer.from(await file.arrayBuffer()),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return Response.json(
        { error: `文件解析失败${detail ? `：${detail}` : ""}` },
        { status: response.status >= 500 ? 502 : 422 },
      );
    }
    const fullText = cleanExtractedText(await response.text());
    if (!fullText) {
      return Response.json(
        { error: "没有提取到可读文字；扫描版 PDF 或纯图片演示文稿暂不支持 OCR" },
        { status: 422 },
      );
    }
    const text = fullText.slice(0, MAX_EXTRACTED_CHARS);
    return Response.json({
      ok: true,
      file: {
        id: crypto.randomUUID(),
        name: file.name,
        extension: extensionOf(file.name),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        text,
        characters: fullText.length,
        truncated: text.length < fullText.length,
      },
    });
  } catch (error) {
    const unavailable = error instanceof Error && (error.name === "AbortError" || /fetch failed/i.test(error.message));
    return Response.json(
      { error: unavailable ? "文档解析服务未就绪，请先运行 npm run research:up" : `文件解析失败：${String(error)}` },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}
