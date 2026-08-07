// 颜色饱和度工具：调整 hex 颜色的饱和度（S），保持色相/亮度不变。
// 属性面板「整体 → 饱和度」滑块用：拖动时同步调整填充色与边框色，直观控制图标整体鲜艳度。

// #rrggbb / #rgb / rgb() 统一转 {r,g,b}
function parseColor(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = parseColor(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return toHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return toHex(r * 255, g * 255, b * 255);
}

// 调整饱和度（sat ∈ [0,1]），返回新 hex
export function adjustSaturation(hex: string, sat: number): string {
  const { h, s: _s, l } = hexToHsl(hex);
  return hslToHex(h, Math.max(0, Math.min(1, sat)), l);
}

// 当前饱和度（0~1），供滑块显示初始值
export function saturationOf(hex: string): number {
  return hexToHsl(hex).s;
}
