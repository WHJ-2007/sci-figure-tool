"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/canvas/store";
import { exportSvgFile, exportPng } from "@/lib/canvas/exporter";
import { loadImageElement } from "@/lib/canvas/imageImport";
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from "@/lib/canvas/geometry";
import type { ToolType } from "@/lib/canvas/types";
import ChartDialog from "./ChartDialog";
import FormulaDialog from "./FormulaDialog";
import SettingsDialog from "./SettingsDialog";

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

// 时间线图标：横线 + 圆点刻度（历史版本进度条入口）
const TIMELINE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 12h18" />
    <circle cx="7" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="17" cy="12" r="2" fill="currentColor" stroke="none" />
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

// 画笔图标：笔尖 + 描边轨迹（画笔工具入口）
const PEN_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </svg>
);

// 画笔可选颜色：与编辑模块选色器同款色板（常用黑白灰 + 强饱和主色 / 中饱和 / 深色 / 科研浅色底）
const PEN_SWATCHES = [
  "#ffffff", "#111827", "#2f2f2f", "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#f87171", "#fb923c", "#fbbf24", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa",
  "#b91c1c", "#c2410c", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#8b5cf6",
  "#eef4ff", "#f0fff0", "#fff8e6", "#f3efff", "#ffeef0", "#f8fafc", "#f97316",
];

// 图形图标：圆形描边（图案工具组入口，与文本框按钮并列）
const SHAPE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
  </svg>
);

// 箭头图标：简单直箭头（水平直线 + 箭头尖，描边风格，无弯折）
const ARROW_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12h14" />
    <path d="M13 5l7 7-7 7" />
  </svg>
);

// 文本框图标：字母 T 字形（描边风格，与图形/逻辑等常驻按钮一致）
const TEXT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 6h14M12 6v12" />
  </svg>
);

// 公式图标：π 与 x² 样式（描边风格，数学/物理/化学公式入口）
const FORMULA_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h5M6.5 7v8" />
    <path d="M10 17h4" />
    <path d="M12 7v6" />
    <path d="M15 9l6 6M21 9l-6 6" />
  </svg>
);

// 导出图标：下载箭头（描边风格，与设置齿轮一致）
const EXPORT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

// 导入图标：图片框 + 山与太阳（描边风格，与左坞其他图标一致）
const IMPORT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

interface ToolItem {
  title: string;
  tool: ToolType;
  label: ReactNode;
}

// 线条图标：无头的线段（两点连线，与箭头同逻辑但不画箭头尖）
const LINE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 12h18" />
  </svg>
);

// 新图案图标：五角星 / 十字 / 圆环 / 半圆（描边风格，与线条图标一致）
const STAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" />
  </svg>
);
const CROSS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 4v6H4v4h6v6h4v-6h6v-4h-6V4z" />
  </svg>
);
const DONUT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);
const HALF_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12a8 8 0 0 1 16 0z" />
  </svg>
);

// 工具分组：图案 = 纯图形（箭头/线条是与图案平级的独立坞按钮；文本框是独立分类）
const SHAPE_TOOLS: ToolItem[] = [
  { title: "矩形", tool: "rect", label: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="6" width="16" height="12" /></svg> },
  { title: "圆角矩形", tool: "rounded", label: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="4" /></svg> },
  { title: "椭圆", tool: "ellipse", label: "○" },
  { title: "三角形", tool: "triangle", label: "△" },
  { title: "菱形", tool: "diamond", label: "◇" },
  { title: "六边形", tool: "hexagon", label: "⬡" },
  { title: "五角星", tool: "star", label: STAR_ICON },
  { title: "十字", tool: "cross", label: CROSS_ICON },
  { title: "圆环", tool: "donut", label: DONUT_ICON },
  { title: "半圆", tool: "half", label: HALF_ICON },
  { title: "线条", tool: "line", label: LINE_ICON },
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
  const [dockTop, setDockTop] = useState<number | null>(null);

  // 左侧坞与画布玻璃面板共享真实的视觉上沿。画布位置会受首次配置提示条、
  // 窗口尺寸和布局重排影响，因此不能继续依赖固定 top 偏移。
  useEffect(() => {
    const measure = () => {
      const surface = document.querySelector<HTMLElement>("[data-canvas-surface]");
      if (surface) setDockTop(Math.round(surface.getBoundingClientRect().top));
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    const mutations = new MutationObserver(measure);
    mutations.observe(document.body, { childList: true, subtree: true });
    const surface = document.querySelector<HTMLElement>("[data-canvas-surface]");
    const resize = surface && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (surface) resize?.observe(surface);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      mutations.disconnect();
      resize?.disconnect();
    };
  }, []);
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const jumpTo = useCanvasStore((s) => s.jumpTo);
  // 时间线：past 长度 = 当前在第几步（0 = 最初），总步数 = past + future
  const pastLen = useCanvasStore((s) => s.history.past.length);
  const futureLen = useCanvasStore((s) => s.history.future.length);
  // 生成中禁撤销/重做：快照不入栈，undo 会破坏 AI 流式状态
  const isGenerating = useCanvasStore((s) => s.isGenerating);
  // 无可撤销/重做的内容时按钮变灰：普通历史栈 + 画布级恢复栈（删除画布的撤销/重做）
  const canUndo = useCanvasStore((s) => s.history.past.length > 0 || s.deletedProjects.length > 0);
  const canRedo = useCanvasStore((s) => s.history.future.length > 0 || s.restoredProjects.length > 0);
  const doc = useCanvasStore((s) => s.doc);
  const view = useCanvasStore((s) => s.view);
  const setView = useCanvasStore((s) => s.setView);
  const projects = useCanvasStore((s) => s.projects);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const setCurrentProject = useCanvasStore((s) => s.setCurrentProject);
  const createProject = useCanvasStore((s) => s.createProject);
  const renameProject = useCanvasStore((s) => s.renameProject);
  const deleteProject = useCanvasStore((s) => s.deleteProject);
  const addElement = useCanvasStore((s) => s.addElement);
  const setSelection = useCanvasStore((s) => s.setSelection);
  const penColor = useCanvasStore((s) => s.penColor);
  const penWidth = useCanvasStore((s) => s.penWidth);
  const penStyle = useCanvasStore((s) => s.penStyle);
  const penDrawing = useCanvasStore((s) => s.penDrawing);
  const setPenColor = useCanvasStore((s) => s.setPenColor);
  const setPenWidth = useCanvasStore((s) => s.setPenWidth);
  const setPenStyle = useCanvasStore((s) => s.setPenStyle);
  // 画笔自定义 hex 输入（与编辑模块 ColorPicker 同款双向同步：合法 6 位 hex 即写入，失焦回退显示当前色）
  const [penHex, setPenHex] = useState(penColor);
  useEffect(() => setPenHex(penColor), [penColor]);
  // 画笔取色器面板开关：点击画笔图标展开，再次点击同一图标收起（toggle）
  const [penOpen, setPenOpen] = useState(false);
  // 取色器面板 portal 到 body 后的 fixed 锚点（画笔按钮右侧）：父级 dock 有 backdrop-filter，
  // 会屏蔽子元素 backdrop-blur 导致只有半透明没有高斯模糊，故同导出菜单一样脱离容器
  const [penPos, setPenPos] = useState<{ x: number; y: number } | null>(null);
  const penBtnRef = useRef<HTMLButtonElement>(null);
  // portal 到 body 的取色器面板自身引用（点击面板内部不关闭）
  const penMenuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<"shape" | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // PNG 导出选项：范围（全部/框选/对象）+ 含背景色 + 分辨率倍率（1x/4x/8x/64x）
  const [pngOpts, setPngOpts] = useState<{ range: "all" | "frame" | "object"; includeBackground: boolean; scale: number }>({
    range: "all",
    includeBackground: false,
    scale: 4,
  });
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toolRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  // portal 到 body 的导出菜单自身引用（点击菜单内部不关闭）
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 导入外部图片：文件 → dataURL → 图片元素（落点 = 当前视口中心的世界坐标，同粘贴图片），成功后选中
  const onImportFile = async (file: File) => {
    const v = useCanvasStore.getState().view;
    const el = await loadImageElement(file, (VIEWPORT_WIDTH / 2 - v.ox) / v.scale, (VIEWPORT_HEIGHT / 2 - v.oy) / v.scale);
    if (!el) return;
    addElement(el);
    setSelection([el.id]);
  };

  // 首启提示条「前往设置」→ 打开设置弹窗（旧 /settings 页面已删除，统一走弹窗）
  useEffect(() => {
    const onOpen = () => setSettingsOpen(true);
    window.addEventListener("open-settings", onOpen);
    return () => window.removeEventListener("open-settings", onOpen);
  }, []);

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

  // 时间线面板：点击自身保留，点击外部任意处收起
  useEffect(() => {
    if (!timelineOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (timelineRef.current?.contains(t)) return;
      setTimelineOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [timelineOpen]);

  // 框选完成：Canvas 拖矩形生成 exportFrame 后派发事件，重新打开导出面板（选中的范围=框选）
  useEffect(() => {
    const onFrameReady = () => {
      setPngOpts((o) => ({ ...o, range: "frame" }));
      setExportOpen(true);
    };
    window.addEventListener("export-frame-ready", onFrameReady);
    return () => window.removeEventListener("export-frame-ready", onFrameReady);
  }, []);

  // 导出菜单 / 标签右键菜单：点击自身保留，点击外部任意处关闭
  useEffect(() => {
    if (!exportOpen && !tabMenu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (exportRef.current?.contains(t) || exportMenuRef.current?.contains(t) || tabMenuRef.current?.contains(t)) return;
      setExportOpen(false);
      setTabMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [exportOpen, tabMenu]);

  // 画笔取色器面板（portal 到 body）：点击自身保留，点击外部任意处收起（仅当画笔面板开着时注册）
  useEffect(() => {
    if (!penOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (penBtnRef.current?.contains(t) || penMenuRef.current?.contains(t)) return;
      setPenOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [penOpen]);

  // 以视口中心为锚点缩放（与 Canvas 滚轮缩放同公式：保持锚点世界坐标不变）
  const zoomBy = (factor: number) => {
    const px = VIEWPORT_WIDTH / 2;
    const py = VIEWPORT_HEIGHT / 2;
    const newScale = Math.min(16, Math.max(0.1, view.scale * factor));
    setView({
      scale: newScale,
      ox: px - ((px - view.ox) / view.scale) * newScale,
      oy: py - ((py - view.oy) / view.scale) * newScale,
    });
  };
  const zoomTo = (scale: number) => {
    const px = VIEWPORT_WIDTH / 2;
    const py = VIEWPORT_HEIGHT / 2;
    const newScale = Math.min(16, Math.max(0.1, scale));
    setView({
      scale: newScale,
      ox: px - ((px - view.ox) / view.scale) * newScale,
      oy: py - ((py - view.oy) / view.scale) * newScale,
    });
  };

  const shapeActive = SHAPE_TOOL_SET.has(tool);

  // 当前导出范围的基准尺寸（世界坐标）：全部画布 / 框选区域 / 选中对象包围盒。
  // 分辨率下拉标签按它显示真实输出尺寸（如框选 400×300 选 8X → 8X（3200×2400）），
  // 与导出结果严格一致，不再固定显示整张画布尺寸误导用户
  const rangeDims = (() => {
    if (pngOpts.range === "frame") {
      const f = useCanvasStore.getState().exportFrame;
      return f ? { w: Math.max(f.width, 1), h: Math.max(f.height, 1) } : null;
    }
    if (pngOpts.range === "object") {
      const sel = useCanvasStore.getState().selection;
      const els = doc.elements.filter((e) => sel.includes(e.id));
      if (els.length > 0) {
        const xs = els.flatMap((e) => [e.x, e.x + e.width]);
        const ys = els.flatMap((e) => [e.y, e.y + e.height]);
        return { w: Math.max(Math.max(...xs) - Math.min(...xs), 1), h: Math.max(Math.max(...ys) - Math.min(...ys), 1) };
      }
      return null;
    }
    return { w: doc.width, h: doc.height };
  })();

  // 框选模式：直接进入框选状态即可——聚焦（高亮画布 + 暗化周围）由 Canvas 用与教学引导同款的
  // 聚光灯实现（不改视口），此处不再缩放视口（此前缩放 0.75x 全画布与引导式聚焦语义不符）

  return (
    <>
      {/* 顶栏：画布标签页 + 导出 + 设置（工具/编辑沉到左侧坞）。
          右侧留白与内容区 p-3 一致（12px），使顶栏右边界与右侧 AI 面板右边界横坐标对齐 */}
      <div className="relative z-40 flex items-center gap-1 border-b border-white/40 bg-white/60 py-1 pl-2 pr-3 backdrop-blur-xl">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {projects.map((p) => {
            const active = p.id === currentProjectId;
            return (
              <div
                key={p.id}
                data-testid="project-tab"
                data-active={active ? "true" : undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setExportOpen(false);
                  setTabMenu({ id: p.id, x: e.clientX, y: e.clientY });
                }}
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
        {/* 缩放控件：低调灰色弹性拖动条（默认只显示细条 + 百分比，存在感弱）；
            鼠标悬停才显示 −/+ 按钮与倍率输入框。−/+ 按钮与倍率区始终占位（透明切换而非 display 切换），
            展开时缩放条位置不发生移位（以当前视口中心为锚点，与滚轮缩放一致） */}
        <div className="group flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 transition-colors duration-200 hover:bg-white/60">
          <button
            title="缩小"
            onClick={() => zoomBy(1 / 1.25)}
            className="lift invisible flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs leading-none text-gray-500 hover:bg-white/80 group-hover:visible"
          >
            −
          </button>
          {/* 倍率区：输入框与百分比 span 在同一固定宽度容器内重叠（透明切换），不引起布局位移 */}
          <div className="relative h-5 w-10 shrink-0">
            <input
              aria-label="缩放倍率"
              title="输入缩放倍率（百分比）"
              value={Math.round(view.scale * 100)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) zoomTo(v / 100);
              }}
              className="absolute inset-0 w-full rounded border border-white/60 bg-white/70 px-1 text-center text-[10px] text-gray-600 opacity-0 outline-none transition-opacity duration-150 focus:border-blue-300 group-hover:opacity-100"
            />
            <span className="absolute inset-0 flex items-center justify-center text-[10px] tabular-nums text-gray-400 transition-opacity duration-150 group-hover:opacity-0">
              {Math.round(view.scale * 100)}%
            </span>
          </div>
          <input
            aria-label="缩放滑块"
            title="拖动缩放"
            type="range"
            min={0.1}
            max={16}
            step={0.05}
            value={view.scale}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="zoom-slider"
          />
          <button
            title="放大"
            onClick={() => zoomBy(1.25)}
            className="lift invisible flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs leading-none text-gray-500 hover:bg-white/80 group-hover:visible"
          >
            +
          </button>
        </div>
        {/* 导出：下载图标按钮弹出格式菜单（SVG/PNG），替代原文本按钮。
            菜单用 portal 渲染到 body + fixed 定位：脱离顶栏的 backdrop-filter 容器
            （父级 backdrop root 会屏蔽子元素的 backdrop-blur，导致只有半透明没有高斯模糊） */}
        <div className="relative" ref={exportRef}>
          <button
            title="导出"
            onClick={() => setExportOpen(!exportOpen)}
            aria-expanded={exportOpen}
            className={`lift flex h-8 w-8 items-center justify-center rounded ${exportOpen ? "bg-gray-100" : "hover:bg-gray-100"}`}
          >
            {EXPORT_ICON}
          </button>
          {exportOpen &&
            createPortal(
              <div ref={exportMenuRef} className="fixed z-50 w-52 overflow-hidden rounded-xl border border-white/50 bg-white/40 shadow-xl backdrop-blur-2xl backdrop-saturate-150"
                   style={{ top: 48, right: 12 }}
                   data-testid="export-menu">
              <div className="max-h-[70vh] overflow-y-auto">
              <button
                title="导出 SVG"
                onClick={() => {
                  // SVG 同样支持范围：对象用选中元素包围盒、框选用 exportFrame；全部不裁剪
                  let crop: { x: number; y: number; width: number; height: number } | undefined;
                  const range = pngOpts.range;
                  if (range === "frame") {
                    const f = useCanvasStore.getState().exportFrame;
                    if (f) crop = { x: f.x, y: f.y, width: Math.max(f.width, 1), height: Math.max(f.height, 1) };
                  } else if (range === "object") {
                    const sel = useCanvasStore.getState().selection;
                    const els = doc.elements.filter((e) => sel.includes(e.id));
                    if (els.length > 0) {
                      const xs = els.flatMap((e) => [e.x, e.x + e.width]);
                      const ys = els.flatMap((e) => [e.y, e.y + e.height]);
                      crop = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(Math.max(...xs) - Math.min(...xs), 1), height: Math.max(Math.max(...ys) - Math.min(...ys), 1) };
                    }
                  }
                  setExportOpen(false);
                  // SVG 同样支持"包含背景色"：跟随 PNG 面板的勾选状态（与导出 PNG 行为一致）
                  exportSvgFile(doc, "figure.svg", crop, pngOpts.includeBackground);
                }}
                className="lift w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
              >
                SVG
              </button>
              {/* PNG 导出：点击展开选项面板（含背景 + 分辨率），设置后导出 */}
              <button
                title="导出 PNG"
                onClick={() => setPngOpts((o) => ({ ...o, open: !(o as { open?: boolean }).open }))}
                className="lift flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-100"
                aria-expanded={(pngOpts as { open?: boolean }).open}
              >
                PNG
                <span className={`text-[10px] text-gray-400 transition-transform ${(pngOpts as { open?: boolean }).open ? "rotate-180" : ""}`}>▾</span>
              </button>
              {(pngOpts as { open?: boolean }).open && (
                <div className="space-y-2 border-t border-white/50 px-3 py-2" data-testid="png-options">
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="shrink-0">范围</span>
                    <select
                      value={pngOpts.range}
                      aria-label="导出范围"
                      onChange={(e) => setPngOpts((o) => ({ ...o, range: e.target.value as "all" | "frame" | "object" }))}
                      className="flex-1 rounded border border-gray-200 bg-white/70 px-1 py-0.5 text-xs"
                    >
                      <option value="all">全部画布</option>
                      <option value="object">选中对象</option>
                      <option value="frame">框选区域</option>
                    </select>
                    {pngOpts.range === "frame" && (
                      <button
                        type="button"
                        title="在画布上拖出导出区域"
                        aria-label="在画布上框选导出区域"
                        onClick={() => {
                          // 聚焦画布：进入框选模式，Canvas 会用引导同款聚光灯高亮画布提示拖框
                          useCanvasStore.getState().setFramingExport(true);
                          setExportOpen(false);
                        }}
                        className="lift shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-100"
                      >
                        框选…
                      </button>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={pngOpts.includeBackground}
                      aria-label="导出含背景颜色"
                      onChange={(e) => setPngOpts((o) => ({ ...o, includeBackground: e.target.checked }))}
                    />
                    含背景颜色
                  </label>
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="shrink-0">分辨率</span>
                    <select
                      value={pngOpts.scale}
                      aria-label="导出分辨率"
                      onChange={(e) => setPngOpts((o) => ({ ...o, scale: Number(e.target.value) }))}
                      className="flex-1 rounded border border-gray-200 bg-white/70 px-1 py-0.5 text-xs"
                    >
                      <option value={1}>1X（{rangeDims ? `${Math.round(rangeDims.w)}×${Math.round(rangeDims.h)}` : "未框选"}）</option>
                      <option value={4}>4X（{rangeDims ? `${Math.round(rangeDims.w * 4)}×${Math.round(rangeDims.h * 4)}` : "未框选"}）</option>
                      <option value={8}>8X（{rangeDims ? `${Math.round(rangeDims.w * 8)}×${Math.round(rangeDims.h * 8)}` : "未框选"}）</option>
                      <option value={64}>64X（{rangeDims ? `${Math.round(rangeDims.w * 64)}×${Math.round(rangeDims.h * 64)}` : "未框选"}）</option>
                    </select>
                  </div>
                  <button
                    title="导出 PNG 文件"
                    onClick={() => {
                      const { includeBackground, scale, range } = pngOpts;
                      // 范围 → crop：对象用选中元素包围盒，框选用 exportFrame；全部不裁剪
                      let crop: { x: number; y: number; width: number; height: number } | undefined;
                      if (range === "frame") {
                        const f = useCanvasStore.getState().exportFrame;
                        if (f) crop = { x: f.x, y: f.y, width: Math.max(f.width, 1), height: Math.max(f.height, 1) };
                      } else if (range === "object") {
                        const sel = useCanvasStore.getState().selection;
                        const els = doc.elements.filter((e) => sel.includes(e.id));
                        if (els.length > 0) {
                          const xs = els.flatMap((e) => [e.x, e.x + e.width]);
                          const ys = els.flatMap((e) => [e.y, e.y + e.height]);
                          crop = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(Math.max(...xs) - Math.min(...xs), 1), height: Math.max(Math.max(...ys) - Math.min(...ys), 1) };
                        }
                      }
                      setExportOpen(false);
                      exportPng(doc, "figure.png", { scale, includeBackground, crop }).catch(console.error);
                    }}
                    className="lift w-full rounded-lg bg-blue-600/85 px-3 py-1 text-center text-xs font-medium text-white hover:bg-blue-700"
                  >
                    导出 PNG
                  </button>
                </div>
              )}
              </div>
              </div>,
              document.body
            )}
        </div>
        <button title="设置" onClick={() => setSettingsOpen(true)} className="lift flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100">{SETTINGS_ICON}</button>
      </div>
      {/* 左侧悬浮玻璃坞：真实 top 跟随画布玻璃面板，提示条显隐或窗口重排后仍严格同高。 */}
      <div
        data-testid="left-toolbar"
        style={dockTop === null ? undefined : { top: dockTop }}
        className="group fixed left-4 top-[3.8125rem] z-40 flex flex-col items-center gap-1 rounded-2xl border border-white/50 bg-white/70 p-1.5 shadow-xl backdrop-blur-xl"
      >
        <div className="flex items-center">
          <button title="撤销" onClick={undo} disabled={isGenerating || !canUndo} className="lift flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-gray-100 disabled:bg-transparent disabled:opacity-40">{UNDO_ICON}</button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">撤销</span>
        </div>
        {/* 时间线：撤销/重做之间，点击弹出进度条，拖动快速撤销/重做到任意历史版本 */}
        <div className="relative flex items-center" ref={timelineRef}>
          <button
            title="时间线"
            onClick={() => setTimelineOpen(!timelineOpen)}
            aria-expanded={timelineOpen}
            disabled={isGenerating || (pastLen + futureLen === 0)}
            className={`lift flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-gray-100 disabled:bg-transparent disabled:opacity-40 ${timelineOpen ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : ""}`}
          >
            {TIMELINE_ICON}
          </button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">时间线</span>
          {timelineOpen && (
            <div className="absolute left-full top-0 z-40 ml-2 w-44 rounded-xl border border-white/50 bg-white/85 p-2 shadow-xl backdrop-blur-xl" data-testid="timeline-panel">
              <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-gray-400">
                <span>历史版本</span>
                <span data-testid="timeline-pos">{pastLen} / {pastLen + futureLen}</span>
              </div>
              <input
                type="range"
                min={0}
                max={pastLen + futureLen}
                value={pastLen}
                aria-label="历史版本进度"
                onChange={(e) => jumpTo(Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex justify-between text-[9px] text-gray-400">
                <span>最初</span>
                <span>最新</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center">
          <button title="重做" onClick={redo} disabled={isGenerating || !canRedo} className="lift flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-gray-100 disabled:bg-transparent disabled:opacity-40">{REDO_ICON}</button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">重做</span>
        </div>
        <div className="my-0.5 h-px w-7 bg-gray-200" />
        <div className="flex items-center">
          <button
            title="选择"
            onClick={() => setTool("select")}
            className={`lift flex h-9 w-9 shrink-0 items-center justify-center rounded ${
              tool === "select" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
            }`}
          >
            {CURSOR_ICON}
          </button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">选择</span>
        </div>
        <div className="flex items-center">
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
              <div className="absolute left-full top-0 z-40 ml-2 w-40 rounded-xl border border-white/50 bg-white/80 p-2 shadow-xl backdrop-blur-xl">
                <div className="mb-1 px-1 text-[10px] font-medium text-gray-400">图案</div>
                <div className="grid grid-cols-3 gap-1">
                  {SHAPE_TOOLS.map((t) => (
                    <ToolButton key={t.tool} item={t} active={t.tool === tool} onClick={() => setTool(t.tool)} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">图案</span>
        </div>
        {/* 箭头：与图案平级的独立坞按钮（连线最常用，不藏在图案气泡里） */}
        <div className="flex items-center">
          <button
            title="箭头"
            onClick={() => setTool("arrow")}
            className={`lift flex h-9 w-9 shrink-0 items-center justify-center rounded ${
              tool === "arrow" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
            }`}
          >
            {ARROW_ICON}
          </button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">箭头</span>
        </div>
        {/* 画笔：自由手绘 + 手写箭头识别（$1）自动替换为规整箭头；选中后展开颜色/粗细设置 */}
        <div className="flex items-center">
          <div className="relative">
            <button
              ref={penBtnRef}
              title="画笔"
              onClick={() => {
                // toggle：已是画笔工具且面板开着 → 收起；否则切到画笔并展开取色器
                if (tool === "pen" && penOpen) setPenOpen(false);
                else {
                  setTool("pen");
                  setPenOpen(true);
                  // 面板 portal 到 body 后需固定锚点：以画笔按钮的屏幕位置为基准
                  const r = penBtnRef.current?.getBoundingClientRect();
                  if (r) setPenPos({ x: r.right + 8, y: r.top });
                }
              }}
              className={`lift flex h-9 w-9 shrink-0 items-center justify-center rounded ${
                tool === "pen" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
              }`}
            >
              {PEN_ICON}
            </button>
            {/* 打开图案气泡、切换到其他工具或开始绘制时自动收起画笔面板；再次点击画笔图标也收起。
                面板 portal 到 body + fixed：脱离左侧坞的 backdrop-filter 容器，backdrop-blur 才能真正高斯模糊 */}
            {tool === "pen" && penOpen && open !== "shape" && !penDrawing && penPos && createPortal(
              <div ref={penMenuRef} className="fixed z-50 w-52 rounded-xl border border-white/50 bg-white/40 p-2 shadow-xl backdrop-blur-2xl backdrop-saturate-150" style={{ left: penPos.x, top: penPos.y }} data-testid="pen-settings">
                <div className="mb-1.5">
                  <div className="mb-1 text-[10px] font-medium text-gray-400">颜色</div>
                  {/* 与编辑模块选色器同款：7 列网格色板 + 自定义 hex 输入（磨砂毛玻璃面板） */}
                  <div className="grid grid-cols-7 gap-1.5">
                    {PEN_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        aria-label={`画笔颜色 ${c}`}
                        onClick={() => setPenColor(c)}
                        className={`lift aspect-square w-full rounded-md border ${penColor.toLowerCase() === c ? "border-blue-500 ring-2 ring-blue-300" : "border-black/10 hover:ring-2 hover:ring-blue-200"}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="shrink-0">自定义</span>
                    <input
                      value={penHex}
                      aria-label="画笔颜色自定义"
                      onChange={(e) => {
                        const v = e.target.value;
                        setPenHex(v);
                        if (/^#[0-9a-fA-F]{6}$/.test(v)) setPenColor(v.toLowerCase());
                      }}
                      onBlur={() => setPenHex(penColor)}
                      className="h-6 w-full min-w-0 flex-1 rounded-md border border-white/60 bg-white/70 px-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
                      placeholder="#rrggbb"
                    />
                  </label>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-medium text-gray-400">笔类型</div>
                  <div className="grid grid-cols-3 gap-1">
                    {([["solid", "中性笔"], ["dashed", "虚线笔"], ["pencil", "铅笔"]] as const).map(([s, label]) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={penStyle === s}
                        onClick={() => setPenStyle(s)}
                        className={`lift rounded-lg border px-1 py-0.5 text-[11px] ${penStyle === s ? "border-blue-300 bg-blue-100 text-blue-700" : "border-white/60 bg-white/70 text-gray-600 shadow-sm hover:bg-white/90"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-1.5">
                  <div className="mb-1 text-[10px] font-medium text-gray-400">粗细（{penWidth}px）</div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={penWidth}
                    aria-label="画笔粗细"
                    onChange={(e) => setPenWidth(Number(e.target.value))}
                    className="w-full"
                  />
                  {/* 粗细预览：以当前颜色画一条所选粗细的线，所见即所得 */}
                  <div className="mt-1.5 flex h-7 items-center rounded-md border border-white/60 bg-white/60 px-2">
                    <div className="w-full rounded-full" style={{ height: Math.max(1, penWidth), background: penColor }} />
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">画笔</span>
        </div>
        <div className="flex items-center">
          <button
            title="文本框"
            onClick={() => setTool("text")}
            className={`lift flex h-9 w-9 shrink-0 items-center justify-center rounded ${
              tool === "text" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
            }`}
          >
            {TEXT_ICON}
          </button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">文本</span>
        </div>
        <div className="flex items-center">
          <button title="公式" onClick={() => setFormulaOpen(true)} className="lift flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-gray-100">{FORMULA_ICON}</button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">公式</span>
        </div>
        <div className="flex items-center">
          <button
            title="逻辑"
            onClick={() => setTool("logic")}
            className={`lift flex h-9 w-9 shrink-0 items-center justify-center rounded ${
              tool === "logic" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-400" : "hover:bg-gray-100"
            }`}
          >
            {LOGIC_ICON}
          </button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">逻辑</span>
        </div>
        <div className="flex items-center">
          <button title="图表" onClick={() => setChartOpen(true)} className="lift flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-gray-100">{CHART_ICON}</button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">图表</span>
        </div>
        <div className="flex items-center">
          <button title="图片" onClick={() => fileRef.current?.click()} className="lift flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-gray-100">{IMPORT_ICON}</button>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-600 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:mr-2.5 group-hover:max-w-20 group-hover:opacity-100">图片</span>
        </div>
      </div>
      {/* 隐藏文件选择：导入按钮触发；选择后立即清空 value 允许重复导入同一文件 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImportFile(f);
          e.target.value = "";
        }}
      />
      <ChartDialog open={chartOpen} onClose={() => setChartOpen(false)} />
      <FormulaDialog id={formulaOpen ? null : ""} onClose={() => setFormulaOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* 标签右键菜单：重命名画布（顶部 ✎ 按钮已移除，右键标签呼出） */}
      {tabMenu && (
        <div
          ref={tabMenuRef}
          data-testid="tab-menu"
          className="fixed z-50 w-28 overflow-hidden rounded-xl border border-white/50 bg-white/80 shadow-xl backdrop-blur-xl"
          style={{ left: tabMenu.x, top: tabMenu.y }}
        >
          <button
            title="重命名"
            onClick={() => {
              const p = projects.find((x) => x.id === tabMenu.id);
              const name = window.prompt("画布名称", p?.name ?? "");
              if (name && name.trim()) renameProject(tabMenu.id, name.trim());
              setTabMenu(null);
            }}
            className="lift w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
          >
            重命名
          </button>
        </div>
      )}
    </>
  );
}
