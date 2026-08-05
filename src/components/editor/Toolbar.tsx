"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { exportSvgFile, exportPng } from "@/lib/canvas/exporter";
import type { ToolType } from "@/lib/canvas/types";

// 小手图标用内联 SVG（非 emoji），描边风格与工具栏一致
const HAND_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

const TOOLS: { title: string; tool: ToolType; label: ReactNode }[] = [
  { title: "小手（拖动画布）", tool: "hand", label: HAND_ICON },
  { title: "选择", tool: "select", label: "↖" },
  { title: "矩形", tool: "rect", label: "▢" },
  { title: "圆角矩形", tool: "rounded", label: "▭" },
  { title: "椭圆", tool: "ellipse", label: "○" },
  { title: "三角形", tool: "triangle", label: "△" },
  { title: "菱形", tool: "diamond", label: "◇" },
  { title: "六边形", tool: "hexagon", label: "⬡" },
  { title: "箭头", tool: "arrow", label: "→" },
  { title: "折线", tool: "polyline", label: "↯" },
  { title: "文字", tool: "text", label: "T" },
];

export default function Toolbar() {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const doc = useCanvasStore((s) => s.doc);

  return (
    <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-2 py-1">
      {TOOLS.map((t) => (
        <button
          key={t.title}
          title={t.title}
          onClick={() => setTool(t.tool)}
          className={`h-8 w-8 rounded text-base leading-none ${tool === t.tool ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"}`}
        >
          {t.label}
        </button>
      ))}
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <button title="撤销" onClick={undo} className="h-8 w-8 rounded hover:bg-gray-100">↩</button>
      <button title="重做" onClick={redo} className="h-8 w-8 rounded hover:bg-gray-100">↪</button>
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <button title="导出 SVG" onClick={() => exportSvgFile(doc)} className="rounded px-2 py-1 text-sm hover:bg-gray-100">SVG</button>
      <button title="导出 PNG" onClick={() => exportPng(doc).catch(console.error)} className="rounded px-2 py-1 text-sm hover:bg-gray-100">PNG</button>
      <span className="flex-1" />
      <Link href="/settings" className="rounded px-2 py-1 text-sm hover:bg-gray-100" title="设置">⚙</Link>
    </div>
  );
}
