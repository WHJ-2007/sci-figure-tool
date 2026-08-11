"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { hitTestElement, logicAnchors, arrowPoints, distToSegment, projectOnSegment, elementBounds } from "@/lib/canvas/geometry";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas/geometry";
import { loadImageElement } from "@/lib/canvas/imageImport";
import type { CanvasElement } from "@/lib/canvas/types";
import ElementShape from "./ElementShape";
import SelectionOverlay from "./SelectionOverlay";
import TextEditor from "./TextEditor";
import FormulaDialog from "./FormulaDialog";
import CanvasStyleMenu from "./CanvasStyleMenu";
import ArrowContextMenu, { type ArrowMenuState } from "./ArrowContextMenu";
import ChartDialog from "./ChartDialog";
import { usePointerInteraction, type DrawPreview } from "./usePointerInteraction";
import CanvasMiniMap from "./CanvasMiniMap";

// 画布背景：缺省纯白；"none" 透明；"linear:#c1,#c2" 对角渐变
export function backgroundFill(bg: string | undefined): string {
  if (!bg || bg === "#ffffff") return "#ffffff";
  if (bg === "none") return "none";
  if (bg.startsWith("linear:")) return "url(#canvas-bg-grad)";
  return bg;
}

function backgroundGradient(bg: string | undefined): [string, string] | null {
  if (!bg?.startsWith("linear:")) return null;
  const [c1, c2] = bg.slice(7).split(",");
  if (!c1 || !c2) return null;
  return [c1, c2];
}

function previewElement(p: DrawPreview): CanvasElement {
  // 注：TS 对"判别字段本身是联合字面量"的联合在 === 分支后不做剔除，需用结构判别（"points" in p）
  if ("points" in p) {
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    if (p.type === "arrow" || p.type === "bent-arrow" || p.type === "bent-line") {
      // 画笔顿笔预判：颜色/粗细跟随画笔设置，与松手成图完全一致（此前用默认值导致预判与成图不符）；
      // 折点箭头（bent-arrow）带 midPoints 折点，与松手成图一致（不再显示成直箭头）；
      // 折线/平滑折线（bent-line）：head:"none" + 拐点（smooth 折点 → Catmull-Rom 平滑穿过）；
      // 箭头工具绘制预览保持默认
      const st = useCanvasStore.getState();
      const pen = st.tool === "pen";
      return makeElement("arrow", first.x, first.y, last.x - first.x, last.y - first.y, {
        strokeOpacity: 0.6,
        ...(p.type === "bent-arrow" && p.midPoints.length > 0 ? { midPoints: p.midPoints } : {}),
        ...(p.type === "bent-line" && p.midPoints.length > 0 ? { head: "none", midPoints: p.midPoints } : {}),
        ...(pen ? { strokeWidth: st.penWidth, stroke: st.penColor } : {}),
      });
    }
    // 线条 = 无头箭头：与成图一致的 arrow + head:"none"
    if (p.type === "line") {
      return makeElement("arrow", first.x, first.y, last.x - first.x, last.y - first.y, { head: "none", strokeOpacity: 0.6 });
    }
    if (p.type === "pen") {
      // 画笔预览：连续点列 + 圆头描边（半透明提示，颜色/粗细/笔类型沿用画笔设置，与成图一致）
      const st = useCanvasStore.getState();
      const dash = st.penStyle === "solid" ? undefined : st.penStyle === "dashed" ? [8, 4] : [2, 3];
      return makeElement("pen", first.x, first.y, 0, 0, { points: p.points, strokeOpacity: 0.6, strokeWidth: st.penWidth, stroke: st.penColor, ...(dash ? { dash } : {}) });
    }
    return makeElement("polyline", first.x, first.y, 0, 0, { points: p.points, strokeOpacity: 0.6 });
  }
  if (p.type === "text") {
    // 文字拖动预览：保留拖出框的宽高（makeElement 会按空文字重算成最小尺寸）
    const el = makeElement("text", p.x, p.y, p.width, p.height, { text: "", opacity: 0.6 });
    el.width = p.width;
    el.height = p.height;
    return el;
  }
  // 画笔顿笔预判的封闭图形（圆形/方形/矩形）：颜色/粗细跟随画笔设置，填充透明（与松手成图一致，
  // 此前用默认白色填充导致"预测出来是实心"）
  const st = useCanvasStore.getState();
  if (st.tool === "pen") {
    return makeElement(p.type, p.x, p.y, p.width, p.height, {
      fill: "none",
      stroke: st.penColor,
      strokeWidth: st.penWidth,
      strokeOpacity: 0.6,
    });
  }
  return makeElement(p.type, p.x, p.y, p.width, p.height, { opacity: 0.6 });
}

export default function Canvas({ viewportWidth, viewportHeight }: { viewportWidth: number; viewportHeight: number }) {
  const doc = useCanvasStore((s) => s.doc);
  const editingText = useCanvasStore((s) => s.editingText);
  const view = useCanvasStore((s) => s.view);
  const setView = useCanvasStore((s) => s.setView);
  const tool = useCanvasStore((s) => s.tool);
  const aiLockedIds = useCanvasStore((s) => s.aiLockedIds);
  const svgRef = useRef<SVGSVGElement>(null);
  // 缩放中显示缩略图：滚轮缩放时短暂展示（800ms 无缩放后收起），与平移缩略图共用
  const [zooming, setZooming] = useState(false);
  const zoomTimerRef = useRef<number | null>(null);

  // 每次换算实时读 store 的 view：任何时刻的换算基准都与渲染一致，
  // 不依赖闭包捕获的 view 快照（拖动中若 view 变化会与按下时的 startX 混算，元素位移被放大）
  const worldX = useCallback((clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = useCanvasStore.getState().view;
    return (clientX - (rect?.left ?? 0) - v.ox) / v.scale;
  }, []);
  const worldY = useCallback((clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = useCanvasStore.getState().view;
    return (clientY - (rect?.top ?? 0) - v.oy) / v.scale;
  }, []);

  const { rubber, preview, panning, anchorHint, movingIds, movePreview, alignGuides, arrowMoveAnchors, seamHover, onPointerDown, onPointerMove, onPointerUp, modeRef, startTouchArrow, lastRightClickRef } = usePointerInteraction(worldX, worldY);

  // 框选导出：导出面板选「框选区域」后进入框选模式，在画布上拖矩形生成 exportFrame
  const framingExport = useCanvasStore((s) => s.framingExport);
  const setExportFrame = useCanvasStore((s) => s.setExportFrame);
  const setFramingExport = useCanvasStore((s) => s.setFramingExport);
  const [framingRect, setFramingRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const framingStartRef = useRef<{ x: number; y: number } | null>(null);
  // 框选聚焦（引导同款聚光灯）：进入框选模式后高亮玻璃画布面板 + 暗化周围，提示用户在画布上拖框；
  // 不改视口（与教学引导一致——聚焦 = 高亮目标，而非缩放画布）
  const glassRef = useRef<HTMLDivElement>(null);
  const [glassRect, setGlassRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!framingExport) { setGlassRect(null); return; }
    const measure = () => {
      const r = glassRef.current?.getBoundingClientRect();
      if (r) setGlassRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [framingExport]);
  const onSvgPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (framingExport) {
      e.stopPropagation();
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      framingStartRef.current = p;
      setFramingRect({ x: p.x, y: p.y, width: 0, height: 0 });
      return;
    }
    onPointerDown(e);
  }, [framingExport, worldX, worldY, onPointerDown]);
  const onSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (framingExport && framingStartRef.current) {
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const s = framingStartRef.current;
      setFramingRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
      return;
    }
    onPointerMove(e);
  }, [framingExport, worldX, worldY, onPointerMove]);
  const onSvgPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (framingExport && framingStartRef.current) {
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const s = framingStartRef.current;
      const rect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) };
      framingStartRef.current = null;
      setFramingRect(null);
      setFramingExport(false);
      if (rect.width > 8 && rect.height > 8) {
        setExportFrame(rect);
        // 通知工具栏重新打开导出面板（框选完成即可导出）
        window.dispatchEvent(new CustomEvent("export-frame-ready"));
      }
      return;
    }
    onPointerUp();
  }, [framingExport, worldX, worldY, onPointerUp, setExportFrame, setFramingExport]);

  // 右键菜单（画布样式 + 箭头折点）：点击菜单外/Escape 关闭
  const [styleMenu, setStyleMenu] = useState<{ x: number; y: number } | null>(null);
  const [arrowMenu, setArrowMenu] = useState<ArrowMenuState>(null);
  // 右键「编辑图表数据」：记录要编辑的 chartId，弹出 ChartDialog（含数据/类型/尺寸）
  const [editChartId, setEditChartId] = useState<string | null>(null);
  const closeStyleMenu = useCallback(() => setStyleMenu(null), []);
  const closeArrowMenu = useCallback(() => setArrowMenu(null), []);
  useEffect(() => {
    if (!styleMenu && !arrowMenu) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("[data-testid='canvas-style-menu'], [data-testid='arrow-context-menu']")) return;
      setStyleMenu(null);
      setArrowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStyleMenu(null);
        setArrowMenu(null);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [styleMenu, arrowMenu]);

  // 图片导入：文件 → 图片元素并选中（失败静默）
  const importImageFile = useCallback(async (file: File, cx: number, cy: number) => {
    const el = await loadImageElement(file, cx, cy);
    if (!el) return;
    useCanvasStore.getState().addElement(el);
    useCanvasStore.getState().setSelection([el.id]);
  }, []);

  // 拖入外部图片：落点 = 鼠标世界坐标
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // 阻止浏览器默认打开文件，才允许 drop 触发
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
    void importImageFile(files[0], p.x, p.y);
  };

  // Ctrl+V 粘贴图片：落点 = 当前视口中心的世界坐标（无鼠标位置可用）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const s = useCanvasStore.getState();
      if (s.editingText) return; // 文字编辑中不拦截
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (!it.type.startsWith("image/")) continue;
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const v = s.view;
        void importImageFile(file, (viewportWidth / 2 - v.ox) / v.scale, (viewportHeight / 2 - v.oy) / v.scale);
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importImageFile, viewportWidth, viewportHeight]);

  // 双击文字元素进入编辑（世界坐标命中，从顶层往下找）
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const s = useCanvasStore.getState();
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const top = [...s.doc.elements].sort((a, b) => b.zIndex - a.zIndex);
      for (const el of top) {
        if (hitTestElement(el, p)) {
          // AI 非阻塞：AI 正在编辑的元素锁定——双击不进编辑
          if (s.aiLockedIds.includes(el.id)) return;
          if (el.type === "text" || el.type === "formula") s.setEditingText(el.id);
          return;
        }
      }
    },
    [worldX, worldY]
  );

  // 右键菜单：指针下的任意箭头（无论是否已选中）→ 选中并弹折点菜单（新建平滑/尖锐/删除）；
  // 右键空白画布 → 画布样式菜单
  const onContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      const s = useCanvasStore.getState();
      const p = { x: worldX(e.clientX), y: worldY(e.clientY) };
      const tol = 14 / s.view.scale;
      // 自顶向下找指针下的未锁定元素（重叠时取最上层）：箭头命中折点/线段弹折点菜单，
      // 命中任意元素（含线条）弹删除菜单
      for (const el of [...s.doc.elements].sort((a, b) => b.zIndex - a.zIndex)) {
        if (s.aiLockedIds.includes(el.id)) continue;
        if (el.type === "arrow") {
          const mid = el.midPoints ?? [];
          for (let i = 0; i < mid.length; i++) {
            if (Math.hypot(p.x - (el.x + mid[i].x), p.y - (el.y + mid[i].y)) <= tol) {
              if (s.selection.length !== 1 || s.selection[0] !== el.id) s.setSelection([el.id]);
              setArrowMenu({
                kind: "midpoint",
                midIndex: i,
                x: Math.min(e.clientX, window.innerWidth - 176),
                y: Math.min(e.clientY, window.innerHeight - 64),
              });
              return;
            }
          }
          const pts = arrowPoints(el);
          for (let i = 1; i < pts.length; i++) {
            if (distToSegment(p, pts[i - 1], pts[i]) <= tol) {
              if (s.selection.length !== 1 || s.selection[0] !== el.id) s.setSelection([el.id]);
              const proj = projectOnSegment(p, pts[i - 1], pts[i]);
              setArrowMenu({
                kind: "segment",
                insertAt: i - 1,
                // 折点为相对坐标（相对箭头起点）
                point: { x: proj.x - el.x, y: proj.y - el.y },
                x: Math.min(e.clientX, window.innerWidth - 176),
                y: Math.min(e.clientY, window.innerHeight - 112),
              });
              return;
            }
          }
        }
        // 命中元素（箭头折点/线段之外、或其他任何元素）：选中并弹删除菜单
        if (hitTestElement(el, p, 12 / s.view.scale)) {
          if (s.selection.length !== 1 || s.selection[0] !== el.id) s.setSelection([el.id]);
          // 图表元素（chartId 或 bind）右键：提供「编辑图表数据」入口
          const chartId = el.chartId || (el.bind && el.bind.chartId ? el.bind.chartId : undefined);
          if (chartId) {
            setArrowMenu({
              kind: "chart",
              chartId,
              x: Math.min(e.clientX, window.innerWidth - 176),
              y: Math.min(e.clientY, window.innerHeight - 64),
            });
            return;
          }
          setArrowMenu({
            kind: "element",
            x: Math.min(e.clientX, window.innerWidth - 176),
            y: Math.min(e.clientY, window.innerHeight - 64),
          });
          return;
        }
      }
      // 右键元素（非箭头）不弹画布样式菜单；右键拖拽多选后（lastRightClickRef.dragged）也不弹
      if ((e.target as Element).closest("[data-element-id]")) return;
      const rc = lastRightClickRef.current;
      lastRightClickRef.current = null;
      if (rc?.dragged) return;
      const M_W = 200;
      const M_H = 300;
      setStyleMenu({
        x: Math.min(e.clientX, window.innerWidth - M_W - 8),
        y: Math.min(e.clientY, window.innerHeight - M_H - 8),
      });
    },
    [worldX, worldY, lastRightClickRef]
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    // 拖动/绘制中锁定视口：缩放会改变换算基准，拖动中 view 变化（触控板惯性滚动等）会让
    // 元素位移与指针严重不匹配（"鼠标动 1 格卡片动 20 格"）
    if (modeRef.current.kind !== "idle") return;
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    // 允许更大范围缩放（0.1~16 倍）：精细看细节（16x）与纵览全图（0.1x）都支持
    const newScale = Math.min(16, Math.max(0.1, view.scale * factor));
    setView({
      scale: newScale,
      ox: px - ((px - view.ox) / view.scale) * newScale,
      oy: py - ((py - view.oy) / view.scale) * newScale,
    });
    // 缩放中也显示左下角缩略图（缩放停止 800ms 后收起）
    setZooming(true);
    if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = window.setTimeout(() => setZooming(false), 800);
  };

  const sorted = [...doc.elements].sort((a, b) => a.zIndex - b.zIndex);
  const editing = doc.elements.find((e) => e.id === editingText && (e.type === "text" || e.type === "formula"));
  const grad = backgroundGradient(doc.background);

  return (
    <div className="relative h-full w-full select-none" onWheel={onWheel} onDragOver={onDragOver} onDrop={onDrop}>
      {/* 玻璃面板包裹画布：撑满整个画布容器（高度与右侧 AI 面板天然齐平），
          svg 内容固定 1200×800 居中；inset-2 四周留边距让外投影完整显示，
          不再被容器边缘/相邻面板裁切（阴影断裂）；溢出内容由玻璃面板自身裁剪 */}
      <div ref={glassRef} className="glass-canvas absolute inset-2 flex items-center justify-center overflow-hidden">
      <svg
        ref={svgRef}
        width={viewportWidth}
        height={viewportHeight}
        className={`block shrink-0 ${tool === "select" ? (seamHover ? "cursor-ew-resize" : panning ? "cursor-grabbing" : "cursor-grab") : ""}`}
        data-testid="canvas-svg"
        onPointerDown={onSvgPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerCancel={onSvgPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {(grad || doc.elements.some((e) => e.shadow)) && (
          <defs>
            {grad && (
              <linearGradient id="canvas-bg-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={grad[0]} />
                <stop offset="1" stopColor={grad[1]} />
              </linearGradient>
            )}
            {/* 元素整体投影：filter id 用元素 id 保证唯一；区域扩到 ±50% 防模糊裁剪 */}
            {doc.elements.map((e) =>
              e.shadow ? (
                <filter key={e.id} id={`sh-${e.id}`} x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx={e.shadow.dx} dy={e.shadow.dy} stdDeviation={e.shadow.blur} floodColor={e.shadow.color} floodOpacity={e.shadow.opacity} />
                </filter>
              ) : null
            )}
          </defs>
        )}
        <rect data-testid="canvas-bg" width={viewportWidth} height={viewportHeight} rx={10} fill={backgroundFill(doc.background)} pointerEvents="none" />
        <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
          {sorted.map((e) => (
            <ElementShape key={e.id} e={e} locked={aiLockedIds.includes(e.id)} ghost={movingIds.includes(e.id)} />
          ))}
          {preview && <ElementShape e={previewElement(preview)} plain={preview.type === "pen"} />}
          {/* 文本框拖动预览：蓝色虚线框显示"松手后框的落点"（拖动过程中即可见） */}
          {preview && preview.type === "text" && (
            <rect
              data-testid="text-preview-box"
              x={preview.x}
              y={preview.y}
              width={preview.width}
              height={preview.height}
              fill="#2563eb"
              fillOpacity={0.06}
              stroke="#2563eb"
              strokeWidth={1.5 / view.scale}
              strokeDasharray={6 / view.scale}
              pointerEvents="none"
            />
          )}
          {/* 拖动预览：虚线框显示"在这里松手元素会落在哪"（含吸附偏移） */}
          {movePreview && (
            <rect
              data-testid="move-preview"
              x={movePreview.x}
              y={movePreview.y}
              width={movePreview.width}
              height={movePreview.height}
              fill="#2563eb"
              fillOpacity={0.1}
              stroke="#2563eb"
              strokeWidth={1.5 / view.scale}
              strokeDasharray={6 / view.scale}
              pointerEvents="none"
            />
          )}
          {/* PPT 式对齐参考线：拖动到与其他元素边缘/中心对齐时，非阻塞提示线贯穿画布 */}
          {alignGuides && (
            <g pointerEvents="none" data-testid="align-guides">
              {alignGuides.x !== undefined && (
                <line x1={alignGuides.x} y1={0} x2={alignGuides.x} y2={CANVAS_HEIGHT} stroke="#f59e0b" strokeWidth={1.5 / view.scale} strokeDasharray={5 / view.scale} />
              )}
              {alignGuides.y !== undefined && (
                <line x1={0} y1={alignGuides.y} x2={CANVAS_WIDTH} y2={alignGuides.y} stroke="#f59e0b" strokeWidth={1.5 / view.scale} strokeDasharray={5 / view.scale} />
              )}
            </g>
          )}
          {/* AI 非阻塞：本轮生成中 AI 正在编辑的元素——蓝色虚线呼吸框，不可交互 */}
          {aiLockedIds.map((id) => {
            const e = doc.elements.find((x) => x.id === id);
            if (!e) return null;
            const b = elementBounds(e);
            // 与 SelectionOverlay 一致：boundsOf 是未旋转 bbox，旋转中心取 bbox 中心（旋转后虚线框仍贴合元素）
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const rot = e.rotation ? `rotate(${e.rotation} ${cx} ${cy})` : undefined;
            return (
              <rect
                key={id}
                className="ai-lock-overlay"
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                transform={rot}
                pointerEvents="none"
              />
            );
          })}
          <SelectionOverlay scale={view.scale} startTouchArrow={startTouchArrow} />
          {editing && editing.type === "formula" && <FormulaDialog id={editing.id} onClose={() => useCanvasStore.setState({ editingText: null })} />}
          {editing && editing.type === "text" && <TextEditor id={editing.id} x={editing.x} y={editing.y} />}
        </g>
        {/* 框选导出预览框：框选模式下拖拽显示导出区域 */}
        {framingExport && framingRect && (
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`} pointerEvents="none">
            <rect x={framingRect.x} y={framingRect.y} width={framingRect.width} height={framingRect.height} fill="#2563eb14" stroke="#2563eb" strokeWidth={1.5 / view.scale} strokeDasharray={6 / view.scale} />
          </g>
        )}
        {rubber && (
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
            <rect x={rubber.x} y={rubber.y} width={rubber.width} height={rubber.height} fill="#2563eb22" stroke="#2563eb" strokeWidth={1} />
          </g>
        )}
        {/* 锚点候选层：箭头/线条工具悬停/绘制中、逻辑触点拉箭头拖动中（preview.type === "arrow"），
            或移动已有箭头时（arrowMoveAnchors 非空）——显示其他逻辑节点的箭头锚点，吸附中的高亮 */}
        {(tool === "arrow" || tool === "line" || preview?.type === "arrow" || preview?.type === "line" || !!arrowMoveAnchors) && (
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`} pointerEvents="none">
            {doc.elements.flatMap((e) => logicAnchors(e)).map((a) => {
              const active = anchorHint?.id === a.id;
              return (
                <circle
                  key={a.id}
                  data-anchor-layer={a.side}
                  data-element-id={a.elementId}
                  data-active={active ? "true" : undefined}
                  cx={a.x}
                  cy={a.y}
                  r={4 / view.scale}
                  fill={active ? "#2563eb" : "none"}
                  stroke="#2563eb"
                  strokeWidth={1.5 / view.scale}
                  opacity={0.7}
                />
              );
            })}
          </g>
        )}
      </svg>
      {/* 平移或缩放画布时左下角显示整体缩略图（含当前视口框）；放在玻璃面板内与画布左下角对齐留边距 */}
      {(panning || zooming) && <CanvasMiniMap viewportWidth={viewportWidth} viewportHeight={viewportHeight} />}
      </div>
      {/* 框选聚焦：进入框选模式时用与教学引导同款的聚光灯高亮玻璃画布面板 + 暗化周围，
          并附磨砂玻璃提示气泡（pointer-events-none 不拦截画布拖框） */}
      {framingExport && glassRect && createPortal(
        <div className="pointer-events-none fixed inset-0 z-[70]" data-testid="framing-spotlight">
          <div
            className="pointer-events-none fixed rounded-2xl border-2 border-blue-400 ring-4 ring-blue-300/40 transition-all duration-200"
            style={{ left: glassRect.left - 6, top: glassRect.top - 6, width: glassRect.width + 12, height: glassRect.height + 12, boxShadow: "0 0 0 9999px rgb(15 23 42 / 0.38)" }}
          />
          <div className="pointer-events-none fixed left-1/2 top-6 w-fit -translate-x-1/2 rounded-xl border border-white/60 bg-white/85 px-4 py-2 text-sm text-gray-700 shadow-xl backdrop-blur-xl">
            在画布上拖出导出区域，松手后自动返回导出面板
          </div>
        </div>,
        document.body
      )}
      {styleMenu && <CanvasStyleMenu x={styleMenu.x} y={styleMenu.y} onClose={closeStyleMenu} />}
      {arrowMenu && (
        <ArrowContextMenu
          menu={arrowMenu}
          onClose={closeArrowMenu}
          onEditChart={(chartId) => setEditChartId(chartId)}
        />
      )}
      {editChartId && (
        <ChartDialog
          open={true}
          chartId={editChartId}
          initial={doc.charts?.[editChartId] ?? null}
          onClose={() => setEditChartId(null)}
        />
      )}
    </div>
  );
}
