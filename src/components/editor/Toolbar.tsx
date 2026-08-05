"use client";

import Link from "next/link";
import { useCanvasStore } from "@/lib/canvas/store";
import { exportSvgFile, exportPng } from "@/lib/canvas/exporter";
import type { ToolType } from "@/lib/canvas/types";

const TOOLS: { title: string; tool: ToolType; label: string }[] = [
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
