import type { CanvasDocument, CanvasElement } from "./types";
import { shapePoints, arrowHeadPoints, arrowHeadSize, curveControl, arrowPathD, arrowPoints } from "./geometry";
import { contrastTextColor, elementTransform } from "./elements";
import { latexToUnicode } from "./formula";

const XML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => XML_ESCAPE[c]);
}

export function elementToSvg(e: CanvasElement): string {
  // 边框/内部/整体三套独立透明度：填充、边框各自与整体 opacity 相乘输出（与画布渲染一致）；
  // 旧元素（无独立透明度）不输出 fill-opacity/stroke-opacity，保持导出文件兼容
  const fillOpacity = e.fillOpacity !== undefined ? ` fill-opacity="${e.opacity * e.fillOpacity}"` : "";
  const strokeOpacity = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
  const dash = e.dash ? ` stroke-dasharray="${e.dash.join(" ")}"` : "";
  const filter = e.shadow ? ` filter="url(#sh-${e.id})"` : "";
  const attrs = `x="${e.x}" y="${e.y}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash}${dash} opacity="${e.opacity}"${fillOpacity}${strokeOpacity}`;
  const t = elementTransform(e);
  const rot = t ? ` transform="${t}"` : "";
  // 投影 filter 引用（defs 由 serializeSVG 输出），与渲染一致的 id
  const sh = filter;
  switch (e.type) {
    case "rect":
      return `<rect ${attrs} width="${e.width}" height="${e.height}" rx="${e.rx}"${rot}${sh}/>`;
    case "ellipse":
      return `<ellipse ${attrs} cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}"${rot}${sh}/>`;
    case "triangle":
    case "diamond":
    case "hexagon":
    case "star":
    case "cross": {
      const pts = shapePoints(e.type, e)
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      return `<polygon ${attrs} points="${pts}"${rot}${sh}/>`;
    }
    case "donut": {
      // 圆环：与画布渲染一致（evenodd 双弧，内孔 0.65）
      const rx = e.width / 2;
      const ry = e.height / 2;
      const cx = e.x + rx;
      const cy = e.y + ry;
      const irx = rx * 0.65;
      const iry = ry * 0.65;
      const d = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} M ${cx - irx} ${cy} A ${irx} ${iry} 0 1 0 ${cx + irx} ${cy} A ${irx} ${iry} 0 1 0 ${cx - irx} ${cy}`;
      return `<path ${attrs} d="${d}" fill-rule="evenodd"${rot}${sh}/>`;
    }
    case "half": {
      // 半圆（上半圆）：与画布渲染一致的 path
      const rx = e.width / 2;
      const ry = e.height / 2;
      const cy = e.y + ry;
      return `<path ${attrs} d="M ${e.x} ${cy} A ${rx} ${ry} 0 0 1 ${e.x + e.width} ${cy} Z"${rot}${sh}/>`;
    }
    case "arrow": {
      const x2 = e.x + e.width;
      const y2 = e.y + e.height;
      // 箭头头部 polygon（none=空，single=终点，double=终点+起点反向）；透明度跟随边框
      const headO = e.strokeOpacity !== undefined ? ` fill-opacity="${e.opacity * e.strokeOpacity}"` : "";
      const headPts = (pts: { x: number; y: number }[]): string => {
        const head = e.head ?? "single";
        if (head === "none") return "";
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] ?? pts[0];
        const size = arrowHeadSize(e.strokeWidth);
        const polys = [
          arrowHeadPoints(prev.x, prev.y, last.x, last.y, size)
            .map((p) => `${p.x},${p.y}`)
            .join(" "),
        ];
        if (head === "double") {
          const first = pts[0];
          const second = pts[1] ?? last;
          polys.push(
            arrowHeadPoints(second.x, second.y, first.x, first.y, size)
              .map((p) => `${p.x},${p.y}`)
              .join(" ")
          );
        }
        return polys.map((p) => `<polygon points="${p}" fill="${e.stroke}"${headO}/>`).join("");
      };
      const lineO = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
      // 带折点的箭头：折线路径 + 箭头方向取末段（折点为相对坐标，arrowPoints 转世界坐标）
      if ((e.midPoints?.length ?? 0) > 0) {
        const pts = arrowPoints(e);
        // 含平滑折点 → Catmull-Rom 曲线路径（与渲染一致）；全尖锐 → 折线
        const hasSmooth = e.midPoints!.some((m) => m.smooth);
        const line = hasSmooth
          ? `<path d="${arrowPathD(pts)}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"${lineO} stroke-linejoin="round"/>`
          : `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"${lineO}/>`;
        return `<g${rot}${sh}>${line}${headPts(pts)}</g>`;
      }
      return `<g${rot}${sh}><line x1="${e.x}" y1="${e.y}" x2="${x2}" y2="${y2}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"${lineO}/>${headPts([{ x: e.x, y: e.y }, { x: x2, y: y2 }])}</g>`;
    }
    case "polyline": {
      const pts = e.points.map((p) => `${p.x},${p.y}`).join(" ");
      const lineO = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
      const head = e.arrow === false
        ? ""
        : (() => {
            const last = e.points[e.points.length - 1];
            const prev = e.points[e.points.length - 2] ?? e.points[0];
            const h = arrowHeadPoints(prev.x, prev.y, last.x, last.y, arrowHeadSize(e.strokeWidth))
              .map((p) => `${p.x},${p.y}`)
              .join(" ");
            const headO = e.strokeOpacity !== undefined ? ` fill-opacity="${e.opacity * e.strokeOpacity}"` : "";
            return `<polygon points="${h}" fill="${e.stroke}"${headO}/>`;
          })();
      return `<g${rot}${sh}><polyline points="${pts}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"${lineO}/>${head}</g>`;
    }
    case "pen": {
      // 画笔手写笔迹：圆头圆角平滑描边（与画布渲染一致）
      const pts = e.points.map((p) => `${p.x},${p.y}`).join(" ");
      const lineO = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
      return `<g${rot}${sh}><polyline points="${pts}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"${lineO} stroke-linecap="round" stroke-linejoin="round"/></g>`;
    }
    case "curve": {
      const c = curveControl(e);
      const lineO = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
      return `<path d="M ${e.x} ${e.y} Q ${c.x} ${c.y} ${e.x + e.width} ${e.y + e.height}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"${lineO}${rot}${sh}/>`;
    }
    case "sector": {
      const r = e.radius;
      const sx = e.x + r * Math.cos(e.startAngle);
      const sy = e.y + r * Math.sin(e.startAngle);
      const ex = e.x + r * Math.cos(e.endAngle);
      const ey = e.y + r * Math.sin(e.endAngle);
      const d = e.endAngle - e.startAngle;
      // sweep 恒为 1（角度增大方向）：跨 0 回绕（endAngle < startAngle）时实际扫过 2π+d，
      // 大弧条件是 d > π（正扫）或 d ∈ (-π, 0)（回绕且缺口小于 π），与 angleInSector 语义一致
      const largeArc = d > Math.PI || (d < 0 && d > -Math.PI) ? 1 : 0;
      // 空心扇形（饼图环形）：外弧 + 内孔弧反向闭合（与画布渲染一致）
      if (e.innerRadius && e.innerRadius > 0) {
        const ir = e.innerRadius;
        const isx = e.x + ir * Math.cos(e.startAngle);
        const isy = e.y + ir * Math.sin(e.startAngle);
        const iex = e.x + ir * Math.cos(e.endAngle);
        const iey = e.y + ir * Math.sin(e.endAngle);
        const dd = `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} L ${iex} ${iey} A ${ir} ${ir} 0 ${largeArc} 0 ${isx} ${isy} Z`;
        return `<path ${attrs} d="${dd}"${rot}${sh}/>`;
      }
      return `<path d="M ${e.x} ${e.y} L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z" ${attrs}${rot}/>`;
    }
    case "text": {
      const anchor = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
      const tx = e.align === "left" ? e.x : e.align === "right" ? e.x + e.width : e.x + e.width / 2;
      const weight = e.bold ? ' font-weight="bold"' : "";
      const style = e.italic ? ' font-style="italic"' : "";
      const textAttrs = `fill="${e.fill}" opacity="${e.opacity}"${fillOpacity}`;
      return `<text ${textAttrs} x="${tx}" y="${e.y + e.height / 2}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${e.fontSize}" font-family="${e.fontFamily}"${weight}${style}${rot}${sh}>${esc(e.text)}</text>`;
    }
    case "formula": {
      // 公式元素：衬线斜体排版，渲染前把 LaTeX 源码转成 Unicode 数学符号（与画布渲染一致）
      const anchor = e.align === "left" ? "start" : e.align === "right" ? "end" : "middle";
      const tx = e.align === "left" ? e.x : e.align === "right" ? e.x + e.width : e.x + e.width / 2;
      const weight = e.bold ? ' font-weight="bold"' : "";
      const style = e.italic ? ' font-style="italic"' : "";
      const textAttrs = `fill="${e.fill}" opacity="${e.opacity}"${fillOpacity}`;
      return `<text ${textAttrs} x="${tx}" y="${e.y + e.height / 2}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${e.fontSize}" font-family="${e.fontFamily}"${weight}${style}${rot}${sh}>${esc(latexToUnicode(e.text))}</text>`;
    }
    case "image":
      // 位图图片：与画布渲染一致（拉伸填充 + 描边边框）
      return `<g${rot}${sh}><image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${esc(e.src)}" preserveAspectRatio="none" opacity="${e.opacity}"/><rect ${attrs} width="${e.width}" height="${e.height}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}"${dash} opacity="${e.opacity}"/></g>`;
    case "logic": {
      // 逻辑节点：可多种外形（矩形/平行四边形/菱形）+ 标题（顶部）+ 多行正文（小 2 号），布局与 logicBoxSize 公式一致
      const weight = e.bold ? ' font-weight="bold"' : "";
      const titleColor = contrastTextColor(e.fill);
      const bodyFontSize = Math.max(10, e.fontSize - 2);
      const lineH = bodyFontSize * 1.4;
      const body = (e.body ?? "").split("\n")
        .filter((l) => l !== "")
        .map((l, i) => `<text x="${e.x + e.width / 2}" y="${e.y + 5 + e.fontSize * 1.4 + i * lineH + lineH / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${bodyFontSize}" font-family="${e.fontFamily}" fill="${titleColor}" opacity="${Math.max(0.75, e.opacity * (e.fillOpacity ?? 1))}">${esc(l)}</text>`)
        .join("");
      const shape = e.shape ?? "rect";
      // 平行四边形：上下边各向左右倾斜（offset = 宽/6）；菱形：四顶点取中点
      const off = shape === "parallelogram" ? e.width / 6 : 0;
      const shapeEl = shape === "diamond"
        ? `<polygon points="${e.x + e.width / 2},${e.y} ${e.x + e.width},${e.y + e.height / 2} ${e.x + e.width / 2},${e.y + e.height} ${e.x},${e.y + e.height / 2}" ${attrs} stroke-linejoin="round"/>`
        : shape === "parallelogram"
          ? `<polygon points="${e.x + off},${e.y} ${e.x + e.width + off},${e.y} ${e.x + e.width - off},${e.y + e.height} ${e.x - off},${e.y + e.height}" ${attrs} stroke-linejoin="round"/>`
          : `<rect ${attrs} width="${e.width}" height="${e.height}" rx="${e.rx}"/>`;
      return `<g${rot}${sh}>${shapeEl}<text x="${e.x + e.width / 2}" y="${e.y + 5 + (e.fontSize * 1.4) / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${e.fontSize}" font-family="${e.fontFamily}"${weight} fill="${titleColor}" opacity="${e.opacity}"${fillOpacity}>${esc(e.text)}</text>${body}</g>`;
    }
  }
}

// 序列化画布为 SVG 字符串。scale > 1 时放大输出尺寸（width/height × scale，
// viewBox 不变 → 矢量内容等比放大），供 PNG 超采样导出：4x 下放大到最大也无锯齿。
// includeBackground=true 时输出画布背景（纯色/渐变），缺省 false 保持导出透明背景（贴论文/幻灯片用）。
// crop 指定世界坐标导出区域（框选/对象导出）：输出尺寸 = crop 尺寸，元素整体平移使区域落在原点。
// tile 指定世界坐标渲染窗口（分块导出用）：viewBox = 窗口、元素不整体平移（窗口即裁剪），
// 每块独立小 SVG 矢量渲染再拼合，突破浏览器对超大 SVG 整幅光栅化的尺寸上限（糊/锯齿的根因）。
export function serializeSVG(doc: CanvasDocument, scale = 1, includeBackground = false, crop?: { x: number; y: number; width: number; height: number }, tile?: { x: number; y: number; width: number; height: number }): string {
  const vx = crop?.x ?? 0;
  const vy = crop?.y ?? 0;
  const vw = tile?.width ?? crop?.width ?? doc.width;
  const vh = tile?.height ?? crop?.height ?? doc.height;
  const body = [...doc.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map(elementToSvg)
    .join("\n");
  // 分块（tile）时元素保持世界坐标，窗口由 viewBox 裁剪；整体 crop 时平移使区域落原点
  const wrapped = !tile && crop ? `<g transform="translate(${-crop.x} ${-crop.y})">\n${body}\n</g>` : body;
  // 投影 filter defs：与画布渲染一致的 id（sh-{id}），无阴影元素时省略 defs 保持旧导出兼容
  const shadows = doc.elements.filter((e) => e.shadow);
  const defs = shadows.length
    ? `<defs>${shadows
        .map(
          (e) =>
            `<filter id="sh-${e.id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${e.shadow!.dx}" dy="${e.shadow!.dy}" stdDeviation="${e.shadow!.blur}" flood-color="${e.shadow!.color}" flood-opacity="${e.shadow!.opacity}"/></filter>`
        )
        .join("")}</defs>\n`
    : "";
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  // 含背景：纯色直出 rect，渐变输出 linearGradient defs + 引用 rect；"none" 不输出（透明）。
  // 关键：画布渲染时 background 缺省（undefined）按白色处理（backgroundFill 默认 #ffffff），
  // 导出勾选"包含背景色"也必须一致——此前只判断 doc.background 真值，缺省时被跳过导致白底画布导出成透明
  const rawBg = includeBackground ? (doc.background ?? "#ffffff") : undefined;
  const bg = rawBg && rawBg !== "none" ? rawBg : undefined;
  let bgBody = "";
  let bgDefs = "";
  if (bg) {
    if (bg.startsWith("linear:")) {
      const [c1, c2] = bg.slice(7).split(",");
      bgDefs = `<defs><linearGradient id="export-bg-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>\n`;
      bgBody = `<rect x="${tile ? 0 : -vx}" y="${tile ? 0 : -vy}" width="${doc.width}" height="${doc.height}" fill="url(#export-bg-grad)"/>\n`;
    } else {
      bgBody = `<rect x="${tile ? 0 : -vx}" y="${tile ? 0 : -vy}" width="${doc.width}" height="${doc.height}" fill="${bg}"/>\n`;
    }
  }
  const viewBox = tile ? `${tile.x} ${tile.y} ${tile.width} ${tile.height}` : `0 0 ${vw} ${vh}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">\n${bgDefs}${defs}${bgBody}${wrapped}\n</svg>`;
}

export async function svgToPngDataUrl(svg: string, width: number, height: number): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG 图片加载失败"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// PNG 导出超采样倍率：4x 超高清（6400×4000），矢量渲染放大到最大也无锯齿
export const PNG_EXPORT_SCALE = 4;

export interface PngExportOptions {
  scale?: number; // 超采样倍率（分辨率），缺省 4x
  includeBackground?: boolean; // 含画布背景色，缺省 false（透明背景）
  crop?: { x: number; y: number; width: number; height: number }; // 世界坐标导出区域（框选/对象导出）
  // 进度回调（大图分块渲染时逐块上报；小图整幅渲染时一次性 done=total=1）
  onProgress?: (done: number, total: number) => void;
}

// 浏览器 canvas 真实上限：单边 32767px、总面积约 268M 像素（16384×16384）。
// 之前保守限制 16384 单边导致 64X 大图被过度降倍率（"选了最高分辨率还是一堆锯齿"）。
const CANVAS_DIM_MAX = 32767;
const CANVAS_AREA_MAX = 268_435_456;
// 分块渲染的每块像素边长：远小于浏览器对 SVG 图片整幅光栅化的降采样阈值（约 16384px），
// 每块独立小 SVG 矢量渲染后拼合，保证任意超大输出都真实清晰（无降采样糊边）
const TILE_PX = 4096;

// 把 SVG 字符串加载为 Image（blob URL 方式，与 svgToPngDataUrl 同一加载路径）
async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG 图片加载失败"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(doc: CanvasDocument, filename = "figure.png", opts: PngExportOptions = {}) {
  const crop = opts.crop;
  const vw = crop?.width ?? doc.width;
  const vh = crop?.height ?? doc.height;
  const scale = opts.scale ?? PNG_EXPORT_SCALE;
  // 输出像素尺寸必须取整（canvas.width/height 只接受整数，小数会被截断导致与 SVG 尺寸不一致）
  const outW = Math.max(1, Math.round(vw * scale));
  const outH = Math.max(1, Math.round(vh * scale));
  // 超浏览器 canvas 上限：按比例降倍率（保持宽高比，绝不产出空/失败的 PNG）；
  // 放宽到真实上限后，常见框选区域（如 400×300 世界坐标 × 64X = 25600×19200）不再被 16384 卡住
  const limit = Math.min(1, CANVAS_DIM_MAX / outW, CANVAS_DIM_MAX / outH, Math.sqrt(CANVAS_AREA_MAX / (outW * outH)));
  const w = Math.max(1, Math.round(outW * limit));
  const h = Math.max(1, Math.round(outH * limit));
  const effScale = w / Math.max(1, vw);
  const includeBg = opts.includeBackground ?? false;
  const onProgress = opts.onProgress;
  // 小图（≤4096px 单边）：整幅 SVG 直接渲染
  if (w <= TILE_PX && h <= TILE_PX) {
    onProgress?.(1, 1);
    const svg = serializeSVG(doc, effScale, includeBg, crop);
    const dataUrl = await svgToPngDataUrl(svg, w, h);
    downloadDataUrl(dataUrl, filename);
    return;
  }
  // 大图：分块渲染——每块独立小 SVG（tile 窗口 = 世界坐标子区域）矢量渲染，再拼合到最终 canvas。
  // 避免浏览器把超大 SVG 整幅降采样到 ~16384 再放大（这正是高倍率导出"还是一堆锯齿"的根因）
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  const ox = crop?.x ?? 0;
  const oy = crop?.y ?? 0;
  const tilesX = Math.ceil(w / TILE_PX);
  const tilesY = Math.ceil(h / TILE_PX);
  const totalTiles = tilesX * tilesY;
  let doneTiles = 0;
  for (let ty = 0; ty < h; ty += TILE_PX) {
    for (let tx = 0; tx < w; tx += TILE_PX) {
      const tw = Math.min(TILE_PX, w - tx);
      const th = Math.min(TILE_PX, h - ty);
      // 该块像素区域对应的世界坐标窗口
      const tile = {
        x: ox + tx / effScale,
        y: oy + ty / effScale,
        width: tw / effScale,
        height: th / effScale,
      };
      const tileSvg = serializeSVG(doc, effScale, includeBg, crop, tile);
      const img = await loadSvgImage(tileSvg);
      ctx.drawImage(img, tx, ty);
      doneTiles += 1;
      onProgress?.(doneTiles, totalTiles);
    }
  }
  downloadDataUrl(canvas.toDataURL("image/png"), filename);
}

export function exportSvgFile(doc: CanvasDocument, filename = "figure.svg", crop?: { x: number; y: number; width: number; height: number }, includeBackground = false) {
  // includeBackground 默认 false 保持旧行为（透明背景贴论文）；勾选"包含背景色"后 SVG 也带画布背景
  const blob = new Blob([serializeSVG(doc, 1, includeBackground, crop)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
