import { describe, it, expect, afterEach, vi } from "vitest";
import { fileToDataUrl, imageNaturalSize, makeImageElement, loadImageElement } from "./imageImport";
import type { ImageElement } from "./types";

afterEach(() => vi.unstubAllGlobals());

// jsdom 的 Image 不加载图片：stub 为立即触发 onload 的假类
function stubImage(w: number, h: number) {
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = w;
    naturalHeight = h;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  });
}

describe("imageImport 图片导入", () => {
  it("fileToDataUrl 把文件读成 dataURL", async () => {
    const file = new File(["hello"], "a.png", { type: "image/png" });
    const dataUrl = await fileToDataUrl(file);
    expect(dataUrl.startsWith("data:")).toBe(true);
  });

  it("imageNaturalSize 读取自然尺寸", async () => {
    stubImage(800, 600);
    const size = await imageNaturalSize("data:image/png;base64,x");
    expect(size).toEqual({ width: 800, height: 600 });
  });

  it("imageNaturalSize 加载失败时 reject", async () => {
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    });
    await expect(imageNaturalSize("data:image/png;base64,x")).rejects.toThrow("图片加载失败");
  });

  it("makeImageElement 按原始比例缩放且不放大（大图缩到 400×300 内）", () => {
    const el = makeImageElement("data:image/png;base64,x", 1600, 900, 500, 400) as ImageElement;
    expect(el.type).toBe("image");
    expect(el.src).toBe("data:image/png;base64,x");
    // 16:9 缩到宽 400 → 高 225
    expect(el.width).toBeCloseTo(400);
    expect(el.height).toBeCloseTo(225);
    // 以 (500,400) 为中心
    expect(el.x).toBeCloseTo(500 - el.width / 2);
    expect(el.y).toBeCloseTo(400 - el.height / 2);
  });

  it("小图不放大（保持原始尺寸）", () => {
    const el = makeImageElement("d", 50, 30, 0, 0) as ImageElement;
    expect(el.width).toBe(50);
    expect(el.height).toBe(30);
  });

  it("画布边界钳制：中心靠近边缘时整体移入画布", () => {
    const el = makeImageElement("d", 1600, 900, 10, 10) as ImageElement;
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    const el2 = makeImageElement("d", 1600, 900, 1590, 990) as ImageElement;
    expect(el2.x + el2.width).toBe(1600);
    expect(el2.y + el2.height).toBe(1000);
  });

  it("loadImageElement 文件 → 图片元素；读取失败返回 null", async () => {
    stubImage(640, 480);
    const file = new File(["fake"], "p.png", { type: "image/png" });
    const el = await loadImageElement(file, 100, 100);
    expect(el).not.toBeNull();
    expect(el!.width).toBeCloseTo(400);
    expect(el!.height).toBeCloseTo(300);

    // 图片加载失败（Image onerror）→ null
    stubImage(0, 0);
    class FailImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal("Image", FailImage);
    expect(await loadImageElement(file, 100, 100)).toBeNull();
  });
});
