import { describe, it, expect } from "vitest";
import { makeElement, newId, estimateTextSize } from "./elements";
import type { RectElement, TextElement } from "./types";

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
    const r = makeElement("rounded", 0, 0, 50, 30) as RectElement;
    expect(r.type).toBe("rect");
    expect(r.rx).toBe(8);
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

  it("矩形不携带其他元素的专属字段（无字段泄漏）", () => {
    const r = makeElement("rect", 0, 0, 10, 10, { text: "hello" }) as RectElement;
    expect((r as any).text).toBeUndefined();
    expect((r as any).points).toBeUndefined();
    expect(r.rx).toBe(0);
  });

  it("polyline 显式 points 被保留", () => {
    const p = makeElement("polyline", 0, 0, 0, 0, {
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    expect(p.type).toBe("polyline");
    expect((p as any).points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});
