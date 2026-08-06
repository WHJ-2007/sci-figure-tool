import type { CanvasDocument, CanvasElement } from "./types";
import { shapePoints, arrowHeadPoints, arrowHeadSize, curveControl, arrowPathD, arrowPoints } from "./geometry";
import { contrastTextColor, elementTransform } from "./elements";

const XML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => XML_ESCAPE[c]);
}

export function elementToSvg(e: CanvasElement): string {
  // 边框/内部/整体三套独立透明度：填充、边框各自与整体 opacity 相乘输出（与画布渲染一致）；
  // 旧元素（无独立透明度）不输出 fill-opacity/stroke-opacity，保持导出文件兼容
  const fillOpacity = e.fillOpacity !== undefined ? ` fill-opacity="${e.opacity * e.fillOpacity}"` : "";
  const strokeOpacity = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
  const filter = e.shadow ? ` filter="url(#sh-${e.id})"` : "";
  const attrs = `x="${e.x}" y="${e.y}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${fillOpacity}${strokeOpacity}`;
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
    case "hexagon": {
      const pts = shapePoints(e.type, e)
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      return `<polygon ${attrs} points="${pts}"${rot}${sh}/>`;
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
          ? `<path d="${arrowPathD(pts)}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${lineO} stroke-linejoin="round"/>`
          : `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${lineO}/>`;
        return `<g${rot}${sh}>${line}${headPts(pts)}</g>`;
      }
      return `<g${rot}${sh}><line x1="${e.x}" y1="${e.y}" x2="${x2}" y2="${y2}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${lineO}/>${headPts([{ x: e.x, y: e.y }, { x: x2, y: y2 }])}</g>`;
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
      return `<g${rot}${sh}><polyline points="${pts}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${lineO}/>${head}</g>`;
    }
    case "curve": {
      const c = curveControl(e);
      const lineO = e.strokeOpacity !== undefined ? ` stroke-opacity="${e.opacity * e.strokeOpacity}"` : "";
      return `<path d="M ${e.x} ${e.y} Q ${c.x} ${c.y} ${e.x + e.width} ${e.y + e.height}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${lineO}${rot}${sh}/>`;
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
    case "image":
      // 位图图片：与画布渲染一致（拉伸填充 + 描边边框）
      return `<g${rot}${sh}><image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${esc(e.src)}" preserveAspectRatio="none" opacity="${e.opacity}"/><rect ${attrs} width="${e.width}" height="${e.height}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"/></g>`;
    case "logic": {
      // 逻辑节点：圆角矩形 + 标题（顶部）+ 多行正文（小 2 号），布局与 logicBoxSize 公式一致
      const weight = e.bold ? ' font-weight="bold"' : "";
      const titleColor = contrastTextColor(e.fill);
      const bodyFontSize = Math.max(10, e.fontSize - 2);
      const lineH = bodyFontSize * 1.4;
      const body = (e.body ?? "").split("\n")
        .filter((l) => l !== "")
        .map((l, i) => `<text x="${e.x + e.width / 2}" y="${e.y + 5 + e.fontSize * 1.4 + i * lineH + lineH / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${bodyFontSize}" font-family="${e.fontFamily}" fill="${titleColor}" opacity="${Math.max(0.75, e.opacity * (e.fillOpacity ?? 1))}">${esc(l)}</text>`)
        .join("");
      return `<g${rot}${sh}><rect ${attrs} width="${e.width}" height="${e.height}" rx="${e.rx}"/><text x="${e.x + e.width / 2}" y="${e.y + 5 + (e.fontSize * 1.4) / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${e.fontSize}" font-family="${e.fontFamily}"${weight} fill="${titleColor}" opacity="${e.opacity}"${fillOpacity}>${esc(e.text)}</text>${body}</g>`;
    }
  }
}

export function serializeSVG(doc: CanvasDocument): string {
  const body = [...doc.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map(elementToSvg)
    .join("\n");
  // 导出图片不带画布背景：背景属于编辑态样式，用户要求导出完全透明
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
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n${defs}${body}\n</svg>`;
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

export async function exportPng(doc: CanvasDocument, filename = "figure.png") {
  const svg = serializeSVG(doc);
  const dataUrl = await svgToPngDataUrl(svg, doc.width, doc.height);
  downloadDataUrl(dataUrl, filename);
}

export function exportSvgFile(doc: CanvasDocument, filename = "figure.svg") {
  const blob = new Blob([serializeSVG(doc)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
