"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

// 选择图标：鼠标指针形状（经典光标轮廓，几何中心对齐 viewBox 中心 (12,12)）
const SELECT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 3.25 L20 12.75 L13 14.75 L9.5 20.75 L7.5 14.25 Z" />
  </svg>
);

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

interface ToolItem {
  title: string;
  tool: ToolType;
  label: ReactNode;
}

// 工具分组：图案 = 所有图形/标注（含箭头连线），逻辑 = 逻辑节点；选择/小手常驻
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
const LOGIC_TOOLS: ToolItem[] = [{ title: "逻辑节点", tool: "logic", label: LOGIC_ICON }];
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
  const doc = useCanvasStore((s) => s.doc);
  const projects = useCanvasStore((s) => s.projects);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const setCurrentProject = useCanvasStore((s) => s.setCurrentProject);
  const createProject = useCanvasStore((s) => s.createProject);
  const renameProject = useCanvasStore((s) => s.renameProject);
  const deleteProject = useCanvasStore((s) => s.deleteProject);
  const [open, setOpen] = useState<"shape" | "logic" | null>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const logicRef = useRef<HTMLDivElement>(null);

  // 非阻塞气泡：点击主按钮开/关、点击气泡外任意处关闭（pointerdown 优先于 click，先收气泡再落画布）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (shapeRef.current?.contains(t) || logicRef.current?.contains(t)) return;
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
  const onDelete = () => {
    if (!window.confirm("删除当前画布？")) return;
    deleteProject(currentProjectId);
  };

  const shapeActive = SHAPE_TOOL_SET.has(tool);
  const currentShape = SHAPE_TOOLS.find((t) => t.tool === tool)?.label ?? SHAPE_TOOLS[0].label;

  return (
    <div className="flex items-center gap-1 border-b border-white/40 bg-white/60 px-2 py-1 backdrop-blur-md">
      <select
        value={currentProjectId}
        onChange={(e) => setCurrentProject(e.target.value)}
        title="切换画布"
        className="lift h-8 max-w-[9rem] rounded border border-white/40 bg-white/60 px-1 text-sm outline-none"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button title="新建画布" onClick={createProject} className="lift h-8 w-8 rounded hover:bg-gray-100">+</button>
      <button title="重命名画布" onClick={onRename} className="lift h-8 w-8 rounded hover:bg-gray-100">✎</button>
      <button title="删除画布" onClick={onDelete} className="lift h-8 w-8 rounded hover:bg-gray-100">✕</button>
      <span className="mx-1 h-6 w-px bg-gray-200" />
      {/* 常驻工具：选择、小手 */}
      <ToolButton
        item={{ title: "选择", tool: "select", label: SELECT_ICON }}
        active={tool === "select"}
        onClick={() => setTool("select")}
      />
      <ToolButton
        item={{ title: "小手（拖动画布）", tool: "hand", label: HAND_ICON }}
        active={tool === "hand"}
        onClick={() => setTool("hand")}
      />
      <span className="mx-1 h-6 w-px bg-gray-200" />
      {/* 图案组：主按钮显示当前选中的子工具图标 */}
      <div className="relative" ref={shapeRef}>
        <button
          title="图案"
          onClick={() => setOpen(open === "shape" ? null : "shape")}
          className={`lift flex h-8 w-8 items-center justify-center rounded text-base leading-none ${
            shapeActive || open === "shape" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
          }`}
        >
          {currentShape}
        </button>
        {open === "shape" && (
          <div className="absolute left-0 top-full z-30 mt-1 grid grid-cols-3 gap-1 rounded-lg border border-white/50 bg-white/75 p-2 shadow-xl backdrop-blur-md">
            {SHAPE_TOOLS.map((t) => (
              <ToolButton key={t.tool} item={t} active={t.tool === tool} onClick={() => setTool(t.tool)} />
            ))}
          </div>
        )}
      </div>
      {/* 逻辑组 */}
      <div className="relative" ref={logicRef}>
        <button
          title="逻辑"
          onClick={() => setOpen(open === "logic" ? null : "logic")}
          className={`lift flex h-8 w-8 items-center justify-center rounded ${
            tool === "logic" || open === "logic" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
          }`}
        >
          {LOGIC_ICON}
        </button>
        {open === "logic" && (
          <div className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-white/50 bg-white/75 p-2 shadow-xl backdrop-blur-md">
            {LOGIC_TOOLS.map((t) => (
              <ToolButton key={t.tool} item={t} active={t.tool === tool} onClick={() => setTool(t.tool)} />
            ))}
          </div>
        )}
      </div>
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <button title="撤销" onClick={undo} className="lift flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100">{UNDO_ICON}</button>
      <button title="重做" onClick={redo} className="lift flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100">{REDO_ICON}</button>
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <button title="导出 SVG" onClick={() => exportSvgFile(doc)} className="lift rounded px-2 py-1 text-sm hover:bg-gray-100">SVG</button>
      <button title="导出 PNG" onClick={() => exportPng(doc).catch(console.error)} className="lift rounded px-2 py-1 text-sm hover:bg-gray-100">PNG</button>
      <span className="flex-1" />
      <Link href="/settings" className="lift flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100" title="设置">{SETTINGS_ICON}</Link>
    </div>
  );
}
