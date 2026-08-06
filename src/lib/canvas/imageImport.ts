// 图片导入（外部文件 → 画布图片元素）：按钮选择 / 拖放 / 粘贴共用。
// 图片以 dataURL 存入元素 src，随画布持久化（SVG/PNG 导出内嵌）。

import { makeElement } from "./elements";
import type { ImageElement } from "./types";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./geometry";

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("读取失败"));
    r.readAsDataURL(file);
  });
}

// 读取图片自然尺寸（用于按原始比例摆放）
export function imageNaturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = dataUrl;
  });
}

// 生成图片元素：按原始比例缩放（不放大，上限 maxW×maxH），以 (cx, cy) 为中心，钳制在画布内
export function makeImageElement(
  src: string,
  natW: number,
  natH: number,
  cx: number,
  cy: number,
  maxW = 400,
  maxH = 300
): ImageElement {
  const safeW = Math.max(1, natW);
  const safeH = Math.max(1, natH);
  const scale = Math.min(1, maxW / safeW, maxH / safeH);
  const width = Math.max(8, safeW * scale);
  const height = Math.max(8, safeH * scale);
  const x = Math.min(Math.max(cx - width / 2, 0), CANVAS_WIDTH - width);
  const y = Math.min(Math.max(cy - height / 2, 0), CANVAS_HEIGHT - height);
  return makeElement("image", x, y, width, height, { src }) as ImageElement;
}

// 文件 → 图片元素（读取失败返回 null，调用方决定落点/落画布）
export async function loadImageElement(file: File, cx: number, cy: number): Promise<ImageElement | null> {
  try {
    const dataUrl = await fileToDataUrl(file);
    const nat = await imageNaturalSize(dataUrl);
    return makeImageElement(dataUrl, nat.width, nat.height, cx, cy);
  } catch {
    return null;
  }
}
