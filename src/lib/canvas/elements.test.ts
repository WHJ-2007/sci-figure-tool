import { describe, it, expect } from "vitest";
import { makeElement, newId, estimateTextSize } from "./elements";
import type { TextElement } from "./types";

describe("elements", () => {
  it("newId 生成唯一 id", () => {
    expect(newId()).not.toBe(newId());
  });

  it("makeElement 矩形带默认样式", () => {
    const r = makeElement("rect", 10, 20, 100, 60);
    expect(r.type).toBe("rect");
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.width).toBe(100);
    expect(r.height).toBe(60);
    expect(r.fill).toBe("#ffffff");
    expect(r.stroke).toBe("#2f2f2f");
    expect(r.strokeWidth).toBe(2);
    expect(r.opacity).toBe(1);
    expect(r.zIndex).toBe(0);
    expect(r.rotation).toBe(0);
  });

  it("makeElement 圆角矩形带 rx", () => {
    const r = makeElement("rounded", 0, 0, 50, 30);
    expect(r.type).toBe("rect");
    expect((r as any).rx).toBe(8);
  });

  it("makeElement 文字带默认字体", () => {
    const t = makeElement("text", 0, 0, 100, 20, { text: "你好" }) as TextElement;
    expect(t.fontSize).toBe(16);
    expect(t.align).toBe("center");
    expect(t.text).toBe("你好");
  });

  it("estimateTextSize 中文字符按 1.0 倍字号、拉丁按 0.6 倍估算", () => {
    const { width } = estimateTextSize("Ab你好", 16);
    expect(width).toBeCloseTo(16 * (0.6 + 0.6 + 1 + 1));
  });
});
