import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function uploadRequest(name: string, type: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  const file = {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  };
  return {
    headers: new Headers(),
    formData: async () => ({ get: (key: string) => key === "file" ? file : null }),
  } as unknown as Request;
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/files/parse", () => {
  it("sends supported documents to local Tika and returns normalized text", async () => {
    const tika = vi.fn().mockResolvedValue(new Response("Title\r\n\r\n\r\nBody\u0000", { status: 200 }));
    vi.stubGlobal("fetch", tika);
    const response = await POST(uploadRequest("paper.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "fake-docx"));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.file.text).toBe("Title\n\n\nBody");
    expect(data.file.name).toBe("paper.docx");
    expect(tika).toHaveBeenCalledWith("http://127.0.0.1:9998/tika", expect.objectContaining({ method: "PUT" }));
  });

  it("rejects unsupported types before contacting the parser", async () => {
    const tika = vi.fn();
    vi.stubGlobal("fetch", tika);
    const response = await POST(uploadRequest("script.exe", "application/octet-stream", "bad"));
    expect(response.status).toBe(415);
    expect(tika).not.toHaveBeenCalled();
  });

  it("reports a clear startup action when Tika is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const response = await POST(uploadRequest("paper.pdf", "application/pdf", "%PDF"));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("npm run research:up");
  });
});
