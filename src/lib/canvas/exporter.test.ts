import { describe, it, expect, afterEach } from "vitest";
import { serializeSVG, elementToSvg, exportSvgFile } from "./exporter";
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

  it("elementToSvg 五角星/十字输出 polygon", () => {
    expect(elementToSvg(makeElement("star", 0, 0, 100, 100))).toContain("<polygon");
    expect(elementToSvg(makeElement("cross", 0, 0, 100, 100))).toContain("<polygon");
  });

  it("elementToSvg 圆环输出 evenodd 双弧 path", () => {
    const out = elementToSvg(makeElement("donut", 0, 0, 100, 100));
    expect(out).toContain("<path");
    expect(out).toContain('fill-rule="evenodd"');
    expect(out).toContain("A 50 50 0 1 0");
    expect(out).toContain("A 32.5 32.5 0 1 0");
  });

  it("elementToSvg 半圆输出上半圆弧 path", () => {
    const out = elementToSvg(makeElement("half", 0, 0, 100, 100));
    expect(out).toContain("<path");
    expect(out).toContain("M 0 50");
    expect(out).toContain("A 50 50 0 0 1 100 50");
    expect(out).toContain("Z");
  });

  it("elementToSvg 箭头含 line 与箭头多边形", () => {
    const a = makeElement("arrow", 0, 0, 100, 50);
    expect(elementToSvg(a)).toContain("<line");
    expect(elementToSvg(a)).toContain("<polygon");
  });

  it("elementToSvg 虚线描边输出 stroke-dasharray（辅助流语义）", () => {
    const a = makeElement("arrow", 0, 0, 100, 50, { dash: [8, 4] });
    const out = elementToSvg(a);
    expect(out).toContain('stroke-dasharray="8 4"');
    // 只出现一次：XML 不允许重复属性，重复会让 SVG 作为图片加载失败（img.onerror 报"SVG 图片加载失败"）
    expect(out.match(/stroke-dasharray=/g)).toHaveLength(1);
    // 无 dash 的旧元素不输出该属性，保持兼容
    expect(elementToSvg(makeElement("rect", 0, 0, 50, 50))).not.toContain("stroke-dasharray");
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

  it("三独立透明度：fill-opacity/stroke-opacity 与整体 opacity 相乘输出；旧元素不输出保持兼容", () => {
    const r = makeElement("rect", 0, 0, 100, 60, { opacity: 0.8, fillOpacity: 0.5, strokeOpacity: 0.25 });
    const out = elementToSvg(r);
    expect(out).toContain('opacity="0.8"');
    expect(out).toContain('fill-opacity="0.4"'); // 0.8 × 0.5
    expect(out).toContain('stroke-opacity="0.2"'); // 0.8 × 0.25
    // 旧元素（无独立透明度字段）不输出 fill/stroke-opacity，导出文件兼容
    const legacy = elementToSvg(makeElement("rect", 0, 0, 100, 60, { opacity: 0.8 }));
    expect(legacy).not.toContain("fill-opacity");
    expect(legacy).not.toContain("stroke-opacity");
  });

  it("箭头透明度：线条 stroke-opacity 与箭头头 fill-opacity 都跟随边框透明度", () => {
    const a = makeElement("arrow", 0, 0, 100, 0, { opacity: 0.8, strokeOpacity: 0.5 });
    const out = elementToSvg(a);
    expect(out).toContain('stroke-opacity="0.4"');
    expect(out).toContain('fill-opacity="0.4"');
    expect(out).toContain("<polygon");
  });

  it("文字与逻辑节点导出填充透明度（逻辑正文保持 0.75 下限）", () => {
    const t = makeElement("text", 0, 0, 50, 20, { text: "hi", opacity: 0.8, fillOpacity: 0.5 });
    expect(elementToSvg(t)).toContain('fill-opacity="0.4"');
    const l = makeElement("logic", 0, 0, 120, 60, { text: "A", body: "行一", opacity: 0.8, fillOpacity: 0.5 });
    const out = elementToSvg(l);
    // 标题 = 0.8×0.5；正文 = max(0.75, 0.8×0.5) 下限 0.75
    expect(out).toContain('fill-opacity="0.4"');
    expect(out).toContain('opacity="0.75"');
  });

  it("阴影元素：serializeSVG 输出 filter defs（sh-{id}）且元素引用 filter；无阴影省略 defs", () => {
    const r = makeElement("rect", 0, 0, 100, 60, {
      id: "r1",
      shadow: { color: "#000000", blur: 8, dx: 2, dy: 3, opacity: 0.3 },
    });
    const svg = serializeSVG({ width: 1600, height: 1000, elements: [r] });
    expect(svg).toContain('<filter id="sh-r1"');
    expect(svg).toContain('dx="2" dy="3" stdDeviation="8"');
    expect(svg).toContain('flood-color="#000000" flood-opacity="0.3"');
    expect(svg).toContain('filter="url(#sh-r1)"');
    const plain = serializeSVG({ width: 1600, height: 1000, elements: [makeElement("rect", 0, 0, 10, 10)] });
    expect(plain).not.toContain("<defs>");
    expect(plain).not.toContain("feDropShadow");
  });

  it("文字/逻辑/图片元素带阴影时引用 filter defs", () => {
    const t = makeElement("text", 0, 0, 50, 20, { text: "hi", shadow: { color: "#111111", blur: 4, dx: 0, dy: 0, opacity: 0.5 } });
    const out = elementToSvg(t);
    expect(out).toContain('filter="url(#sh-');
  });

  it("crop+scale：输出尺寸取整且 = 裁剪区尺寸 × 倍率（宽高必须为整数，canvas 只接受整数）", () => {
    const doc = { width: 1600, height: 1000, elements: [makeElement("rect", 100, 100, 120, 80)] };
    // 组合/对象导出：crop 为选中元素包围盒（世界坐标可为小数），scale 4x
    const crop = { x: 100.5, y: 100.25, width: 119.75, height: 79.5 };
    const svg = serializeSVG(doc, 4, false, crop);
    const w = svg.match(/width="(\d+)"/)![1];
    const h = svg.match(/height="(\d+)"/)![1];
    expect(Number(w)).toBe(Math.round(119.75 * 4)); // 479
    expect(Number(h)).toBe(Math.round(79.5 * 4)); // 318
    expect(Number(w) % 1).toBe(0);
    expect(Number(h) % 1).toBe(0);
    // viewBox 用裁剪区原始尺寸（小数 OK），元素整体平移使区域落在原点
    expect(svg).toContain('viewBox="0 0 119.75 79.5"');
    expect(svg).toContain('translate(-100.5 -100.25)');
  });

  it("crop 导出：区域外元素被 viewBox 裁剪，区域内元素可见（组合整体导出不空）", () => {
    const inside = makeElement("rect", 100, 100, 120, 80);
    const outside = makeElement("text", 500, 500, 100, 24, { text: "外面" });
    const doc = { width: 1600, height: 1000, elements: [inside, outside] };
    // 只选中组合成员（inside）→ crop = 其包围盒
    const crop = { x: 100, y: 100, width: 120, height: 80 };
    const svg = serializeSVG(doc, 1, false, crop);
    expect(svg).toContain("<rect"); // 组内元素存在
    expect(svg).toContain("translate(-100 -100)"); // 平移使 crop 落原点
    expect(svg).toContain('viewBox="0 0 120 80"');
    // 区域外文字仍在 SVG 中（被 viewBox 裁剪），但内容不缺失
    expect(svg).toContain("外面");
  });

  it("包含背景色：默认画布（background 缺省）勾选后导出白色背景（与画布渲染一致）", () => {
    const doc = { width: 1600, height: 1000, elements: [makeElement("rect", 10, 10, 100, 60)] };
    // 缺省 background（undefined，渲染默认白底）→ includeBackground=true 必须输出铺满画布的白色背景 rect
    const svg = serializeSVG(doc, 1, true);
    expect(svg).toContain('<rect x="0" y="0" width="1600" height="1000" fill="#ffffff"/>');
    // 不勾选仍透明（无铺满画布的背景 rect）
    const noBg = serializeSVG(doc, 1, false);
    expect(noBg).not.toContain('<rect x="0" y="0" width="1600" height="1000"');
  });

  it("包含背景色：显式纯色 / none 透明 / 渐变 均正确", () => {
    const el = makeElement("rect", 10, 10, 100, 60);
    const solid = serializeSVG({ width: 100, height: 100, background: "#ff0000", elements: [el] }, 1, true);
    expect(solid).toContain('fill="#ff0000"');
    const none = serializeSVG({ width: 100, height: 100, background: "none", elements: [el] }, 1, true);
    expect(none).not.toContain('<rect x="0" y="0"');
    const grad = serializeSVG({ width: 100, height: 100, background: "linear:#fff,#000", elements: [el] }, 1, true);
    expect(grad).toContain("<linearGradient");
    expect(grad).toContain('fill="url(#export-bg-grad)"');
  });

  it("分块导出窗口：tile 指定世界坐标窗口，viewBox = 窗口、元素不整体平移（背景 rect 从原点铺满）", () => {
    const el = makeElement("rect", 100, 100, 120, 80);
    const doc = { width: 1600, height: 1000, elements: [el] };
    const crop = { x: 100, y: 100, width: 120, height: 80 };
    // 分块窗口 = 世界坐标子区域（如左上块）
    const tile = { x: 100, y: 100, width: 60, height: 40 };
    const svg = serializeSVG(doc, 1, false, crop, tile);
    expect(svg).toContain('viewBox="100 100 60 40"');
    // 分块时不整体平移（元素保持世界坐标，窗口即裁剪）
    expect(svg).not.toContain('translate(-100 -100)');
    // 元素仍以世界坐标输出
    expect(svg).toContain('x="100"');
  });

  it("exportSvgFile：勾选包含背景色后 SVG 带画布背景（默认缺省白底 → 白色 rect）", async () => {
    // jsdom 未实现 URL.createObjectURL / revokeObjectURL / anchor.click / Blob.text：stub 捕获 blob，
    // 用 FileReader（jsdom 已实现）读内容
    let captured: Blob | null = null;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob: Blob) => {
      captured = blob;
      return "blob:mock";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    afterEach(() => {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    });
    const blobText = (b: Blob) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read blob failed"));
        r.readAsText(b);
      });
    const doc = { width: 1600, height: 1000, elements: [makeElement("rect", 10, 10, 100, 60)] };
    // 勾选包含背景色：SVG 内容必须含铺满画布的白色背景 rect（与 PNG 导出一致）
    exportSvgFile(doc, "figure.svg", undefined, true);
    expect(captured).not.toBeNull();
    const text = await blobText(captured!);
    expect(text).toContain('<rect x="0" y="0" width="1600" height="1000" fill="#ffffff"/>');
    // 不勾选：仍透明（无铺满画布的背景 rect）
    exportSvgFile(doc, "figure.svg", undefined, false);
    expect(captured).not.toBeNull();
    const text2 = await blobText(captured!);
    expect(text2).not.toContain('<rect x="0" y="0" width="1600" height="1000"');
  });
});
