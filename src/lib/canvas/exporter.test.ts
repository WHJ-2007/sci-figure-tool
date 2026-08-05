import { describe, it, expect } from "vitest";
import { serializeSVG, elementToSvg } from "./exporter";
import { makeElement } from "./elements";

describe("exporter", () => {
  it("serializeSVG 包含根 svg 与元素", () => {
    const a = makeElement("rect", 10, 20, 100, 60, { fill: "#ff0000" });
    const svg = serializeSVG({ width: 1600, height: 1000, elements: [a] });
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="1600"');
    expect(svg).toContain('x="10"');
    expect(svg).toContain('fill="#ff0000"');
  });

  it("elementToSvg 渲染文字", () => {
    const t = makeElement("text", 0, 0, 50, 20, { text: "你好" });
    const out = elementToSvg(t);
    expect(out).toContain("<text");
    expect(out).toContain("你好");
  });

  it("elementToSvg 多边形形状含 polygon", () => {
    const d = makeElement("diamond", 0, 0, 100, 60);
    expect(elementToSvg(d)).toContain("<polygon");
  });

  it("elementToSvg 箭头含 line 与箭头多边形", () => {
    const a = makeElement("arrow", 0, 0, 100, 50);
    expect(elementToSvg(a)).toContain("<line");
    expect(elementToSvg(a)).toContain("<polygon");
  });
});
