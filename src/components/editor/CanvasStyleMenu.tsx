"use client";

import { useCanvasStore } from "@/lib/canvas/store";

// 画布样式候选：无填充 + 低饱和纯色 + 低饱和对角渐变（渲染与导出共用同一格式）
export const CANVAS_SOLIDS = [
  { value: "none", label: "无填充" },
  { value: "#ffffff", label: "纯白" },
  { value: "#f7fafc", label: "雾蓝灰" },
  { value: "#eef4ff", label: "淡蓝" },
  { value: "#f0fdf4", label: "淡绿" },
  { value: "#fffbeb", label: "淡暖黄" },
  { value: "#f5f3ff", label: "淡紫" },
  { value: "#fff1f2", label: "淡粉" },
];

export const CANVAS_GRADIENTS = [
  { value: "linear:#eef4ff,#fdf2f8", label: "蓝粉渐变" },
  { value: "linear:#e0f2fe,#f0fdfa", label: "天青渐变" },
  { value: "linear:#f5f3ff,#fdf4ff", label: "紫粉渐变" },
  { value: "linear:#ecfeff,#fef9c3", label: "青黄渐变" },
];

export default function CanvasStyleMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const setBackground = useCanvasStore((s) => s.setBackground);
  const current = useCanvasStore((s) => s.doc.background);

  const pick = (value: string) => {
    // 纯白即默认（缺省 undefined），与旧画布一致
    setBackground(value === "#ffffff" ? undefined : value);
    onClose();
  };

  const swatch = (value: string, label: string) => {
    const active = (current ?? "#ffffff") === value;
    return (
      <button
        key={value}
        title={label}
        aria-label={`画布样式 ${label}`}
        onClick={() => pick(value)}
        className={`lift h-7 w-7 shrink-0 rounded-full border ${active ? "border-blue-500 ring-2 ring-blue-300" : "border-black/15"}`}
        style={{
          background:
            value === "none"
              ? "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 0 0/8px 8px"
              : value.startsWith("linear:")
                ? `linear-gradient(135deg, ${value.slice(7).replace(",", ", ")})`
                : value,
        }}
      />
    );
  };

  return (
    <div
      data-testid="canvas-style-menu"
      className="fixed z-50 w-52 rounded-xl border border-white/50 bg-white/85 p-3 shadow-xl backdrop-blur-md"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">画布样式</div>
      <div className="mb-2 flex flex-wrap gap-1.5">{CANVAS_SOLIDS.map((s) => swatch(s.value, s.label))}</div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">渐变</div>
      <div className="flex flex-wrap gap-1.5">{CANVAS_GRADIENTS.map((g) => swatch(g.value, g.label))}</div>
      <div className="mt-2 border-t border-white/60 pt-1.5 text-[10px] text-gray-400">右键空白画布选择底色</div>
    </div>
  );
}
