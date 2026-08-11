"use client";

import { useCanvasStore } from "@/lib/canvas/store";
import { elementBounds } from "@/lib/canvas/geometry";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas/geometry";
import ElementShape from "./ElementShape";

// 画布缩略图：平移/缩放画布时在左下角弹出，展示"整个画布"的缩小预览 + 当前视口框。
// 画布本身无边——以所有元素内容（真实包围盒）的并集为"画布范围"；无元素时回退画布尺寸。
// 渲染方式：viewBox 直接指向真实内容范围，复用真实元素渲染（ElementShape）——
// 不做任何简化替换（不画矩形/线条代替），文字、箭头、阴影全部按真实像素缩小。
const MINI_W = 220;
const MINI_H = 132;
const PAD = 24; // viewBox 世界坐标边距（视口框/内容贴边时也留出余量）

export default function CanvasMiniMap({ viewportWidth, viewportHeight }: { viewportWidth: number; viewportHeight: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const view = useCanvasStore((s) => s.view);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of doc.elements) {
    const b = elementBounds(e);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = CANVAS_WIDTH; maxY = CANVAS_HEIGHT;
  }
  const vbx = minX - PAD;
  const vby = minY - PAD;
  const vbw = Math.max(maxX - minX + PAD * 2, 1);
  const vbh = Math.max(maxY - minY + PAD * 2, 1);

  // 当前视口（世界坐标）：屏幕 0..viewport 对应世界 (-ox/scale .. (viewport-ox)/scale)
  const vx = -view.ox / view.scale;
  const vy = -view.oy / view.scale;
  const vw = viewportWidth / view.scale;
  const vh = viewportHeight / view.scale;

  const sorted = [...doc.elements].sort((a, b) => a.zIndex - b.zIndex);
  const shadows = doc.elements.filter((e) => e.shadow);

  return (
    <div
      data-testid="canvas-minimap"
      className="pointer-events-none absolute bottom-2 left-2 z-50 overflow-hidden rounded-2xl border border-white/50 bg-white/80 p-1.5 shadow-xl backdrop-blur-xl"
      style={{ width: MINI_W }}
    >
      <svg width={MINI_W - 12} height={MINI_H} viewBox={`${vbx} ${vby} ${vbw} ${vbh}`}>
        {/* 元素投影 filter：与画布渲染一致的 id（sh-{id}） */}
        <defs>
          {shadows.map((e) => (
            <filter key={e.id} id={`sh-${e.id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx={e.shadow!.dx} dy={e.shadow!.dy} stdDeviation={e.shadow!.blur} floodColor={e.shadow!.color} floodOpacity={e.shadow!.opacity} />
            </filter>
          ))}
        </defs>
        {/* 内容底：浅灰底衬托内容范围 */}
        <rect x={minX - 8} y={minY - 8} width={maxX - minX + 16} height={maxY - minY + 16} rx={6} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={1} />
        {/* 真实元素渲染（真实像素缩小，不做简化替换） */}
        {sorted.map((e) => (
          <ElementShape key={e.id} e={e} />
        ))}
        {/* 视口框 */}
        <rect x={vx} y={vy} width={vw} height={vh} fill="#2563eb18" stroke="#2563eb" strokeWidth={1.4} strokeDasharray="4 3" rx={3} />
      </svg>
    </div>
  );
}
