import { describe, it, expect } from "vitest";
import { serializeSVG, elementToSvg } from "./exporter";
import { makeElement } from "./elements";
import type { CanvasElement } from "./types";

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

  it("elementToSvg 箭头样式：none 无箭头多边形，double 两个（终点 + 起点反向）", () => {
    const none = makeElement("arrow", 0, 0, 100, 50, { head: "none" });
    expect(elementToSvg(none)).not.toContain("<polygon");
    const single = makeElement("arrow", 0, 0, 100, 50, { head: "single" });
    expect(elementToSvg(single).match(/<polygon/g)).toHaveLength(1);
    const dbl = makeElement("arrow", 0, 0, 100, 0, { head: "double" });
    const out = elementToSvg(dbl);
    expect(out.match(/<polygon/g)).toHaveLength(2);
    // 起点反向箭头尖在 (0,0)（终点箭头尖在 (100,0)）
    expect(out).toContain('points="0,0 ');
    expect(out).toContain('points="100,0 ');
    // 缺省 = single：旧数据无 head 字段仍只有一个箭头
    const legacy = makeElement("arrow", 0, 0, 100, 50);
    expect(elementToSvg(legacy).match(/<polygon/g)).toHaveLength(1);
  });

  it("elementToSvg 箭头头随线宽变大（粗细联动箭头头）", () => {
    const thin = makeElement("arrow", 0, 0, 100, 0, { strokeWidth: 1 });
    const thick = makeElement("arrow", 0, 0, 100, 0, { strokeWidth: 6 });
    const parse = (el: CanvasElement) => elementToSvg(el).match(/points="([^"]+)"/)![1].split(" ").map((p) => p.split(",").map(Number));
    const thinPoly = parse(thin);
    const thickPoly = parse(thick);
    // 头尖都在终点 (100,0)，看两翼点向起点方向的收缩（back 越大两翼 x 越小）
    const backOf = (pts: number[][]) => Math.abs(100 - pts[1][0]);
    expect(backOf(thickPoly)).toBeGreaterThan(backOf(thinPoly));
    // 折线箭头同规则
    const pl = makeElement("polyline", 0, 0, 0, 0, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], strokeWidth: 6 });
    const plOut = elementToSvg(pl).match(/<polygon/g);
    expect(plOut).toHaveLength(1);
  });

  it("elementToSvg 带折点的箭头输出 polyline 折线与箭头多边形（折点为相对坐标）", () => {
    // 起点 (50,30)，折点相对 (100,40) → 世界 (150,70)；终点 x2 = 50+200 = 250
    const a = makeElement("arrow", 50, 30, 200, 0, { midPoints: [{ x: 100, y: 40 }] });
    const out = elementToSvg(a);
    expect(out).toContain("<polyline");
    expect(out).toContain('points="50,30 150,70 250,30"');
    expect(out).toContain("<polygon");
    expect(out).not.toContain("<line");
  });

  it("elementToSvg 平滑折点输出 Catmull-Rom path（与渲染一致）", () => {
    const a = makeElement("arrow", 50, 30, 200, 0, { midPoints: [{ x: 100, y: 40, smooth: true }] });
    const out = elementToSvg(a);
    expect(out).toContain("<path d=\"M 50 30 C");
    expect(out).toContain('stroke-linejoin="round"');
    expect(out).not.toContain("<polyline");
    expect(out).toContain("<polygon");
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

  it("elementToSvg 导出 curve（二次贝塞尔 Q）", () => {
    const c = makeElement("curve", 0, 0, 100, 0, { curvature: 0, stroke: "#2f2f2f" });
    const svg = elementToSvg(c);
    expect(svg).toContain("M 0 0 Q 50 0 100 0");
  });

  it("elementToSvg 导出 sector（圆心+起边线+圆弧）", () => {
    const s = makeElement("sector", 100, 100, 40, 40, { radius: 20, startAngle: 0, endAngle: Math.PI / 2 });
    const svg = elementToSvg(s);
    expect(svg).toContain("M 100 100 L 120 100 A 20 20 0 0 1 100 120 Z");
  });

  it("elementToSvg 导出 sector：跨 0 的扇形按大弧渲染（largeArc=1）", () => {
    // start=0.6π → end=0.1π 实际扫过 1.5π 跨过 0 点，必须 largeArc=1
    const s = makeElement("sector", 0, 0, 20, 20, { radius: 10, startAngle: 0.6 * Math.PI, endAngle: 0.1 * Math.PI });
    const svg = elementToSvg(s);
    expect(svg).toContain("A 10 10 0 1 1");
  });

  it("elementToSvg 导出 sector：正常扫角 largeArc=0", () => {
    const s = makeElement("sector", 0, 0, 20, 20, { radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
    const svg = elementToSvg(s);
    expect(svg).toContain("A 10 10 0 0 1");
  });

  it("elementToSvg polyline arrow:false 不输出箭头多边形", () => {
    const p = makeElement("polyline", 0, 0, 0, 0, { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], arrow: false });
    const svg = elementToSvg(p);
    expect(svg).toContain("<polyline");
    expect(svg).not.toContain("<polygon");
  });

  it("elementToSvg 水平镜像：以中心为轴缩放 -1", () => {
    const r = makeElement("rect", 10, 10, 100, 60, { flipH: true });
    const svg = elementToSvg(r);
    expect(svg).toContain('transform="translate(60 40) rotate(0) scale(-1 1) translate(-60 -40)"');
  });

  it("elementToSvg 垂直镜像：y 轴缩放 -1", () => {
    const r = makeElement("rect", 10, 10, 100, 60, { flipV: true });
    const svg = elementToSvg(r);
    expect(svg).toContain('translate(60 40) rotate(0) scale(1 -1) translate(-60 -40)');
  });

  it("elementToSvg 旋转+镜像组合：transform 含旋转与翻转", () => {
    const r = makeElement("rect", 10, 10, 100, 60, { rotation: 45, flipH: true });
    const svg = elementToSvg(r);
    expect(svg).toContain('transform="translate(60 40) rotate(45) scale(-1 1) translate(-60 -40)"');
  });

  it("serializeSVG 不输出画布背景（导出透明，忽略背景样式）", () => {
    // 缺省、none、纯色、渐变背景均不输出任何背景 rect/defs
    for (const background of [undefined, "none", "#ff0000", "linear:#eef4ff,#fdf2f8"]) {
      const svg = serializeSVG({ width: 1600, height: 1000, background, elements: [] });
      expect(svg).not.toContain("<rect");
      expect(svg).not.toContain("linearGradient");
    }
  });

  it("serializeSVG 透明背景下元素正常输出", () => {
    const a = makeElement("rect", 10, 20, 100, 60, { fill: "#ff0000" });
    const svg = serializeSVG({ width: 1600, height: 1000, background: "#ffffff", elements: [a] });
    expect(svg).toContain('x="10"');
    expect(svg).toContain('fill="#ff0000"');
  });
});
