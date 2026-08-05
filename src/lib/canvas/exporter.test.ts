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

  it("serializeSVG 按 zIndex 排序输出", () => {
    const z2 = makeElement("rect", 0, 0, 10, 10, { zIndex: 2 });
    const z1 = makeElement("rect", 500, 0, 10, 10, { zIndex: 1 });
    const svg = serializeSVG({ width: 1600, height: 1000, elements: [z2, z1] });
    expect(svg.indexOf('x="500"')).toBeLessThan(svg.indexOf('x="0"'));
  });

  it("elementToSvg 转义 XML 特殊字符", () => {
    const t = makeElement("text", 0, 0, 100, 20, { text: 'A&B <C>"D"' });
    const out = elementToSvg(t);
    expect(out).toContain("&amp;");
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&quot;");
    expect(out).not.toContain("A&B <C>");
  });

  it("elementToSvg 逻辑节点 = 圆角矩形 + 居中标题文字", () => {
    const l = makeElement("logic", 0, 0, 120, 60, { text: "处理" });
    const out = elementToSvg(l);
    expect(out).toContain('<rect');
    expect(out).toContain('rx="6"');
    expect(out).toContain("<text");
    expect(out).toContain("处理");
  });

  it("elementToSvg 逻辑节点导出标题与多行正文", () => {
    const l = makeElement("logic", 0, 0, 120, 60, { text: "处理", body: "行一\n行二" });
    const out = elementToSvg(l);
    expect(out).toContain("处理");
    expect(out).toContain("行一");
    expect(out).toContain("行二");
  });

  it("elementToSvg 逻辑节点标题颜色与填充对比（深填充白字）", () => {
    const l = makeElement("logic", 0, 0, 120, 60, { text: "A", fill: "#1f2937" });
    const out = elementToSvg(l);
    const text = out.match(/<text[^>]*>/)?.[0];
    expect(text).toContain('fill="#ffffff"');
  });

  it("elementToSvg 矩形与折线带旋转", () => {
    const r = makeElement("rect", 10, 10, 100, 60, { rotation: 45 });
    expect(elementToSvg(r)).toContain("rotate(45 60 40)");
    const p = makeElement("polyline", 0, 0, 100, 60, {
      rotation: 30,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 60 },
      ],
    });
    expect(elementToSvg(p)).toContain('transform="rotate(30');
  });

  it("elementToSvg 文字不含 stroke", () => {
    const t = makeElement("text", 0, 0, 50, 20, { text: "hi" });
    expect(elementToSvg(t)).not.toContain("stroke=");
  });

  it("elementToSvg 折线 points 格式", () => {
    const p = makeElement("polyline", 0, 0, 100, 60, {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 30 },
        { x: 100, y: 60 },
      ],
    });
    const out = elementToSvg(p);
    expect(out).toContain("<polyline");
    expect(out).toContain('points="0,0 50,30 100,60"');
  });
});
