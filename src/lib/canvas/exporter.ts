import type { CanvasDocument, CanvasElement } from "./types";
import { shapePoints, arrowHeadPoints, curveControl } from "./geometry";
import { contrastTextColor } from "./elements";

const XML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => XML_ESCAPE[c]);
}

export function elementToSvg(e: CanvasElement): string {
  const attrs = `x="${e.x}" y="${e.y}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"`;
  const rot = e.rotation
    ? ` transform="rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.height / 2})"`
    : "";
  switch (e.type) {
    case "rect":
      return `<rect ${attrs} width="${e.width}" height="${e.height}" rx="${e.rx}"${rot}/>`;
    case "ellipse":
      return `<ellipse ${attrs} cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}"${rot}/>`;
    case "triangle":
    case "diamond":
    case "hexagon": {
      const pts = shapePoints(e.type, e)
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      return `<polygon ${attrs} points="${pts}"${rot}/>`;
    }
    case "arrow": {
      const x2 = e.x + e.width;
      const y2 = e.y + e.height;
      // 带折点的箭头：折线路径 + 箭头方向取末段
      if ((e.midPoints?.length ?? 0) > 0) {
        const pts = [{ x: e.x, y: e.y }, ...e.midPoints!, { x: x2, y: y2 }];
        const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] ?? pts[0];
        const head = arrowHeadPoints(prev.x, prev.y, last.x, last.y)
          .map((p) => `${p.x},${p.y}`)
          .join(" ");
        return `<g${rot}><polyline points="${ptsStr}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"/><polygon points="${head}" fill="${e.stroke}" opacity="${e.opacity}"/></g>`;
      }
      const head = arrowHeadPoints(e.x, e.y, x2, y2)
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      return `<g${rot}><line x1="${e.x}" y1="${e.y}" x2="${x2}" y2="${y2}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"/><polygon points="${head}" fill="${e.stroke}" opacity="${e.opacity}"/></g>`;
    }
    case "polyline": {
      const pts = e.points.map((p) => `${p.x},${p.y}`).join(" ");
      const head = e.arrow === false
        ? ""
        : (() => {
            const last = e.points[e.points.length - 1];
            const prev = e.points[e.points.length - 2] ?? e.points[0];
            const h = arrowHeadPoints(prev.x, prev.y, last.x, last.y)
              .map((p) => `${p.x},${p.y}`)
              .join(" ");
            return `<polygon points="${h}" fill="${e.stroke}" opacity="${e.opacity}"/>`;
          })();
      return `<g${rot}><polyline points="${pts}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"/>${head}</g>`;
    }
    case "curve": {
      const c = curveControl(e);
      return `<path d="M ${e.x} ${e.y} Q ${c.x} ${c.y} ${e.x + e.width} ${e.y + e.height}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"${rot}/>`;
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
      const textAttrs = `fill="${e.fill}" opacity="${e.opacity}"`;
      return `<text ${textAttrs} x="${tx}" y="${e.y + e.height / 2}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${e.fontSize}" font-family="${e.fontFamily}"${weight}${style}${rot}>${esc(e.text)}</text>`;
    }
    case "image":
      // 位图图片：与画布渲染一致（拉伸填充 + 描边边框）
      return `<g${rot}><image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${esc(e.src)}" preserveAspectRatio="none" opacity="${e.opacity}"/><rect ${attrs} width="${e.width}" height="${e.height}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" opacity="${e.opacity}"/></g>`;
    case "logic": {
      // 逻辑节点：圆角矩形 + 标题（顶部）+ 多行正文（小 2 号），布局与 logicBoxSize 公式一致
      const weight = e.bold ? ' font-weight="bold"' : "";
      const titleColor = contrastTextColor(e.fill);
      const bodyFontSize = Math.max(10, e.fontSize - 2);
      const lineH = bodyFontSize * 1.4;
      const body = (e.body ?? "").split("\n")
        .filter((l) => l !== "")
        .map((l, i) => `<text x="${e.x + e.width / 2}" y="${e.y + 5 + e.fontSize * 1.4 + i * lineH + lineH / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${bodyFontSize}" font-family="${e.fontFamily}" fill="${titleColor}" opacity="${Math.max(0.75, e.opacity)}">${esc(l)}</text>`)
        .join("");
      return `<g${rot}><rect ${attrs} width="${e.width}" height="${e.height}" rx="${e.rx}"/><text x="${e.x + e.width / 2}" y="${e.y + 5 + (e.fontSize * 1.4) / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${e.fontSize}" font-family="${e.fontFamily}"${weight} fill="${titleColor}" opacity="${e.opacity}">${esc(e.text)}</text>${body}</g>`;
    }
  }
}

export function serializeSVG(doc: CanvasDocument): string {
  const body = [...doc.elements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map(elementToSvg)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n${body}\n</svg>`;
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
