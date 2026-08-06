"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import { exportSvgFile, exportPng } from "@/lib/canvas/exporter";
import type { ToolType } from "@/lib/canvas/types";
import ChartDialog from "./ChartDialog";

// 设置图标：齿轮（描边风格，与左上角工具图标一致）
const SETTINGS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// 逻辑节点图标：圆角框 + 4 个锚点圆点（描边风格，锚点为实心）
const LOGIC_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="21" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

// 撤销/重做图标：逆/顺时针弯箭头（描边风格）
const UNDO_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </svg>
);
const REDO_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
  </svg>
);

// 图表图标：坐标轴 + 三根柱（描边风格，与左坞其他图标一致）
const CHART_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 20V4M4 20h16" />
    <path d="M8 16v-4M13 16V8M18 16v-7" />
  </svg>
);

// 光标图标：选择指针（描边风格，select 默认工具的辨识图标）
const CURSOR_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 3l7 17 2.5-6.5L20 11z" />
  </svg>
);

// 图形图标：圆角矩形描边（图案工具组入口）
const SHAPE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="6" width="16" height="12" rx="1.5" />
  </svg>
);

interface ToolItem {
  title: string;
  tool: ToolType;
  label: ReactNode;
}

// 工具分组：图案 = 所有图形/标注（含箭头连线）
const SHAPE_TOOLS: ToolItem[] = [
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
const SHAPE_TOOL_SET = new Set(SHAPE_TOOLS.map((t) => t.tool));

function ToolButton({ item, active, onClick }: { item: ToolItem; active: boolean; onClick: () => void }) {
  return (
    <button
      title={item.title}
      onClick={onClick}
      className={`lift flex h-9 w-9 items-center justify-center rounded text-base leading-none ${
        active ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
      }`}
    >
      {item.label}
    </button>
  );
}

export default function Toolbar() {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  // 生成中禁撤销/重做：快照不入栈，undo 会破坏 AI 流式状态
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  const doc = useCanvasStore((s) => s.doc);
  const projects = useCanvasStore((s) => s.projects);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const setCurrentProject = useCanvasStore((s) => s.setCurrentProject);
  const createProject = useCanvasStore((s) => s.createProject);
  const renameProject = useCanvasStore((s) => s.renameProject);
  const deleteProject = useCanvasStore((s) => s.deleteProject);
  const [open, setOpen] = useState<"shape" | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const toolRef = useRef<HTMLDivElement>(null);

  // 非阻塞气泡：点击主按钮开/关、点击气泡外任意处关闭（pointerdown 优先于 click，先收气泡再落画布）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (toolRef.current?.contains(t)) return;
      setOpen(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onRename = () => {
    const p = projects.find((x) => x.id === currentProjectId);
    const name = window.prompt("画布名称", p?.name ?? "");
    if (name && name.trim()) renameProject(currentProjectId, name.trim());
  };

  const shapeActive = SHAPE_TOOL_SET.has(tool);

  return (
    <>
      {/* 顶栏：画布标签页 + 导出 + 设置（工具/编辑沉到左侧坞） */}
      <div className="relative z-40 flex items-center gap-1 border-b border-white/40 bg-white/60 px-2 py-1 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {projects.map((p) => {
            const active = p.id === currentProjectId;
            return (
              <div
                key={p.id}
                data-testid="project-tab"
                data-active={active ? "true" : undefined}
                className={`flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-sm ${
                  active ? "border-blue-400 bg-blue-600 text-white" : "border-white/60 bg-white/40 text-gray-600 hover:bg-white/70"
                }`}
              >
                <button
                  title={`切换到 ${p.name}`}
                  onClick={() => setCurrentProject(p.id)}
                  className={`lift max-w-[8rem] truncate ${active ? "" : "hover:text-blue-600"}`}
                >
                  {p.name}
                </button>
                <button
                  title={`删除画布 ${p.name}`}
                  onClick={() => deleteProject(p.id)}
                  className="lift flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs leading-none hover:bg-red-500 hover:text-white"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            title="新建画布"
            onClick={createProject}
            className="lift flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-white/60 bg-white/40 text-gray-600 hover:bg-white/70"
          >
            +
          </button>
        </div>
        <button title="重命名画布" onClick={onRename} className="lift h-8 w-8 shrink-0 rounded hover:bg-gray-100">✎</button>
        <span className="mx-1 h-6 w-px bg-gray-200" />
        <button title="导出 SVG" onClick={() => exportSvgFile(doc)} className="lift rounded px-2 py-1 text-sm hover:bg-gray-100">SVG</button>
        <button title="导出 PNG" onClick={() => exportPng(doc).catch(console.error)} className="lift rounded px-2 py-1 text-sm hover:bg-gray-100">PNG</button>
        <span className="flex-1" />
        <Link href="/settings" className="lift flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100" title="设置">{SETTINGS_ICON}</Link>
      </div>
      {/* 左侧悬浮玻璃坞：撤销/重做最上，下面依次选择/图形/逻辑/图表 */}
      {/* top-[4.625rem]（74px）= 顶栏 41px（h-8 + py-1 + border-b）+ FirstRunHint 33px（py-1.5 + text-sm + border-b），坞落在提示条下方 */}
      <div className="fixed left-4 top-[4.625rem] z-40 flex flex-col items-center gap-1 rounded-2xl border border-white/50 bg-white/70 p-1.5 shadow-xl backdrop-blur-md">
        <button title="撤销" onClick={undo} disabled={isGenerating} className="lift flex h-9 w-9 items-center justify-center rounded hover:bg-gray-100 disabled:bg-transparent disabled:opacity-40">{UNDO_ICON}</button>
        <button title="重做" onClick={redo} disabled={isGenerating} className="lift flex h-9 w-9 items-center justify-center rounded hover:bg-gray-100 disabled:bg-transparent disabled:opacity-40">{REDO_ICON}</button>
        <div className="my-0.5 h-px w-7 bg-gray-200" />
        <button
          title="选择"
          onClick={() => setTool("select")}
          className={`lift flex h-9 w-9 items-center justify-center rounded ${
            tool === "select" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
          }`}
        >
          {CURSOR_ICON}
        </button>
        <div className="relative" ref={toolRef}>
          <button
            title="图形"
            onClick={() => setOpen(open === "shape" ? null : "shape")}
            aria-expanded={open === "shape"}
            className={`lift flex h-9 w-9 items-center justify-center rounded ${
              shapeActive || open === "shape" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
            }`}
          >
            {SHAPE_ICON}
          </button>
          {open === "shape" && (
            <div className="absolute left-full top-0 z-40 ml-2 w-40 rounded-xl border border-white/50 bg-white/80 p-2 shadow-xl backdrop-blur-md">
              <div className="mb-1 px-1 text-[10px] font-medium text-gray-400">图案</div>
              <div className="grid grid-cols-3 gap-1">
                {SHAPE_TOOLS.map((t) => (
                  <ToolButton key={t.tool} item={t} active={t.tool === tool} onClick={() => setTool(t.tool)} />
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          title="逻辑"
          onClick={() => setTool("logic")}
          className={`lift flex h-9 w-9 items-center justify-center rounded ${
            tool === "logic" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
          }`}
        >
          {LOGIC_ICON}
        </button>
        <button title="图表" onClick={() => setChartOpen(true)} className="lift flex h-9 w-9 items-center justify-center rounded hover:bg-gray-100">{CHART_ICON}</button>
      </div>
      <ChartDialog open={chartOpen} onClose={() => setChartOpen(false)} />
    </>
  );
}
